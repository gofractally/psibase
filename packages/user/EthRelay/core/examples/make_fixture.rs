//! Public synthetic beacon commitments around real local-EVM execution evidence.
use blst::min_pk::*;
use ethrelay_core::*;
use serde_json::{json, Value};
fn subtree(index: u64, depth: u32, leaves: &[(u64, Hash)]) -> Hash {
    if let Some((_, v)) = leaves.iter().find(|(i, _)| *i == index) {
        return *v;
    }
    if depth == 0 {
        return [0; 32];
    }
    pair(
        subtree(index * 2, depth - 1, leaves),
        subtree(index * 2 + 1, depth - 1, leaves),
    )
}
pub(crate) fn merkle(index: u64, leaves: &[(u64, Hash)]) -> (Hash, Vec<String>) {
    let max = leaves
        .iter()
        .map(|(i, _)| 63 - i.leading_zeros())
        .max()
        .unwrap();
    let mut i = index;
    let mut branch = vec![];
    while i > 1 {
        let depth = max - (63 - i.leading_zeros());
        branch.push(hex(subtree(i ^ 1, depth, leaves)));
        i /= 2;
    }
    (subtree(1, max, leaves), branch)
}
pub(crate) fn committee(seed: u8) -> (SecretKey, Committee) {
    let sk = SecretKey::key_gen(&[seed; 32], &[]).unwrap();
    let pk = sk.sk_to_pk();
    let keys = vec![pk; 512];
    let agg = AggregatePublicKey::aggregate(&keys.iter().collect::<Vec<_>>(), true)
        .unwrap()
        .to_public_key();
    (
        sk,
        Committee {
            pubkeys: keys.iter().map(|p| hex(p.to_bytes())).collect(),
            aggregate_pubkey: hex(agg.to_bytes()),
        },
    )
}
pub(crate) fn execution(block: &Value) -> (Execution, String) {
    let mut fields = vec!["00".repeat(32); 17];
    for (index, key) in [
        (0, "parent_hash"),
        (2, "state_root"),
        (3, "receipts_root"),
        (12, "hash"),
    ] {
        fields[index] = block[key].as_str().unwrap().into();
    }
    fields[6] = hex(uint(block["number"].as_u64().unwrap()));
    let root = tree(fields.iter().map(|f| bytes(f).unwrap()).collect());
    let (body, branch) = merkle(25, &[(25, root)]);
    (Execution { fields, branch }, hex(body))
}
pub(crate) fn beacon(slot: u64, state: Hash, body: String) -> Beacon {
    Beacon {
        slot,
        proposer_index: 0,
        parent_root: "00".repeat(32),
        state_root: hex(state),
        body_root: body,
    }
}
pub(crate) fn update(
    network: &Network,
    committee: &Committee,
    sk: &SecretKey,
    next: &Committee,
    slot: u64,
    block: &Value,
) -> Update {
    let (execution, body) = execution(block);
    let finalized = beacon(slot, [9; 32], body);
    let nextroot = next.root().unwrap();
    let leaves = [(169, finalized.root().unwrap()), (87, nextroot)];
    let (state, finality_branch) = merkle(169, &leaves);
    let (_, next_branch) = merkle(87, &leaves);
    let attested = beacon(slot + 2, state, "00".repeat(32));
    let signature_slot = slot + 3;
    let message = network.signing_root(&attested, signature_slot).unwrap();
    let sig = sk.sign(
        &message,
        b"BLS_SIG_BLS12381G2_XMD:SHA-256_SSWU_RO_POP_",
        &[],
    );
    let sigs = vec![sig; 512];
    let signature = AggregateSignature::aggregate(&sigs.iter().collect::<Vec<_>>(), true)
        .unwrap()
        .to_signature();
    Update {
        network: network.clone(),
        committee: committee.clone(),
        attested,
        finalized,
        finality_branch,
        signature_slot,
        bits: "ff".repeat(64),
        signature: hex(signature.to_bytes()),
        next: Some(next.clone()),
        next_branch,
        execution,
    }
}
fn main() {
    let evm: Value = serde_json::from_str(
        &std::fs::read_to_string("demo/ethbridge/vault-fixture.json").unwrap(),
    )
    .unwrap();
    let network = Network {
        genesis_root: "01".repeat(32),
        genesis_time: 1_700_000_000,
        forks: vec![Fork {
            epoch: 0,
            version: "05000000".into(),
            electra: true,
        }],
    };
    let (sk, a) = committee(41);
    let (sk_b, b) = committee(42);
    let (_, c) = committee(43);
    let (execution, body) = execution(&evm["config"]["block"]);
    let leaves = [(86, a.root().unwrap())];
    let (state, committee_branch) = merkle(86, &leaves);
    let header = beacon(9000, state, body);
    let bootstrap = Witness::Bootstrap(Bootstrap {
        network: network.clone(),
        header,
        committee: a.clone(),
        committee_branch,
        execution,
    });
    let first = Witness::Update(update(
        &network,
        &a,
        &sk,
        &b,
        9010,
        &evm["deposit"]["block"],
    ));
    let second = Witness::Update(update(
        &network,
        &a,
        &sk,
        &b,
        9020,
        &evm["completed"]["block"],
    ));
    let rotate = Witness::Update(update(
        &network,
        &b,
        &sk_b,
        &c,
        16390,
        &evm["completed"]["block"],
    ));
    let mut result = json!({"network":network,"evm":evm,"proofs":{}});
    for (name, witness) in [
        ("bootstrap", bootstrap),
        ("deposit_update", first),
        ("completed_update", second),
        ("rotation", rotate),
    ] {
        let fact = witness.check().unwrap();
        result["proofs"][name] =
            json!({"witness":witness,"fact":fact,"claim":hex(fact.commitment())});
    }
    for name in ["account", "config", "deposit", "completed"] {
        let witness: Witness = serde_json::from_value(if name == "account" {
            result["evm"][name].clone()
        } else {
            result["evm"][name]["witness"].clone()
        })
        .unwrap();
        let fact = witness.check().unwrap();
        result["proofs"][name] =
            json!({"witness":witness,"fact":fact,"claim":hex(fact.commitment())});
    }
    std::fs::write(
        "demo/ethbridge/relay-fixture.json",
        serde_json::to_string_pretty(&result).unwrap() + "\n",
    )
    .unwrap();
    println!("Generated real EVM receipt/account proofs and synthetic signed beacon fixtures");
}
