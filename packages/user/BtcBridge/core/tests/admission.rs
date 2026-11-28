//! Admission of a withdrawal: refused, with the figure that works, unless it could be paid alone now.
use bitcoin::{
    bip32::{Xpriv, Xpub},
    secp256k1::Secp256k1,
    Network, ScriptBuf,
};
use btcbridge_core::*;

/// The live signet policy: 2 sat/vB, 100 sat service fee, minimums 1,000, dust 1,000.
fn live() -> Policy {
    let secp = Secp256k1::new();
    Policy {
        network: "signet".into(),
        xpubs: (1..=3)
            .map(|i| Xpub::from_priv(&secp, &Xpriv::new_master(Network::Signet, &[i; 32]).unwrap()).to_string())
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
    }
}
fn input(n: u8, value: u64) -> Input {
    Input {
        txid: format!("{n:02x}").repeat(32),
        vout: 0,
        value,
        branch: 0,
        index: n as u32,
        height: 100 + n as u32,
    }
}
fn p2wpkh() -> String {
    use bitcoin::hashes::Hash;
    hex::encode(ScriptBuf::new_p2wpkh(&bitcoin::WPubkeyHash::from_byte_array([9; 20])).as_bytes())
}
fn p2tr() -> String {
    hex::encode([&[0x51, 0x20][..], &[7; 32][..]].concat())
}
fn admit(p: &Policy, reserve: &[Input], script: &str, amount: u64, max_fee: u64) -> std::result::Result<(), Refusal> {
    let answer = admit_withdrawal(p, reserve, script, amount, max_fee).unwrap();
    // Admission and batching agree: what is admitted is paid by a batch of it alone, and what is
    // refused would have been set aside by one.
    let request = Payment { id: 1, script: script.into(), amount, max_fee };
    let choice = choose_batch(p, 1, reserve, &[request]).unwrap();
    assert_eq!(answer.is_ok(), choice.plan.is_some(), "{amount}/{max_fee}");
    match &answer {
        Err(Refusal::Amount { .. }) => assert_eq!(choice.unfunded, vec![1]),
        Err(Refusal::Allowance { .. }) => assert_eq!(choice.over_fee_cap, vec![1]),
        Ok(()) => {}
    }
    answer
}

#[test]
fn the_owners_two_requests_are_refused_with_the_figures_that_work() {
    let p = live();
    let reserve = [input(1, 10_000)];
    // 9,000 with a 100 sat allowance: the one output can pay at most 8,620 after the 380 sat
    // fee and the 1,000 sat the bridge keeps as change.
    let refusal = admit(&p, &reserve, &p2wpkh(), 9000, 100).unwrap_err();
    assert_eq!(refusal, Refusal::Amount { most: 8620, fee: 380 });
    assert_eq!(
        refusal.to_string(),
        "The bridge can pay at most 8620 sat to this address now, with a network fee of 380 sat"
    );
    // 8,000 with a 100 sat allowance: payable, but its fee alone is 380.
    let refusal = admit(&p, &reserve, &p2wpkh(), 8000, 100).unwrap_err();
    assert_eq!(refusal, Refusal::Allowance { least: 380 });
    assert_eq!(
        refusal.to_string(),
        "The network fee for this withdrawal is 380 sat; the maximum network fee given is below it"
    );
    // What the refusals name is accepted.
    admit(&p, &reserve, &p2wpkh(), 8620, 380).unwrap();
    admit(&p, &reserve, &p2wpkh(), 8000, 380).unwrap();
}

#[test]
fn one_satoshi_each_side_of_both_boundaries() {
    let p = live();
    let reserve = [input(1, 10_000)];
    admit(&p, &reserve, &p2wpkh(), 8620, 380).unwrap();
    assert_eq!(admit(&p, &reserve, &p2wpkh(), 8621, 380), Err(Refusal::Amount { most: 8620, fee: 380 }));
    assert_eq!(admit(&p, &reserve, &p2wpkh(), 8620, 379), Err(Refusal::Allowance { least: 380 }));
    // A larger allowance is fine; the unused part is returned when the batch completes.
    admit(&p, &reserve, &p2wpkh(), 8620, 10_000).unwrap();
    admit(&p, &reserve, &p2wpkh(), 1000, 380).unwrap();
    // An amount over the reserve is the first thing said, whatever the allowance.
    assert_eq!(admit(&p, &reserve, &p2wpkh(), 9620, 10_000), Err(Refusal::Amount { most: 8620, fee: 380 }));
}

#[test]
fn taproot_destinations_cost_twelve_virtual_bytes_more() {
    let p = live();
    let reserve = [input(1, 10_000)];
    admit(&p, &reserve, &p2tr(), 8596, 404).unwrap();
    assert_eq!(admit(&p, &reserve, &p2tr(), 8597, 404), Err(Refusal::Amount { most: 8596, fee: 404 }));
    assert_eq!(admit(&p, &reserve, &p2tr(), 8596, 403), Err(Refusal::Allowance { least: 404 }));
    // 8,620 fits a P2WPKH destination and not a taproot one.
    assert!(admit(&p, &reserve, &p2tr(), 8620, 1000).is_err());
}

#[test]
fn several_outputs_and_the_input_limit() {
    let p = live();
    let small: Vec<_> = (1..=5).map(|n| input(n, 3000)).collect();
    let fee = |inputs: u64| budgeted_weight(inputs, &[22]).div_ceil(4) * 2;
    assert_eq!((fee(1), fee(2), fee(3), fee(5)), (380, 590, 800, 1220));
    // The fee is that of the inputs the amount needs: 1,500 needs one, 4,000 two, 11,000 all five.
    admit(&p, &small, &p2wpkh(), 1500, 380).unwrap();
    assert_eq!(admit(&p, &small, &p2wpkh(), 4000, 589), Err(Refusal::Allowance { least: 590 }));
    admit(&p, &small, &p2wpkh(), 4000, 590).unwrap();
    admit(&p, &small, &p2wpkh(), 11_000, 1220).unwrap();
    // All five can pay at most 15,000 - 1,220 - 1,000.
    admit(&p, &small, &p2wpkh(), 12_780, 1220).unwrap();
    assert_eq!(admit(&p, &small, &p2wpkh(), 12_781, 5000), Err(Refusal::Amount { most: 12_780, fee: 1220 }));
    // With at most three inputs per batch: 9,000 - 800 - 1,000.
    let three = Policy { max_inputs: 3, ..live() };
    admit(&three, &small, &p2wpkh(), 7200, 800).unwrap();
    assert_eq!(admit(&three, &small, &p2wpkh(), 7201, 5000), Err(Refusal::Amount { most: 7200, fee: 800 }));
    // Outputs of unequal size: the oldest are spent first, so the largest amount may need them all.
    let mixed = [input(1, 2000), input(2, 50_000)];
    assert_eq!(admit(&p, &mixed, &p2wpkh(), 60_000, 5000), Err(Refusal::Amount { most: 52_000 - 590 - 1000, fee: 590 }));
    admit(&p, &mixed, &p2wpkh(), 50_410, 590).unwrap();
}

#[test]
fn a_reserve_that_can_pay_nothing_says_so() {
    let p = live();
    for reserve in [vec![], vec![input(1, 2379)]] {
        let refusal = admit(&p, &reserve, &p2wpkh(), 1000, 1000).unwrap_err();
        assert_eq!(refusal, Refusal::Amount { most: 0, fee: 0 });
        assert_eq!(refusal.to_string(), "The bridge's confirmed outputs cannot pay a withdrawal now");
    }
    // 2,380 is exactly the smallest withdrawal, its fee and the change kept.
    admit(&p, &[input(1, 2380)], &p2wpkh(), 1000, 380).unwrap();
    // A malformed script is an error, not a refusal.
    assert!(admit_withdrawal(&p, &[input(1, 10_000)], "zz", 1000, 1000).is_err());
}
