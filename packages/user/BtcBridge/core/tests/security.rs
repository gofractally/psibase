use bitcoin::{
    absolute,
    bip32::{Xpriv, Xpub},
    block::Header,
    consensus::serialize,
    hashes::Hash,
    pow::CompactTarget,
    secp256k1::Secp256k1,
    transaction::Version,
    Amount, OutPoint, ScriptBuf, Sequence, Transaction, TxIn, TxOut, Txid, Witness,
};
use btcbridge_core::*;
fn fixture() -> (Policy, Vec<Xpriv>, Vec<Input>, Vec<Payment>) {
    let secp = Secp256k1::new();
    let keys: Vec<_> = (1..=3)
        .map(|i| Xpriv::new_master(bitcoin::Network::Regtest, &[i; 32]).unwrap())
        .collect();
    let p = Policy {
        network: "regtest".into(),
        xpubs: keys
            .iter()
            .map(|k| Xpub::from_priv(&secp, k).to_string())
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
    };
    let inputs = vec![
        Input {
            txid: "01".repeat(32),
            vout: 0,
            value: 1_000_000,
            branch: 0,
            index: 1,
            height: 100,
        },
        Input {
            txid: "02".repeat(32),
            vout: 1,
            value: 500_000,
            branch: 0,
            index: 2,
            height: 101,
        },
    ];
    let script = hex::encode(
        ScriptBuf::new_p2wpkh(&bitcoin::WPubkeyHash::from_byte_array([9; 20])).as_bytes(),
    );
    let payments = vec![
        Payment {
            id: 1,
            script: script.clone(),
            amount: 100_000,
            max_fee: 10000,
        },
        Payment {
            id: 2,
            script,
            amount: 200_000,
            max_fee: 10000,
        },
    ];
    (p, keys, inputs, payments)
}
#[test]
fn deterministic_selection_and_money_conservation() {
    let (p, _, inputs, payments) = fixture();
    let plan = build_plan(&p, 1, &inputs, &payments).unwrap();
    let mut shuffled = inputs.clone();
    shuffled.reverse();
    let mut reversed = payments.clone();
    reversed.reverse();
    assert_eq!(plan, build_plan(&p, 1, &shuffled, &reversed).unwrap());
    assert_eq!(
        plan.inputs.iter().map(|i| i.value).sum::<u64>(),
        plan.payments.iter().map(|p| p.amount).sum::<u64>() + plan.change + plan.fee
    );
    assert_eq!(plan.fees.iter().sum::<u64>(), plan.fee);
    check_plan(&p, &plan).unwrap();
}
#[test]
fn any_two_signers_preserve_transaction_identity() {
    let (p, keys, inputs, payments) = fixture();
    let plan = build_plan(&p, 1, &inputs, &payments).unwrap();
    let sigs: Vec<_> = keys
        .iter()
        .map(|k| sign_plan(&p, &plan, k).unwrap())
        .collect();
    assert!(finalize(&p, &plan, &sigs[..1]).is_err());
    assert!(finalize(&p, &plan, &[sigs[0].clone(), sigs[0].clone()]).is_err());
    for pair in [[0, 1], [0, 2], [1, 2]] {
        let raw = finalize(&p, &plan, &[sigs[pair[0]].clone(), sigs[pair[1]].clone()]).unwrap();
        let tx: Transaction = decode(&raw, 100000).unwrap();
        assert_eq!(tx.compute_txid().to_string(), plan.txid);
        assert!(plan.fee >= tx.vsize() as u64 * p.fee_rate);
    }
}
#[test]
fn signatures_cannot_authorize_modified_payments() {
    let (p, keys, inputs, payments) = fixture();
    let plan = build_plan(&p, 1, &inputs, &payments).unwrap();
    let (signer, sigs) = sign_plan(&p, &plan, &keys[0]).unwrap();
    let mut changed = payments.clone();
    changed[0].amount += 1;
    let changed = build_plan(&p, 1, &inputs, &changed).unwrap();
    assert!(verify_signatures(&p, &changed, signer, &sigs).is_err());
    let mut altered = plan.clone();
    altered.change += 1;
    assert!(check_plan(&p, &altered).is_err());
}
#[test]
fn fee_limits_duplicates_and_key_aliases_are_rejected() {
    let (mut p, _, inputs, mut payments) = fixture();
    payments[0].max_fee = 1;
    assert!(build_plan(&p, 1, &inputs, &payments).is_err());
    payments[0].max_fee = 10000;
    assert!(build_plan(&p, 1, &[inputs[0].clone(), inputs[0].clone()], &payments).is_err());
    payments[1].id = 1;
    assert!(build_plan(&p, 1, &inputs, &payments).is_err());
    p.xpubs[1] = p.xpubs[0].clone();
    assert!(p.validate().is_err());
}
#[test]
fn txid_merkle_proofs_reject_changed_outputs_and_position() {
    let tx = Transaction {
        version: Version::TWO,
        lock_time: absolute::LockTime::ZERO,
        input: vec![TxIn {
            previous_output: OutPoint {
                txid: Txid::from_byte_array([1; 32]),
                vout: 0,
            },
            script_sig: ScriptBuf::new(),
            sequence: Sequence::MAX,
            witness: Witness::new(),
        }],
        output: vec![TxOut {
            value: Amount::from_sat(100000),
            script_pubkey: ScriptBuf::new_p2wpkh(&bitcoin::WPubkeyHash::from_byte_array([9; 20])),
        }],
    };
    let h = Header {
        version: bitcoin::block::Version::ONE,
        prev_blockhash: bitcoin::BlockHash::all_zeros(),
        merkle_root: bitcoin::TxMerkleNode::from_byte_array(tx.compute_txid().to_byte_array()),
        time: 100,
        bits: CompactTarget::from_consensus(0x207fffff),
        nonce: 0,
    };
    let raw = hex::encode(serialize(&tx));
    assert!(prove_transaction(&raw, &h, &[], 0).is_ok());
    assert!(prove_transaction(&raw, &h, &[], 1).is_err());
    let mut changed = tx.clone();
    changed.output[0].value = Amount::from_sat(200000);
    assert!(prove_transaction(&hex::encode(serialize(&changed)), &h, &[], 0).is_err());
}
#[test]
fn target_sign_overflow_and_network_separation() {
    let mut h = bitcoin::blockdata::constants::genesis_block(bitcoin::Network::Regtest).header;
    assert!(check_pow(&h, "regtest").is_ok());
    assert!(check_pow(&h, "bitcoin").is_err());
    for bits in [0, 0x20800001, 0x23000001, 0x22000100, 0x21010000] {
        h.bits = CompactTarget::from_consensus(bits);
        assert!(check_pow(&h, "regtest").is_err());
    }
}
#[test]
fn mainnet_retarget_matches_historical_bitcoin_headers() {
    let fixture: serde_json::Value =
        serde_json::from_str(include_str!("fixtures/mainnet-retarget-32256.json")).unwrap();
    let rows = fixture["headers"].as_array().unwrap();
    let first = header(rows[0]["header"].as_str().unwrap()).unwrap();
    let parent = header(rows[11]["header"].as_str().unwrap()).unwrap();
    let times: Vec<_> = rows[1..12]
        .iter()
        .map(|r| header(r["header"].as_str().unwrap()).unwrap().time)
        .collect();
    let next = rows[12]["header"].as_str().unwrap();
    let accepted = validate_next_header(
        next,
        32256,
        &parent,
        &times,
        first.time,
        "bitcoin",
        2_000_000_000,
    )
    .unwrap();
    assert_eq!(accepted.bits.to_consensus(), 0x1d00d86a);
    assert_ne!(parent.bits, accepted.bits);
    assert!(validate_next_header(
        next,
        32256,
        &parent,
        &times,
        first.time + 100000,
        "bitcoin",
        2_000_000_000
    )
    .is_err());
    assert!(validate_next_header(
        next,
        32256,
        &parent,
        &times[..10],
        first.time,
        "bitcoin",
        2_000_000_000
    )
    .is_err());
}
