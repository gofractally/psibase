use crate::SERVICE;
use psibase::services::http_server;
use psibase::AccountNumber;
use serde::Deserialize;
use serde_json::json;

pub fn test_attest(
    chain: &psibase::Chain,
    attester: AccountNumber,
    subject: AccountNumber,
    conf: u8,
) -> Result<(), psibase::Error> {
    http_server::Wrapper::push_from(&chain, SERVICE).registerServer(SERVICE);
    crate::Wrapper::push_from(&chain, attester)
        .attest(subject.clone(), conf)
        .get()?;

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

pub fn expect_from_query(
    chain: &psibase::Chain,
    query_name: &str,
    graphql_query: String,
    exp_results: &serde_json::Value,
) {
    use serde_json::Value;

    println!("{}", query_name);
    println!("{}", graphql_query);
    println!("{}", exp_results);
    let att_results: Value = chain.graphql(SERVICE, &graphql_query).unwrap();

    let att_result =
        serde_json::from_value::<Attestation>(att_results["data"][query_name]["nodes"].clone())
            .unwrap();

    let exp_result = serde_json::from_value::<Attestation>(exp_results.clone()).unwrap();

    assert_eq!(att_result, exp_result);
}

pub fn expect_from_query_array(
    chain: &psibase::Chain,
    query_name: &str,
    graphql_query: String,
    exp_results: &serde_json::Value,
) {
    use serde_json::Value;

    let att_results: Value = chain.graphql(SERVICE, &graphql_query).unwrap();

    let mut att_results_sorted = serde_json::from_value::<Vec<Attestation>>(
        att_results["data"][query_name]["nodes"].clone(),
    )
    .unwrap();
    att_results_sorted.sort_by(|a, b| a.attester.cmp(&b.attester));

    let mut exp_results_sorted =
        serde_json::from_value::<Vec<Attestation>>(exp_results.clone()).unwrap();
    exp_results_sorted.sort_by(|a, b| a.attester.cmp(&b.attester));

    assert_eq!(att_results_sorted, exp_results_sorted);
}

pub fn expect_attestations(chain: &psibase::Chain, exp_results: &serde_json::Value) {
    use serde_json::Value;

    let att_results: Value = chain.graphql(
            SERVICE,
            r#"query { attestationsByAttestee(attestee: "bob") { nodes { attester, subject, value } } }"#,
        ).unwrap();

    let mut att_results_sorted = serde_json::from_value::<Vec<Attestation>>(
        att_results["data"]["attestationsByAttestee"]["nodes"].clone(),
    )
    .unwrap();
    att_results_sorted.sort_by(|a, b| a.attester.cmp(&b.attester));

    let mut exp_results_sorted =
        serde_json::from_value::<Vec<Attestation>>(exp_results.clone()).unwrap();
    exp_results_sorted.sort_by(|a, b| a.attester.cmp(&b.attester));

    assert_eq!(att_results_sorted, exp_results_sorted);
}

pub fn expect_attestation_stats(chain: &psibase::Chain, expected_results: &serde_json::Value) {
    use serde_json::{json, Value};

    let reply: Value = chain
        .graphql(
            SERVICE,
            r#"query { allAttestationStats { subject, uniqueAttesters, numHighConfAttestations } }"#,
        )
        .unwrap();
    assert_eq!(
        reply,
        json!({ "data": { "allAttestationStats": expected_results } })
    );
}
