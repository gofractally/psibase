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

impl PartialEq for Attestation {
    fn eq(&self, other: &Self) -> bool {
        self.attester == other.attester
    }
}

// #[derive(Deserialize, Debug, Clone)]
// struct AttestationQueryData {
//     nodes: Vec<Attestation>,
// }

// #[derive(Deserialize, Debug, Clone)]
// struct AttestationReply {
//     data: AttestationQueryData,
// }

pub fn expect_attestations(chain: &psibase::Chain, exp_results: &serde_json::Value) {
    use serde_json::Value;

    let att_results: Value = chain.graphql(
            SERVICE,
            r#"query { attestationsByAttestee(attestee: "bob") { nodes { attester, subject, value } } }"#,
        ).unwrap();
    println!("graphql reply: {}", att_results);

    let mut att_results_sorted = serde_json::from_value::<Vec<Attestation>>(
        att_results["data"]["attestationsByAttestee"]["nodes"].clone(),
    )
    .unwrap();
    att_results_sorted.sort_by(|a, b| a.attester.cmp(&b.attester));

    let mut exp_results_sorted =
        serde_json::from_value::<Vec<Attestation>>(exp_results.clone()).unwrap();
    exp_results_sorted.sort_by(|a, b| a.attester.cmp(&b.attester));

    println!("sorted attestation nodes: {:#?}", att_results_sorted);
    println!("sorted expected results: {:#?}", exp_results_sorted);
    assert!(att_results_sorted == exp_results_sorted);
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
