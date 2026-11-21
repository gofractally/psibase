//! TEST ONLY: synthetic beacon commitments around a private local EVM.
//! Never configure this known committee or network as an Ethereum mainnet anchor.
#[allow(dead_code)]
#[path = "make_fixture.rs"]
mod fixture;
use ethrelay_core::*;
use serde_json::Value;
use std::io::Read;
fn main() {
    let mut data = String::new();
    std::io::stdin().read_to_string(&mut data).unwrap();
    let v: Value = serde_json::from_str(&data).unwrap();
    let network: Network = serde_json::from_value(v["network"].clone()).unwrap();
    let slot = v["slot"].as_u64().unwrap();
    let period = if v["bootstrap"] == true {
        slot / PERIOD
    } else {
        (slot + 3) / PERIOD
    };
    let (sk, committee) = fixture::committee(41 + (period % 128) as u8);
    let (_, next) = fixture::committee(41 + (((slot + 2) / PERIOD + 1) % 128) as u8);
    let witness = if v["bootstrap"] == true {
        let (execution, body) = fixture::execution(&v["block"]);
        let leaves = [(86, committee.root().unwrap())];
        let (state, committee_branch) = fixture::merkle(86, &leaves);
        Witness::Bootstrap(Bootstrap {
            network,
            header: fixture::beacon(slot, state, body),
            committee,
            committee_branch,
            execution,
        })
    } else {
        Witness::Update(fixture::update(
            &network,
            &committee,
            &sk,
            &next,
            slot,
            &v["block"],
        ))
    };
    let fact = witness.check().unwrap();
    println!(
        "{}",
        serde_json::json!({"witness":witness,"fact":fact,"claim":hex(fact.commitment())})
    );
}
