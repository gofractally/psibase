//! Choosing a batch: no request can hold up the others.
use bitcoin::{
    bip32::{Xpriv, Xpub},
    secp256k1::Secp256k1,
    Network, ScriptBuf,
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
        min_withdrawal: 10000,
        min_deposit: 1000,
        dust: 1000,
        batch_seconds: 300,
        batch_size: 2,
        max_inputs: 64,
    }
}
fn signet() -> Policy {
    policy("signet", Network::Signet)
}
/// The live signet deployment after `setTestMins(1000, 1000)`: dust and fees as initialized.
fn live() -> Policy {
    with_test_minimums(&signet(), 1000, 1000).unwrap()
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
fn pay(id: u64, script: &ScriptBuf, amount: u64, max_fee: u64) -> Payment {
    Payment {
        id,
        script: hex::encode(script.as_bytes()),
        amount,
        max_fee,
    }
}
fn p2wpkh() -> ScriptBuf {
    use bitcoin::hashes::Hash;
    ScriptBuf::new_p2wpkh(&bitcoin::WPubkeyHash::from_byte_array([9; 20]))
}
fn p2tr() -> ScriptBuf {
    ScriptBuf::from_bytes([&[0x51, 0x20][..], &[7; 32][..]].concat())
}

fn paid(choice: &BatchChoice) -> Vec<u64> {
    choice.plan.iter().flat_map(|p| p.payments.iter().map(|r| r.id)).collect()
}
fn choose(p: &Policy, reserve: &[Input], requests: &[Payment]) -> BatchChoice {
    choose_batch(p, 1, reserve, requests).unwrap()
}

#[test]
fn the_owners_case_a_request_the_reserve_cannot_pay_waits_and_the_rest_are_paid() {
    let p = live();
    // The reserve is one 10,000 sat output. 9,510 is what the balance allowed; 8,620 is the most
    // the output can pay after the 380 sat fee and the 1,000 sat of change the bridge keeps.
    let reserve = [input(1, 10_000)];
    let too_much = pay(1, &p2wpkh(), 9510, 380);
    let payable = pay(2, &p2wpkh(), 8620, 380);
    assert!(!fundable_alone(&p, 1, &reserve, &too_much).unwrap());
    assert!(fundable_alone(&p, 1, &reserve, &payable).unwrap());

    let alone = choose(&p, &reserve, &[too_much.clone()]);
    assert_eq!((alone.plan.clone(), alone.unfunded.clone(), alone.over_fee_cap.clone()), (None, vec![1], vec![]));

    let one = choose(&p, &reserve, &[payable.clone()]);
    assert_eq!((paid(&one), one.unfunded.clone(), one.over_fee_cap.clone()), (vec![2], vec![], vec![]));
    assert_eq!(one.plan.as_ref().map(|plan| (plan.fee, plan.change)), Some((380, 1000)));

    // Both queued, the unpayable one first: it waits, the other is paid. Offered order is irrelevant.
    for requests in [[too_much.clone(), payable.clone()], [payable.clone(), too_much.clone()]] {
        let both = choose(&p, &reserve, &requests);
        assert_eq!((paid(&both), both.unfunded.clone(), both.over_fee_cap.clone()), (vec![2], vec![1], vec![]));
        check_plan(&p, both.plan.as_ref().unwrap()).unwrap();
    }
}

#[test]
fn the_oldest_payable_run_is_taken_and_later_requests_stay_queued() {
    let p = Policy { batch_size: 8, ..live() };
    let reserve = [input(1, 10_000)];
    let requests = [
        pay(1, &p2wpkh(), 9510, 1000), // cannot be paid at all
        pay(2, &p2wpkh(), 3000, 1000),
        pay(3, &p2wpkh(), 3000, 1000),
        pay(4, &p2wpkh(), 3000, 1000), // payable alone, not together with 2 and 3
        pay(5, &p2wpkh(), 1000, 1000), // would fit, but does not jump the queue
    ];
    let choice = choose(&p, &reserve, &requests);
    assert_eq!(choice.unfunded, vec![1]);
    assert_eq!(paid(&choice), vec![2, 3]);
    assert!(choice.over_fee_cap.is_empty());
    let plan = choice.plan.unwrap();
    assert_eq!((plan.inputs.len(), plan.fee, plan.change), (1, 442, 3558));
    // 4 and 5 are in no list: they stay queued and are next. What is left of the reserve is the
    // 3,558 sat of change (once confirmed): 4 now needs more than that and waits; 5 is paid.
    let next = choose(&p, &[input(2, 3558)], &requests[3..]);
    assert_eq!((paid(&next), next.unfunded.clone()), (vec![5], vec![4]));
    assert_eq!(next.plan.unwrap().fee, 380);
}

#[test]
fn when_the_reserve_grows_the_waiting_request_is_paid() {
    let p = live();
    let request = pay(1, &p2wpkh(), 9510, 1000);
    let before = [input(1, 10_000)];
    assert_eq!(choose(&p, &before, &[request.clone()]).unfunded, vec![1]);
    // Another deposit arrives: the service asks `fundable_alone` and puts the request back.
    let after = [input(1, 10_000), input(2, 10_000)];
    assert!(fundable_alone(&p, 1, &after, &request).unwrap());
    let choice = choose(&p, &after, &[request]);
    let plan = choice.plan.unwrap();
    assert_eq!((plan.inputs.len(), plan.fee, plan.change), (2, 590, 20_000 - 9510 - 590));
    assert!(choice.unfunded.is_empty());
}

#[test]
fn there_is_no_changeless_batch_the_bridge_keeps_at_least_dust() {
    let p = live();
    let reserve = [input(1, 10_000)];
    let one = |amount| choose(&p, &reserve, &[pay(1, &p2wpkh(), amount, 1000)]);
    // Change of exactly `dust` is the boundary.
    assert_eq!(one(8620).plan.unwrap().change, 1000);
    // One satoshi more, anything up to the exact spend (10,000 - 380), and beyond: all wait.
    // A remainder below dust is never added to the fee and never paid out.
    for amount in [8621, 9000, 9619, 9620, 9621, 10_000] {
        let choice = one(amount);
        assert_eq!((choice.plan, choice.unfunded), (None, vec![1]), "{amount}");
    }
    // With another output available, a remainder below dust draws a further input instead.
    let two = [input(1, 10_000), input(2, 5_000)];
    let plan = choose(&p, &two, &[pay(1, &p2wpkh(), 9000, 1000)]).plan.unwrap();
    assert_eq!((plan.inputs.len(), plan.fee, plan.change), (2, 590, 5410));
    // A lower dust limit moves the boundary and nothing else: 10,000 - 380 - 546.
    let low = Policy { dust: 546, ..live() };
    assert!(choose(&low, &reserve, &[pay(1, &p2wpkh(), 9074, 1000)]).plan.is_some());
    assert_eq!(choose(&low, &reserve, &[pay(1, &p2wpkh(), 9075, 1000)]).unfunded, vec![1]);
}

#[test]
fn several_inputs_and_the_input_limit() {
    let p = live();
    let small: Vec<_> = (1..=5).map(|n| input(n, 3000)).collect();
    let plan = choose(&p, &small, &[pay(1, &p2wpkh(), 11_000, 2000)]).plan.unwrap();
    assert_eq!(plan.inputs.len(), 5);
    assert_eq!(plan.fee, budgeted_weight(5, &[22]).div_ceil(4) * 2);
    assert_eq!(plan.change, 15_000 - 11_000 - plan.fee);
    // Oldest outputs first.
    assert_eq!(plan.inputs.iter().map(|i| i.height).collect::<Vec<_>>(), vec![101, 102, 103, 104, 105]);
    // The same reserve under a limit of three inputs per batch can pay less; the request waits.
    let three = Policy { max_inputs: 3, ..live() };
    assert_eq!(choose(&three, &small, &[pay(1, &p2wpkh(), 11_000, 2000)]).unfunded, vec![1]);
    let most = 9000 - budgeted_weight(3, &[22]).div_ceil(4) * 2 - 1000;
    assert!(choose(&three, &small, &[pay(1, &p2wpkh(), most, 2000)]).plan.is_some());
    assert_eq!(choose(&three, &small, &[pay(1, &p2wpkh(), most + 1, 2000)]).unfunded, vec![1]);
}

#[test]
fn fee_caps_and_the_reserve_are_handled_together() {
    let p = Policy { batch_size: 8, ..live() };
    let reserve = [input(1, 10_000)];
    let requests = [
        pay(1, &p2wpkh(), 9510, 1000), // waits for the reserve
        pay(2, &p2wpkh(), 3000, 221),  // its share with a taproot payment is 233
        pay(3, &p2tr(), 3000, 1000),
    ];
    let choice = choose(&p, &reserve, &requests);
    assert_eq!((choice.unfunded.clone(), choice.over_fee_cap.clone(), paid(&choice)), (vec![1], vec![2], vec![3]));
    assert_eq!(choice.plan.unwrap().fees, vec![404]);
    // Every allowance too small: nothing is paid, nothing fails.
    let none = choose(&p, &reserve, &[pay(2, &p2wpkh(), 3000, 1), pay(3, &p2tr(), 3000, 1)]);
    assert_eq!((none.plan, none.over_fee_cap, none.unfunded), (None, vec![2, 3], vec![]));
    // An empty reserve: everything waits.
    let empty = choose(&p, &[], &requests);
    assert_eq!((empty.plan, empty.unfunded, empty.over_fee_cap), (None, vec![1, 2, 3], vec![]));
}

#[test]
fn no_well_formed_request_makes_the_choice_fail_and_each_is_in_one_place() {
    let p = Policy { batch_size: 4, ..live() };
    let reserves: [&[u64]; 4] = [&[], &[10_000], &[3000, 3000, 3000], &[1500, 50_000]];
    let amounts = [1000u64, 2500, 8620, 9510, 60_000];
    let allowances = [1u64, 221, 400, 5000];
    let mut cases = 0;
    for values in reserves {
        let reserve: Vec<_> = values.iter().enumerate().map(|(n, v)| input(n as u8 + 1, *v)).collect();
        for a in 0..amounts.len() {
            for b in 0..amounts.len() {
                for fee in allowances {
                    let requests = [
                        pay(1, &p2wpkh(), amounts[a], fee),
                        pay(2, &p2tr(), amounts[b], 5000),
                        pay(3, &p2wpkh(), amounts[(a + b) % 5], fee),
                    ];
                    let choice = choose_batch(&p, 1, &reserve, &requests).unwrap();
                    let paid = paid(&choice);
                    for r in &requests {
                        let places = [&paid, &choice.unfunded, &choice.over_fee_cap]
                            .iter()
                            .filter(|list| list.contains(&r.id))
                            .count();
                        assert!(places <= 1);
                        if choice.unfunded.contains(&r.id) {
                            assert!(!fundable_alone(&p, 1, &reserve, r).unwrap());
                        }
                    }
                    if let Some(plan) = &choice.plan {
                        check_plan(&p, plan).unwrap();
                        assert!(plan.change >= p.dust);
                        assert!(plan.payments.iter().zip(&plan.fees).all(|(r, f)| *f <= r.max_fee));
                    }
                    cases += 1;
                }
            }
        }
    }
    assert_eq!(cases, 400);
    // A malformed stored request is a defect, reported as an error, not a set-aside.
    let mut bad = pay(1, &p2wpkh(), 5000, 1000);
    bad.script = "zz".into();
    assert!(choose_batch(&p, 1, &[input(1, 10_000)], &[bad]).is_err());
}
