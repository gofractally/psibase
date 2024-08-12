use crate::service::{Attestation, AttestationStats};
use crate::SERVICE;
use psibase::AccountNumber;

#[derive(Clone)]
pub struct PartialAttestation {
    pub attester: AccountNumber,
    pub subject: AccountNumber,
    pub value: u8,
}

#[derive(Clone)]
#[allow(non_snake_case)]
pub struct PartialAttestationStats {
    pub subject: AccountNumber,
    pub uniqueAttesters: u16,
    pub numHighConfAttestations: u16,
}

pub fn init_identity_svc(chain: &psibase::Chain) -> Result<(), psibase::Error> {
    use crate::SERVICE;
    use psibase::services::http_server;

    http_server::Wrapper::push_from(&chain, SERVICE).registerServer(SERVICE);

    return Ok(());
}

pub fn get_gql_query_attestations_one_arg(
    query_name: &str,
    param_name: &str,
    param: &str,
) -> String {
    format!(
        "query {{ {}({}: \"{}\") {{ nodes {{ attester, subject, value, issued {{ seconds }} }} }} }}",
        query_name, param_name, param
    )
}

pub fn get_gql_query_attestations_no_args(query_name: String) -> String {
    format!(
        "query {{ {} {{ nodes {{ attester, subject, value, issued {{ seconds }} }} }} }}",
        query_name
    )
}

pub fn get_gql_query_attestation_stats_no_args(query_name: &str) -> String {
    format!("query {{ {} {{ nodes {{ subject, uniqueAttesters, numHighConfAttestations, mostRecentAttestation {{ seconds }} }} }} }}",
    query_name)
}

pub fn get_gql_query_subject_stats_one_arg(
    query_name: &str,
    param_name: &str,
    param: &str,
) -> String {
    format!("query {{ {}({}: \"{}\") {{ subject, uniqueAttesters, numHighConfAttestations, mostRecentAttestation {{ seconds }} }} }}",
    query_name, param_name, param)
}

pub fn push_attest(
    chain: &psibase::Chain,
    attester: AccountNumber,
    subject: AccountNumber,
    conf: u8,
) -> Result<(), psibase::Error> {
    crate::Wrapper::push_from(&chain, attester)
        .attest(subject.clone(), conf)
        .get()?;

    chain.finish_block();
    Ok(())
}

// Pass in graphql query string
// get gql results into specified struct
//   outside of testing, return data as a struct
// compare gql_results with expected results field-by-field based on fields in expected_results struct
// calling looks like expect_from_query_array<Vec<Attestation>>(&chain, <query_name>, <gql_query>, exp_results)
pub fn expect_from_attestation_query(
    chain: &psibase::Chain,
    query_name: &str,
    graphql_query: String,
    exp_results: &Vec<PartialAttestation>,
) {
    use serde_json::Value;

    let res: Value = chain.graphql(SERVICE, &graphql_query).unwrap();

    println!("Response {:#?}", res);
    let results_as_attest =
        serde_json::from_value::<Vec<Attestation>>(res["data"][query_name]["nodes"].clone())
            .unwrap();
    println!("Typed response: {:#?}", results_as_attest);

    assert_eq!(
        results_as_attest.len(),
        exp_results.len(),
        "Query results and expected results differ in number."
    );

    for exp_rec in exp_results {
        assert!(results_as_attest
            .iter()
            .find(|rec| {
                rec.attester == exp_rec.attester
                    && rec.subject == exp_rec.subject
                    && rec.value == exp_rec.value
            })
            .is_some(),);
    }
}

pub fn expect_from_subject_stats_query(
    chain: &psibase::Chain,
    query_name: &str,
    graphql_query: String,
    exp_rec: &PartialAttestationStats,
) {
    use serde_json::Value;

    println!("expect_from_subject_stats_query().top");
    let res: Value = chain.graphql(SERVICE, &graphql_query).unwrap();
    println!("gql response: {:#?}", res);

    let results_as_attest_tmp =
        serde_json::from_value::<AttestationStats>(res["data"][query_name].clone());
    assert!(results_as_attest_tmp.is_ok());

    let rec = results_as_attest_tmp.unwrap();
    println!("deserialized object: {:#?}", rec);

    assert!(
        rec.subject == exp_rec.subject
            && rec.uniqueAttesters == exp_rec.uniqueAttesters
            && rec.numHighConfAttestations == exp_rec.numHighConfAttestations
    );
}
pub fn expect_from_attestation_stats_query(
    chain: &psibase::Chain,
    query_name: &str,
    graphql_query: String,
    exp_results: &Vec<PartialAttestationStats>,
) {
    use serde_json::Value;

    println!("expect_from_attestation_stats_query().top");
    let res: Value = chain.graphql(SERVICE, &graphql_query).unwrap();
    println!("gql response: {:#?}", res);

    let results_as_attest_tmp =
        serde_json::from_value::<Vec<AttestationStats>>(res["data"][query_name]["nodes"].clone());
    let results_as_attest = results_as_attest_tmp.unwrap();
    println!("deserialized object: {:#?}", results_as_attest);

    for exp_rec in exp_results {
        assert!(results_as_attest
            .iter()
            .find(|rec| {
                rec.subject == exp_rec.subject
                    && rec.uniqueAttesters == exp_rec.uniqueAttesters
                    && rec.numHighConfAttestations == exp_rec.numHighConfAttestations
            })
            .is_some(),);
    }
}
