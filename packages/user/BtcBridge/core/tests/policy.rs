//! Changing the bridge policy after initialization, and the fee arithmetic the limits rest on.
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

#[test]
fn test_minimums_change_on_test_networks_only() {
    let current = signet();
    let new = live();
    assert_eq!((new.min_deposit, new.min_withdrawal), (1000, 1000));
    // Nothing else moves: not the network, the custody keys, the fees, dust or batching.
    assert_eq!(
        Policy { min_deposit: current.min_deposit, min_withdrawal: current.min_withdrawal, ..new.clone() },
        current
    );
    let regtest = policy("regtest", Network::Regtest);
    assert_eq!(with_test_minimums(&regtest, 5000, 2000).unwrap().min_withdrawal, 2000);
    // Raising is allowed too.
    with_test_minimums(&new, 50_000, 100_000).unwrap();
    // Mainnet: refused, even for the values it already has.
    let mainnet = policy("bitcoin", Network::Bitcoin);
    mainnet.validate().unwrap();
    for (deposit, withdrawal) in [(1000, 10000), (1000, 1000), (50_000, 50_000)] {
        assert_eq!(
            with_test_minimums(&mainnet, deposit, withdrawal).unwrap_err(),
            "Limits are fixed on mainnet"
        );
    }
    // A stored policy with any other network name is not a test network either.
    let unknown = Policy { network: "Bitcoin".into(), ..current.clone() };
    assert!(with_test_minimums(&unknown, 1000, 1000).is_err());
    // The floor of 1,000 sat stands.
    for (deposit, withdrawal) in [(999, 1000), (1000, 999), (0, 0)] {
        assert_eq!(
            with_test_minimums(&current, deposit, withdrawal).unwrap_err(),
            "Unsafe bridge policy limits"
        );
    }
    // A deposit must be worth more than its custody output costs to spend (105 vB at the fee rate).
    assert_eq!((input_cost(1), input_cost(2)), (105, 210));
    let dear = Policy { fee_rate: 20, ..current.clone() };
    assert_eq!(
        with_test_minimums(&dear, 2099, 1000).unwrap_err(),
        "Minimum deposit does not cover the cost of spending it"
    );
    with_test_minimums(&dear, 2100, 1000).unwrap();
}

#[test]
fn the_budgeted_fee_and_the_least_share() {
    let p = live();
    let fee = |inputs: &[Input], payments: &[Payment]| quote_plan(&p, 1, inputs, payments).unwrap().fee;
    let big = [input(1, 1_000_000)];
    // One request, one input, at 2 sat/vB: 190 vB to a P2WPKH address, 202 vB to a P2TR one.
    assert_eq!(fee(&big, &[pay(1, &p2wpkh(), 5000, 1000)]), 380);
    assert_eq!(fee(&big, &[pay(1, &p2tr(), 5000, 1000)]), 404);
    assert_eq!(budgeted_weight(1, &[22]).div_ceil(4), 190);
    assert_eq!(budgeted_weight(1, &[34]).div_ceil(4), 202);
    // Two requests in one batch share 221 vB: 221 sat each. That is the least a request to a
    // P2WPKH address can be charged while batches hold two requests.
    let two = quote_plan(&p, 1, &big, &[pay(1, &p2wpkh(), 5000, 1000), pay(2, &p2wpkh(), 5000, 1000)]).unwrap();
    assert_eq!((two.fee, two.fees.clone()), (442, vec![221, 221]));
    assert_eq!(least_fee_share(&p, 22), 221);
    assert_eq!(least_fee_share(&p, 34), 233);
    // The budget formula is the planner's, for more inputs and mixed destinations as well.
    let small: Vec<_> = (1..=5).map(|n| input(n, 3000)).collect();
    for (inputs, amount) in [(2u64, 3000u64), (3, 6000), (5, 11000)] {
        let plan = quote_plan(&p, 1, &small, &[pay(1, &p2tr(), amount, 9000), pay(2, &p2wpkh(), 1000, 9000)]).unwrap();
        assert_eq!(plan.inputs.len() as u64, inputs);
        assert_eq!(plan.fee, budgeted_weight(inputs, &[34, 22]).div_ceil(4) * 2);
    }
}

#[test]
fn withdrawals_at_the_live_minimum_and_of_a_faucet_deposit() {
    let p = live();
    // The recipient output is the amount itself; the fee comes from the requester's allowance.
    // 1,000 sat from a reserve with room: 1,000 paid, 380 fee, so 1,000 + 380 + 100 are spent.
    let roomy = [input(1, 100_000)];
    let plan = build_plan(&p, 1, &roomy, &[pay(1, &p2wpkh(), 1000, 380)]).unwrap();
    assert_eq!((plan.fee, plan.fees.clone(), plan.change), (380, vec![380], 98_620));
    // An allowance one satoshi short is a refusal of the plan (the service sets the request aside).
    assert!(build_plan(&p, 1, &roomy, &[pay(1, &p2wpkh(), 1000, 379)]).is_err());

    // The whole reserve is one 10,000 sat deposit; its owner was credited 9,990. The bridge
    // always keeps `dust` (1,000 here) as change, so at most 10,000 - 380 - 1,000 can be paid.
    let reserve = [input(1, 10_000)];
    let plan = build_plan(&p, 1, &reserve, &[pay(1, &p2wpkh(), 8620, 380)]).unwrap();
    assert_eq!((plan.fee, plan.change), (380, 1000));
    assert_eq!(
        build_plan(&p, 1, &reserve, &[pay(1, &p2wpkh(), 8621, 380)]).unwrap_err(),
        "Insufficient confirmed UTXOs (including economical change and fees)"
    );
    // To a taproot address: fee 404, at most 8,596.
    assert!(build_plan(&p, 1, &reserve, &[pay(1, &p2tr(), 8596, 404)]).is_ok());
    assert!(build_plan(&p, 1, &reserve, &[pay(1, &p2tr(), 8597, 404)]).is_err());
    // The balance would allow more (9,990 - 100 - 380 = 9,510): the reserve is the limit.
    assert!(8620 + 380 + p.service_fee <= 9990);
    // The 1,000 sat minimum from that same reserve works as well.
    assert!(build_plan(&p, 1, &reserve, &[pay(1, &p2wpkh(), 1000, 380)]).is_ok());
}

#[test]
fn requests_queued_before_a_change_are_still_paid() {
    let reserve = [input(1, 1_000_000)];
    // Queued when the minimum was 1,000; the minimum is 10,000 when the batch is made.
    let raised = with_test_minimums(&live(), 1000, 10000).unwrap();
    let plan = build_plan(&raised, 1, &reserve, &[pay(1, &p2wpkh(), 1000, 1000)]).unwrap();
    check_plan(&raised, &plan).unwrap();
    // The fixed floor still holds for whatever reaches a batch.
    assert_eq!(MIN_PAYMENT, 1000);
    assert!(build_plan(&raised, 1, &reserve, &[pay(1, &p2wpkh(), 999, 1000)]).is_err());
}
