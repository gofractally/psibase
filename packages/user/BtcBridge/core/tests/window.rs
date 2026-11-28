//! The reporting window in Bitcoin blocks: one measure for admitting a deposit and retiring its guard.
use bitcoin::{
    bip32::{Xpriv, Xpub},
    secp256k1::Secp256k1,
    Network,
};
use btcbridge_core::*;

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
        min_withdrawal: 1000,
        min_deposit: 1000,
        dust: 1000,
        batch_seconds: 300,
        batch_size: 2,
        max_inputs: 64,
        report_blocks: 1000,
    }
}
const X: u32 = DEFAULT_REPORT_BLOCKS;
/// The bridge as it acts: the frontier is advanced under the tip it sees, then asked.
fn open_under(frontier: &mut u32, tip: u32, x: u32, height: u32) -> bool {
    *frontier = advance_frontier(*frontier, tip, x);
    window_open(*frontier, height)
}

#[test]
fn a_block_is_reportable_until_the_tip_reaches_it_plus_x() {
    assert_eq!((X, REORG_MARGIN, MIN_REPORT_BLOCKS), (1000, 144, 288));
    let h = 332_753; // psiber.net's first deposit
    let mut f = 0;
    // Open from its own block through tip = h + X - 1; closed at tip = h + X.
    assert!(open_under(&mut f, h, X, h));
    assert!(open_under(&mut f, h + X - 1, X, h));
    assert!(!open_under(&mut f, h + X, X, h));
    assert_eq!(f, h);
    // The bare formula says the same: open iff tip < h + X.
    for tip in [h, h + 1, h + 999, h + 1000, h + 1001, h + 5000] {
        assert_eq!(window_open(advance_frontier(0, tip, X), h), tip < h + X);
    }
    // A block above the tip (not yet canonical) is not closed; a relay that has not reached X
    // blocks has closed nothing.
    assert!(window_open(advance_frontier(0, 500, X), 1));
    assert_eq!(advance_frontier(0, 999, X), 0);
}

#[test]
fn the_guard_is_retired_only_a_margin_after_the_window_closed() {
    let h = 332_753;
    let at = |tip| advance_frontier(0, tip, X);
    // Not while a proof is acceptable, not when the window has just closed...
    assert!(window_open(at(h + X - 1), h) && !guard_retirable(at(h + X - 1), h));
    assert!(!window_open(at(h + X), h) && !guard_retirable(at(h + X), h));
    assert!(!guard_retirable(at(h + X + 143), h));
    // ... only from tip = h + X + 144.
    assert!(guard_retirable(at(h + X + 144), h));
    assert!(!guard_retirable(u32::MAX, u32::MAX - 100));
    // At no tip is a proof acceptable and its record retirable; between lies a band of 144
    // blocks where the proof is refused and the record still kept.
    for tip in h..h + 2000 {
        let f = at(tip);
        assert!(!(window_open(f, h) && guard_retirable(f, h)));
    }
    assert_eq!((h..h + 2000).filter(|tip| !window_open(at(*tip), h) && !guard_retirable(at(*tip), h)).count(), 144);
}

#[test]
fn closing_is_final_across_reorganizations_and_changes_of_x() {
    let h = 10_000;
    // The tip reached h + X, then a reorganization took it back by the relay's bound.
    let mut f = 0;
    assert!(!open_under(&mut f, h + X, X, h));
    assert!(!open_under(&mut f, h + X - 128, X, h), "a fallen tip does not reopen the block");
    // The frontier never falls, whatever tips follow.
    let mut frontier = 0;
    let mut highest = 20_000u32;
    for round in 0..3000u32 {
        let tip = if round % 37 == 36 { highest - round % 129 } else { highest += round % 4; highest };
        let next = advance_frontier(frontier, tip, X);
        assert!(next >= frontier);
        frontier = next;
        // What is retirable is below anything a reorganization of at most 128 blocks can touch.
        assert!(frontier < highest - 128);
    }
    // X lengthened after a record was retired under the shorter window: the block stays closed.
    let mut f = 0;
    assert!(!open_under(&mut f, h + 288 + 144, 288, h));
    assert!(guard_retirable(f, h));
    assert!(!open_under(&mut f, h + 288 + 145, 5000, h), "lengthening X reopens nothing");
    assert!(guard_retirable(f, h));
    // The bare formula would have reopened it; the stored frontier is why it does not.
    assert!(window_open(advance_frontier(0, h + 288 + 145, 5000), h));
    // X shortened (a test network): the frontier jumps forward, and stays there.
    let mut f = 0;
    assert!(open_under(&mut f, h + 500, 1000, h));
    assert!(!open_under(&mut f, h + 500, 288, h));
    assert!(!open_under(&mut f, h + 500, 1000, h));
}

#[test]
fn a_stopped_relay_closes_nothing() {
    // The relay's blocks are the clock: however long nothing is relayed, the window is as it was.
    let h = 332_753;
    let mut f = 0;
    for _ in 0..1000 {
        assert!(open_under(&mut f, h + 10, X, h));
    }
    // The frontier is where the stopped tip put it and does not move.
    assert_eq!(f, h + 10 - X);
}

#[test]
fn the_policy_field_its_bounds_and_who_may_change_it() {
    let signet = policy("signet", Network::Signet);
    signet.validate().unwrap();
    // Bounds: the largest confirmation depth the relay allows plus the margin, to about a year.
    for (blocks, ok) in [(287, false), (288, true), (1000, true), (52_560, true), (52_561, false), (0, false)] {
        assert_eq!(Policy { report_blocks: blocks, ..signet.clone() }.validate().is_ok(), ok, "{blocks}");
        assert_eq!(with_report_blocks(&signet, blocks).is_ok(), ok, "{blocks}");
    }
    // Test networks: shortened or lengthened. Only this field changes.
    let shorter = with_report_blocks(&signet, 288).unwrap();
    assert_eq!(Policy { report_blocks: 1000, ..shorter.clone() }, signet);
    with_report_blocks(&shorter, 2000).unwrap();
    with_report_blocks(&policy("regtest", Network::Regtest), 288).unwrap();
    // Mainnet: lengthened, never shortened.
    let mainnet = policy("bitcoin", Network::Bitcoin);
    assert_eq!(with_report_blocks(&mainnet, 2016).unwrap().report_blocks, 2016);
    with_report_blocks(&mainnet, 1000).unwrap();
    assert_eq!(
        with_report_blocks(&mainnet, 999).unwrap_err(),
        "The reporting window cannot be shortened on mainnet"
    );
}

#[test]
fn a_stored_policy_and_its_id_are_unchanged_by_the_new_field() {
    let p = policy("signet", Network::Signet);
    // The JSON of a policy with the default window is what it was before the field existed...
    let json = serde_json::to_string(&p).unwrap();
    assert!(!json.contains("report_blocks"));
    assert!(json.ends_with("\"batch_seconds\":300,\"batch_size\":2,\"max_inputs\":64}"));
    // ... a policy stored before reads as the default ...
    let stored: Policy = serde_json::from_str(&json).unwrap();
    assert_eq!(stored, p);
    assert_eq!(stored.report_blocks, 1000);
    // ... and its id, which open batches carry, is the hash of those same bytes.
    use bitcoin::hashes::{sha256, Hash};
    assert_eq!(p.id(), sha256::Hash::hash(json.as_bytes()).to_string());
    // A plan made before the upgrade still verifies after it.
    let input = Input { txid: "01".repeat(32), vout: 0, value: 100_000, branch: 0, index: 1, height: 100 };
    let script = hex::encode(bitcoin::ScriptBuf::new_p2wpkh(&bitcoin::WPubkeyHash::from_byte_array([9; 20])).as_bytes());
    let plan = build_plan(&stored, 1, &[input], &[Payment { id: 1, script, amount: 5000, max_fee: 1000 }]).unwrap();
    assert_eq!(plan.policy_id, p.id());
    check_plan(&p, &plan).unwrap();
    // Only another window is written, and then the id differs for batches made afterwards.
    let other = with_report_blocks(&p, 2016).unwrap();
    let json = serde_json::to_string(&other).unwrap();
    assert!(json.ends_with("\"max_inputs\":64,\"report_blocks\":2016}"));
    assert_ne!(other.id(), p.id());
    assert_eq!(serde_json::from_str::<Policy>(&json).unwrap(), other);
    // Unknown fields are still refused.
    assert!(serde_json::from_str::<Policy>(&json.replace("report_blocks", "report_block")).is_err());
}
