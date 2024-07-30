use crate::SERVICE;
use psibase::services::http_server;
use psibase::AccountNumber;
use serde::Deserialize;
use serde_json::json;

pub fn test_attest(
    chain: &psibase::Chain,
    attester: AccountNumber,
    subject: String,
    conf: u8,
) -> Result<(), psibase::Error> {
    println!("top of test_attest()");
    http_server::Wrapper::push_from(&chain, SERVICE).registerServer(SERVICE);
    println!("1");
    let result = crate::Wrapper::push_from(&chain, attester).attest(subject.clone(), conf);
    println!("2");
    assert_eq!(result.get()?, ());
    println!("\n\nTrace:\n{}", result.trace);

    chain.finish_block();
    Ok(())
}

#[derive(Deserialize, Debug, Clone)]
struct Attestation {
    attester: String,
    subject: String,
    value: u8,
}

#[derive(Deserialize, Debug, Clone)]
struct AttestationQueryData {
    nodes: Vec<Attestation>,
}

#[derive(Deserialize, Debug, Clone)]
struct AttestationReply {
    data: AttestationQueryData,
}

pub fn expect_attestations(chain: &psibase::Chain, expected_results: &serde_json::Value) {
    use serde_json::{json, Value};

    let attestation_reply: Value = chain.graphql(
            SERVICE,
            r#"query { attestationsByAttestee(attestee: "bob") { nodes { attester, subject, value } } }"#,
        ).unwrap();
    println!("graphql reply: {}", attestation_reply);
    let mut attest_nodes_sorted = attestation_reply["data"]["attestationsByAttestee"]["nodes"]
        .as_array()
        .unwrap()
        .clone();
    attest_nodes_sorted.sort_by(|a, b| {
        serde_json::from_value::<Attestation>(a.clone())
            .unwrap()
            .attester
            .cmp(
                &serde_json::from_value::<Attestation>(b.clone())
                    .unwrap()
                    .attester,
            )
    });

    let mut expected_results_sorted = expected_results.as_array().unwrap().clone();
    expected_results_sorted.sort_by(|a, b| {
        serde_json::from_value::<Attestation>(a.clone())
            .unwrap()
            .attester
            .cmp(
                &serde_json::from_value::<Attestation>(b.clone())
                    .unwrap()
                    .attester,
            )
    });
    println!("sorted attestation nodes: {:#?}", attest_nodes_sorted);
    println!("sorted expected results: {:#?}", expected_results_sorted);
    assert_eq!(
        attestation_reply,
        json!({ "data": { "attestationsByAttestee": { "nodes": expected_results } } }) // json!({ "data": { "attestationsByAttestee": { "nodes": [{"attester": "alice", "subject": "bob", "value": 75}] } } })
    );
}

pub fn expect_attestation_stats(chain: &psibase::Chain, expected_results: &serde_json::Value) {
    use serde_json::{json, Value};

    let reply: Value = chain
        .graphql(
            SERVICE,
            r#"query { allAttestationStats { subject, uniqueAttesters, percHighConf } }"#,
        )
        .unwrap();
    println!("graphql reply: {}", reply);
    assert_eq!(
        reply,
        json!({ "data": { "allAttestationStats": expected_results } })
    );
}
