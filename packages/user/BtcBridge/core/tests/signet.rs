//! Signet rules, checked against real signet headers that cross a difficulty retarget.
use bitcoin::{
    bip32::{Xpriv, Xpub},
    block::Header,
    secp256k1::Secp256k1,
    Network,
};
use btcbridge_core::*;

const NOW: u64 = 1_795_800_000;
const BOUNDARY: u32 = 332_640;

/// (height, raw header); row 0 is the first header of the epoch that ends at the boundary.
fn rows() -> Vec<(u32, String)> {
    let fixture: serde_json::Value =
        serde_json::from_str(include_str!("fixtures/signet-retarget-332640.json")).unwrap();
    fixture["headers"]
        .as_array()
        .unwrap()
        .iter()
        .map(|r| {
            let raw = r["header"].as_str().unwrap().to_string();
            assert_eq!(
                header(&raw).unwrap().block_hash().to_string(),
                r["hash"].as_str().unwrap()
            );
            (r["height"].as_u64().unwrap() as u32, raw)
        })
        .collect()
}
fn parsed(rows: &[(u32, String)]) -> Vec<Header> {
    rows.iter().map(|(_, raw)| header(raw).unwrap()).collect()
}
fn policy(network: &str, kind: Network) -> Policy {
    let secp = Secp256k1::new();
    Policy {
        network: network.into(),
        xpubs: (1..=3)
            .map(|i| Xpub::from_priv(&secp, &Xpriv::new_master(kind, &[i; 32]).unwrap()).to_string())
            .collect(),
        fee_rate: 2,
        max_fee_rate: 100,
        service_fee: 100,
        min_withdrawal: 10000,
        min_deposit: 1000,
        dust: 1000,
        batch_seconds: 300,
        batch_size: 2,
        max_inputs: 64,
    }
}

#[test]
fn signet_retarget_matches_real_headers() {
    let rows = rows();
    let headers = parsed(&rows);
    assert_eq!((rows[0].0, rows[1].0, rows[12].0), (330_624, 332_629, BOUNDARY));
    let epoch_start = headers[0].time;
    let parent = headers[11];
    let times: Vec<_> = headers[1..12].iter().map(|h| h.time).collect();
    let next = &rows[12].1;
    let accepted =
        validate_next_header(next, BOUNDARY, &parent, &times, epoch_start, "signet", NOW).unwrap();
    assert_eq!(parent.bits.to_consensus(), 0x1d14fcee);
    assert_eq!(accepted.bits.to_consensus(), 0x1d14828b);
    // The epoch's first timestamp decides the new target.
    assert!(validate_next_header(
        next,
        BOUNDARY,
        &parent,
        &times,
        epoch_start + 100_000,
        "signet",
        NOW
    )
    .is_err());
    // Off the boundary the target may not change.
    assert!(
        validate_next_header(next, BOUNDARY + 1, &parent, &times, epoch_start, "signet", NOW)
            .is_err()
    );
    assert!(
        validate_next_header(next, BOUNDARY, &parent, &times[..10], epoch_start, "signet", NOW)
            .is_err()
    );
    // More than two hours ahead of the chain clock.
    assert!(validate_next_header(
        next,
        BOUNDARY,
        &parent,
        &times,
        epoch_start,
        "signet",
        accepted.time as u64 - 7201
    )
    .is_err());
}

#[test]
fn signet_headers_follow_one_another_as_the_relay_caches_them() {
    let rows = rows();
    let headers = parsed(&rows);
    // The relay's per-parent cache: the last eleven timestamps and the epoch's first timestamp.
    let mut times: Vec<_> = headers[1..12].iter().map(|h| h.time).collect();
    let mut epoch_start = headers[0].time;
    let mut parent = headers[11];
    for (height, raw) in &rows[12..] {
        let h = validate_next_header(raw, *height, &parent, &times, epoch_start, "signet", NOW)
            .unwrap();
        times.push(h.time);
        times.remove(0);
        if height % 2016 == 0 {
            epoch_start = h.time;
        }
        parent = h;
    }
    assert_eq!(parent.block_hash().to_string(), headers.last().unwrap().block_hash().to_string());
    // A header that skips its parent is refused.
    let times: Vec<_> = headers[1..12].iter().map(|h| h.time).collect();
    assert!(validate_next_header(
        &rows[13].1,
        BOUNDARY,
        &headers[11],
        &times,
        headers[0].time,
        "signet",
        NOW
    )
    .is_err());
}

#[test]
fn networks_do_not_accept_one_another() {
    let rows = rows();
    let headers = parsed(&rows);
    let times: Vec<_> = headers[1..12].iter().map(|h| h.time).collect();
    // A signet target is far above mainnet's limit; regtest never retargets.
    for other in ["bitcoin", "regtest"] {
        assert!(validate_next_header(
            &rows[12].1,
            BOUNDARY,
            &headers[11],
            &times,
            headers[0].time,
            other,
            NOW
        )
        .is_err());
    }
    assert!(check_pow(&headers[12], "signet").is_ok());
    assert!(check_pow(&headers[12], "bitcoin").is_err());
    let signet = bitcoin::blockdata::constants::genesis_block(Network::Signet).header;
    assert_eq!(
        signet.block_hash().to_string(),
        "00000008819873e925422c1ff0f99f7cc9bbb232af63a077a480a3633bee1ef6"
    );
    assert_eq!(signet.bits.to_consensus(), 0x1e0377ae);
    assert!(check_pow(&signet, "signet").is_ok());
    assert!(check_pow(&signet, "bitcoin").is_err());
    let regtest = bitcoin::blockdata::constants::genesis_block(Network::Regtest).header;
    assert!(check_pow(&regtest, "signet").is_err());
    for unsupported in ["testnet", "testnet4", "mainnet", ""] {
        assert!(network(unsupported).is_err());
        assert!(check_pow(&signet, unsupported).is_err());
        assert!(context_start(unsupported, 100).is_err());
    }
}

#[test]
fn checkpoint_context_reaches_the_epoch_start_on_retargeting_networks() {
    for net in ["signet", "bitcoin"] {
        assert_eq!(context_start(net, 332_680).unwrap(), BOUNDARY);
        // Just past a boundary the eleven timestamps reach further back than the epoch start.
        assert_eq!(context_start(net, BOUNDARY + 3).unwrap(), BOUNDARY - 7);
        assert_eq!(context_start(net, BOUNDARY).unwrap(), BOUNDARY - 10);
        assert_eq!(context_start(net, BOUNDARY - 1).unwrap(), BOUNDARY - 2016);
        assert_eq!(context_start(net, 5).unwrap(), 0);
    }
    assert_eq!(context_start("regtest", 332_680).unwrap(), 332_670);
    assert_eq!(context_start("regtest", 0).unwrap(), 0);
}

#[test]
fn signet_custody_addresses_and_destinations() {
    let p = policy("signet", Network::Signet);
    p.validate().unwrap();
    assert!(p.xpubs.iter().all(|k| k.starts_with("tpub")));
    let address = custody_address(&p, 0, 7).unwrap();
    assert!(address.starts_with("tb1q") && address.len() == 62, "{address}");
    // Same keys, same script: only the address encoding differs from regtest.
    let regtest = policy("regtest", Network::Regtest);
    assert_eq!(
        custody_script(&p, 0, 7).unwrap(),
        custody_script(&regtest, 0, 7).unwrap()
    );
    let other = custody_address(&regtest, 0, 7).unwrap();
    assert!(other.starts_with("bcrt1q"));
    assert_eq!(
        destination(&p, &address).unwrap(),
        custody_script(&p, 0, 7).unwrap()
    );
    assert!(destination(&p, &other).is_err());
    assert!(destination(&p, "bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4").is_err());
    assert!(destination(&p, "tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kxpjzsx").is_ok());
    assert!(destination(&p, "mipcBbFg9gMiCh81Kj8tqqdgoZub1ZJRfn").is_ok());
    // Mainnet extended keys cannot be used for a signet policy.
    let mut wrong = p.clone();
    wrong.xpubs = policy("bitcoin", Network::Bitcoin).xpubs;
    assert!(wrong.validate().is_err());
}
