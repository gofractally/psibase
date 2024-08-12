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

pub fn get_gql_query_attestation_stats_one_arg(
    query_name: &str,
    param_name: &str,
    param: &str,
) -> String {
    format!("query {{ {}({}: \"{}\") {{ nodes {{ subject, uniqueAttesters, numHighConfAttestations, mostRecentAttestation {{ seconds }} }} }} }}",
    query_name, param_name, param)
}

pub fn get_gql_query_subject_stats_one_arg(
    query_name: &str,
    param_name: &str,
    param: &str,
) -> String {
    format!("query {{ {}({}: \"{}\") {{ subject, uniqueAttesters, numHighConfAttestations, mostRecentAttestation {{ seconds }} }} }}",
    query_name, param_name, param)
}
// pub fn test_attest(
//     chain: &psibase::Chain,
//     attester: AccountNumber,
//     subject: AccountNumber,
//     conf: u8,
// ) -> Result<(), psibase::Error> {
//     crate::Wrapper::push_from(&chain, attester)
//         .attest(subject.clone(), conf)
//         .get()?;

//     chain.finish_block();
//     Ok(())
// }

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

// #[derive(Deserialize, Debug, Clone)]
// struct Attestation {
//     attester: String,
//     subject: String,
//     value: u8,
// }

// pub fn expect_from_query_unused?(
//     chain: &psibase::Chain,
//     query_name: &str,
//     graphql_query: String,
//     exp_results: &serde_json::Value,
// ) {
//     use serde_json::Value;

//     // println!("{}", query_name);
//     // println!("{}", graphql_query);
//     // println!("{}", exp_results);
//     let att_results: Value = chain.graphql(SERVICE, &graphql_query).unwrap();

//     let att_result = serde_json::from_value::<AttestationStats>(
//         att_results["data"][query_name]["nodes"].clone(),
//     )
//     .unwrap();

//     let exp_result = serde_json::from_value::<AttestationStats>(exp_results.clone()).unwrap();

//     assert_eq!(att_result, exp_result);
// }

// pub fn expect_from_query_array_v2_using_attestation_struct(
//     chain: &psibase::Chain,
//     query_name: &str,
//     graphql_query: String,
//     exp_results: &serde_json::Value,
// ) {
//     use serde_json::Value;

//     let att_results: Value = chain.graphql(SERVICE, &graphql_query).unwrap();

//     println!("{:#?}", att_results);
//     let att_results_sorted_option = serde_json::from_value::<Vec<Attestation>>(
//         att_results["data"][query_name]["nodes"].clone(),
//     );
//     println!("{:#?}", att_results_sorted_option);
//     let mut att_results_sorted = att_results_sorted_option.unwrap();
//     att_results_sorted.sort_by(|a, b| a.cmp(&b));

//     let mut exp_results_sorted =
//         serde_json::from_value::<Vec<Attestation>>(exp_results.clone()).unwrap();
//     exp_results_sorted.sort_by(|a, b| a.cmp(&b));

//     assert_eq!(att_results_sorted, exp_results_sorted);
// }

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

// pub fn expect_attestations(chain: &psibase::Chain, exp_results: &PartialAttestation) {
//     let graphql_query = r#"query { attestationsByAttestee(attestee: "bob") { nodes { attester, subject, value, issued { seconds } } } }"#;
//     expect_from_query::<crate::service::Attestation, PartialAttestation>(
//         &chain,
//         "attestationsByAttestee",
//         String::from(graphql_query),
//         exp_results,
//     )
//     // use serde_json::Value;

//     // let att_results: Value = chain.graphql(
//     //         SERVICE,
//     //         r#"query { attestationsByAttestee(attestee: "bob") { nodes { attester, subject, value, issued } } }"#,
//     //     ).unwrap();

//     // let mut att_results_sorted = serde_json::from_value::<Vec<Attestation>>(
//     //     att_results["data"]["attestationsByAttestee"]["nodes"].clone(),
//     // )
//     // .unwrap();
//     // att_results_sorted.sort_by(|a, b| a.cmp(&b));

//     // let mut exp_results_sorted =
//     //     serde_json::from_value::<Vec<Attestation>>(exp_results.clone()).unwrap();
//     // exp_results_sorted.sort_by(|a, b| a.cmp(&b));

//     // assert!(att_results_sorted.cmp(&exp_results_sorted) == Ordering::Equal);
// }

// pub fn expect_attestation_stats(chain: &psibase::Chain, expected_results: &serde_json::Value) {
//     use serde_json::{json, Value};

//     let reply: Value = chain
//         .graphql(
//             SERVICE,
//             r#"query { allAttestationStats { nodes { subject, uniqueAttesters, numHighConfAttestations } } }"#,
//         )
//         .unwrap();
//     assert_eq!(
//         reply,
//         json!({ "data": { "allAttestationStats": { "nodes": expected_results } } })
//     );
// }
