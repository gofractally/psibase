use super::*;

use serde_json::{json, Value};
fn fixture() -> Value {
    serde_json::from_str(include_str!(
        "../../../../../demo/ethbridge/relay-fixture.json"
    ))
    .unwrap()
}
fn fact(f: &Value, name: &str) -> String {
    serde_json::to_string(&f["proofs"][name]["fact"]).unwrap()
}
fn push(chain: &Chain, actions: Vec<Action>, proofs: &[Value]) -> TransactionTrace {
    let mut trx = Transaction {
        actions,
        ..Default::default()
    };
    let mut witnesses = vec![];
    for p in proofs {
        trx.claims.push(Claim {
            service: account!("verify-eth"),
            rawData: eth::bytes::<32>(p["claim"].as_str().unwrap())
                .unwrap()
                .to_vec()
                .into(),
        });
        witnesses.push(serde_json::to_vec(&p["witness"]).unwrap().into());
    }
    chain.fill_tapos(&mut trx, 120);
    // Distinct transactions must reach the application's permanent replay guards.
    // Reusing the same TAPOS would only exercise Transact's duplicate cache.
    std::thread_local! { static SERIAL: std::cell::Cell<i64> = const { std::cell::Cell::new(0) }; }
    trx.tapos.expiration += psibase::Seconds::from_ticks(SERIAL.with(|s| {
        let n = s.get() + 1;
        s.set(n);
        n
    }));
    let trace = chain.push(&SignedTransaction {
        transaction: psio::pssz::Nested::new(&trx).unwrap(),
        proofs: witnesses,
        subjectiveData: None,
    });
    let proof_ns: i64 = trace
        .action_traces
        .iter()
        .filter(|a| a.action.service == account!("verify-eth"))
        .map(|a| a.total_time.ticks())
        .sum();
    let objective_ns: i64 = trace
        .action_traces
        .iter()
        .filter(|a| a.action.service != account!("verify-eth"))
        .map(|a| a.total_time.ticks())
        .sum();
    println!(
        "ETH_BRIDGE_METRIC {}",
        json!({"proof_ns":proof_ns,"objective_ns":objective_ns,"error":trace.error})
    );
    trace
}
fn at(chain: &Chain, slot: u64) {
    chain.start_block_at(
        TimePointSec::from_ticks((1_700_000_000 + slot * 12) as i64)
        .to_unit::<psibase::psio::time::Micros>().unwrap(),
    );
}
fn boot(chain: &Chain, f: &Value) -> Result<(), Error> {
    at(chain, 9001);
    let action = ethrelay::Wrapper::pack_from(ethrelay::SERVICE).init(
        serde_json::to_string(&f["network"]).unwrap(),
        f["proofs"]["bootstrap"]["fact"]["fact"]["beacon"]
            .as_str()
            .unwrap()
            .into(),
        fact(f, "bootstrap"),
        32,
        57344,
        256,
    );
    push(chain, vec![action], &[f["proofs"]["bootstrap"].clone()]).ok()?;
    Ok(())
}
#[psibase::test_case(packages("EthBridge", "Signing"))]
fn proof_rejection_and_objective_commitment_binding(chain: Chain) -> Result<(), Error> {
    let f = fixture();
    at(&chain, 9001);
    let init = || {
        ethrelay::Wrapper::pack_from(ethrelay::SERVICE).init(
            serde_json::to_string(&f["network"]).unwrap(),
            f["proofs"]["bootstrap"]["fact"]["fact"]["beacon"]
                .as_str()
                .unwrap()
                .into(),
            fact(&f, "bootstrap"),
            32,
            57344,
            256,
        )
    };
    assert!(push(&chain, vec![init()], &[]).error.is_some());
    assert!(chain
        .open::<_, ethrelay::RelayTable>()
        .get_index_pk()
        .get(&())
        .is_none());
    let mut bad = f["proofs"]["bootstrap"].clone();
    bad["witness"]["witness"]["committee_branch"][0] = json!("ff".repeat(32));
    assert!(push(&chain, vec![init()], &[bad]).error.is_some());
    assert!(chain
        .open::<_, ethrelay::RelayTable>()
        .get_index_pk()
        .get(&())
        .is_none());
    push(&chain, vec![init()], &[f["proofs"]["bootstrap"].clone()]).ok()?;
    at(&chain, 9014);
    let action = ethrelay::Wrapper::pack_from(account!("alice")).update(fact(&f, "deposit_update"));
    chain.new_account(account!("alice"))?;
    let unknown = chain.fork();
    at(&unknown, 16394);
    let untrusted = ethrelay::Wrapper::pack_from(account!("alice")).update(fact(&f, "rotation"));
    assert!(push(
        &unknown,
        vec![untrusted],
        &[f["proofs"]["rotation"].clone()]
    )
    .error_text()
    .unwrap()
    .contains("Unauthenticated signing committee"));
    assert_eq!(
        unknown
            .open::<_, ethrelay::RelayTable>()
            .get_index_pk()
            .get(&())
            .unwrap()
            .finalized_slot,
        9000
    );

    // A valid unrelated proof cannot authorize this finality update.
    assert!(push(
        &chain,
        vec![action.clone()],
        &[f["proofs"]["deposit"].clone()]
    )
    .error
    .is_some());
    let mut bad = f["proofs"]["deposit_update"].clone();
    bad["witness"]["witness"]["signature"] = json!("ff".repeat(96));
    assert!(push(&chain, vec![action.clone()], &[bad]).error.is_some());
    push(
        &chain,
        vec![action],
        &[f["proofs"]["deposit_update"].clone()],
    )
    .ok()?;
    assert_eq!(
        chain
            .open::<_, ethrelay::RelayTable>()
            .get_index_pk()
            .get(&())
            .unwrap()
            .finalized_slot,
        9010
    );
    at(&chain, 16394);
    let action = ethrelay::Wrapper::pack_from(account!("alice")).update(fact(&f, "rotation"));
    push(&chain, vec![action], &[f["proofs"]["rotation"].clone()]).ok()?;
    let state = chain
        .open::<_, ethrelay::RelayTable>()
        .get_index_pk()
        .get(&())
        .unwrap();
    assert_eq!(state.period, 2);
    assert_eq!(
        chain
            .open::<_, ethrelay::HeaderTable>()
            .get_index_pk()
            .iter()
            .count(),
        3
    );
    Ok(())
}
#[psibase::test_case(packages("EthBridge", "Signing"))]
fn backed_deposit_deterministic_signing_and_finalized_withdrawal(
    chain: Chain,
) -> Result<(), Error> {
    let f = fixture();
    boot(&chain, &f)?;
    let owner = account!("alice");
    let treasury = account!("treasury");
    let publisher = account!("publisher");
    let providers = vec![account!("sigone"), account!("sigtwo"), account!("sigtri")];
    for user in [
        owner,
        treasury,
        publisher,
        providers[0],
        providers[1],
        providers[2],
    ] {
        chain.new_account(user)?;
        Tokens::push_from(&chain, user).setUserConf(0, true).get()?;
    }
    signing::Wrapper::push_from(&chain, signing::SERVICE)
        .init("11".repeat(32), providers.clone())
        .get()?;
    let keys = Wrapper::push_from(&chain, SERVICE)
        .requestKeys(providers.clone())
        .get()?;
    assert_eq!(keys, vec![1, 2, 3]);
    chain.start_block();
    chain.start_block();
    for (i, key) in keys.iter().enumerate() {
        let root = signing_core::public_key(&format!("{:02x}", i + 1).repeat(32), *key).unwrap();
        signing::Wrapper::push_from(&chain, providers[i])
            .publishKey(*key, root)
            .get()?;
    }
    let config_block = f["evm"]["config"]["block"]["hash"]
        .as_str()
        .unwrap()
        .to_string();
    let action = Wrapper::pack_from(SERVICE).init(
        1337,
        f["evm"]["deployment"].as_str().unwrap().into(),
        f["evm"]["vault"].as_str().unwrap().into(),
        config_block,
        fact(&f, "account"),
        fact(&f, "config"),
        treasury,
        1,
        1000,
    );
    push(
        &chain,
        vec![action],
        &[
            f["proofs"]["account"].clone(),
            f["proofs"]["config"].clone(),
        ],
    )
    .ok()?;
    at(&chain, 9014);
    push(
        &chain,
        vec![ethrelay::Wrapper::pack_from(publisher).update(fact(&f, "deposit_update"))],
        &[f["proofs"]["deposit_update"].clone()],
    )
    .ok()?;
    let block = f["evm"]["deposit"]["block"]["hash"]
        .as_str()
        .unwrap()
        .to_string();
    let deposit = Wrapper::pack_from(publisher).deposit(block, fact(&f, "deposit"));
    push(
        &chain,
        vec![deposit.clone()],
        &[f["proofs"]["deposit"].clone()],
    )
    .ok()?;
    assert!(
        push(&chain, vec![deposit], &[f["proofs"]["deposit"].clone()])
            .error_text()
            .unwrap()
            .contains("ETH deposit already credited")
    );
    let c = chain
        .open::<_, ConfigTable>()
        .get_index_pk()
        .get(&())
        .unwrap();
    assert_eq!((c.reserve, c.liability), (1000000, 1000000));
    let p = chain
        .open::<_, DepositTable>()
        .get_index_pk()
        .get(&1)
        .unwrap();
    assert_eq!((p.credited, p.fee, p.bounty), (999000, 1000, 500));
    Tokens::push_from(&chain, owner)
        .credit(
            c.token,
            SERVICE,
            801000u64.into(),
            "Authorize withdrawal".into(),
        )
        .get()?;
    let request = Wrapper::push_from(&chain, owner)
        .withdraw(
            f["evm"]["payments"][0]["address"].as_str().unwrap().into(),
            800000,
        )
        .get()?;
    let committed = Wrapper::push_from(&chain, publisher).makeBatch();
    println!(
        "ETH_BRIDGE_DIRECT_METRIC {}",
        json!({"operation":"makeBatch","objective_ns":committed.trace.action_traces.iter().map(|a|a.total_time.ticks()).sum::<i64>()})
    );
    let batch = committed.get()?;
    assert_eq!(batch, 0);
    assert!(Wrapper::push_from(&chain, owner)
        .cancel(request)
        .trace
        .error
        .is_some());
    let b = chain
        .open::<_, BatchTable>()
        .get_index_pk()
        .get(&0)
        .unwrap();
    assert_eq!(b.digest, f["evm"]["digest"]);
    chain.start_block();
    chain.start_block();
    for i in 0..2 {
        let sig = signing_core::sign(
            &format!("{:02x}", i + 1).repeat(32),
            (i + 1) as u32,
            &[0, 0],
            &b.digest,
        )
        .unwrap();
        signing::Wrapper::push_from(&chain, providers[i])
            .publishSig(b.signing_requests[i], sig)
            .get()?;
        let gathered = Wrapper::push_from(&chain, publisher).gather(0, i as u8);
        println!(
            "ETH_BRIDGE_DIRECT_METRIC {}",
            json!({"operation":"gather","objective_ns":gathered.trace.action_traces.iter().map(|a|a.total_time.ticks()).sum::<i64>()})
        );
        gathered.get()?;
    }
    let b = chain
        .open::<_, BatchTable>()
        .get_index_pk()
        .get(&0)
        .unwrap();
    assert_eq!(b.calldata, f["evm"]["calldata"]);
    assert_eq!(b.signatures.iter().filter(|s| !s.is_empty()).count(), 2);
    at(&chain, 9024);
    push(
        &chain,
        vec![ethrelay::Wrapper::pack_from(publisher).update(fact(&f, "completed_update"))],
        &[f["proofs"]["completed_update"].clone()],
    )
    .ok()?;
    let complete = Wrapper::pack_from(publisher).complete(
        0,
        f["evm"]["completed"]["block"]["hash"]
            .as_str()
            .unwrap()
            .into(),
        fact(&f, "completed"),
    );
    push(
        &chain,
        vec![complete.clone()],
        &[f["proofs"]["completed"].clone()],
    )
    .ok()?;
    assert!(
        push(&chain, vec![complete], &[f["proofs"]["completed"].clone()])
            .error_text()
            .unwrap()
            .contains("ETH batch already completed")
    );
    let c = chain
        .open::<_, ConfigTable>()
        .get_index_pk()
        .get(&())
        .unwrap();
    assert_eq!(
        (c.reserve, c.liability, c.escrow, c.active, c.next_batch),
        (200000, 200000, 0, None, 1)
    );
    Ok(())
}
