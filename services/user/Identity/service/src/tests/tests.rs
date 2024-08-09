// Q: How is SERVICE possibly properly defined here? and how is the Wrapper the right wrapper?
use serde_json::json;

use psibase::AccountNumber;

use crate::tests::test_helpers::*;

/* Test Suite Summary:
 x- new attestatations are posted to tables properly, including summary stats
 O- queries return expected data
 -- other queries I haven't hit yet
 x- bad input args to actions and queries produce reasonable error responses
 x- queries for non-existent records produce reasonable error responses
*/
#[psibase::test_case(services("identity"))]
// ATTEST QUERY: verify first *high* confidence attestation is saved properly to table
pub fn test_attestation_queries(chain: psibase::Chain) -> Result<(), psibase::Error> {
    use crate::SERVICE;
    use psibase::services::http_server;
    http_server::Wrapper::push_from(&chain, SERVICE).registerServer(SERVICE);

    chain.new_account(AccountNumber::from("carol"))?;
    chain.start_block();
    test_attest(
        &chain,
        AccountNumber::from("carol"),
        AccountNumber::from("bob"),
        76,
    )?;
    test_attest(
        &chain,
        AccountNumber::from("alice"),
        AccountNumber::from("carol"),
        77,
    )?;
    test_attest(
        &chain,
        AccountNumber::from("alice"),
        AccountNumber::from("bob"),
        75,
    )?;

    chain.start_block();

    // queries to cover:
    // x - allAttestations
    // x - attestationsByAttester
    // x - attestationsByAttestee
    // allAttestationStats
    // O - subjectStats
    // event

    // works
    println!("1");
    let exp_results = json!([ { "attester": "alice", "subject": "bob", "value": 75}, { "attester": "carol", "subject": "bob", "value": 76}]);
    expect_attestations(&chain, &exp_results);

    println!("3");
    let exp_results = json!([ { "attester": "alice", "subject": "bob", "value": 75}, { "attester": "alice", "subject": "carol", "value": 77}, { "attester": "carol", "subject": "bob", "value": 76}]);
    expect_from_query_array(
        &chain,
        "allAttestations",
        String::from(r#"query { allAttestations { nodes { attester, subject, value } } }"#),
        &exp_results,
    );
    println!("4");

    let exp_results = json!([ { "attester": "alice", "subject": "bob", "value": 75}, { "attester": "alice", "subject": "carol", "value": 77}]);
    expect_from_query_array(
        &chain,
        "attestationsByAttester",
        String::from(
            r#"query { attestationsByAttester(attester: "alice") { nodes { attester, subject, value } } }"#,
        ),
        &exp_results,
    );
    println!("5");

    let exp_results = json!([ { "attester": "alice", "subject": "bob", "value": 75}, { "attester": "carol", "subject": "bob", "value": 76}]);
    expect_from_query_array(
        &chain,
        "attestationsByAttestee",
        String::from(
            r#"query { attestationsByAttestee(attestee: "bob") { nodes { attester, subject, value } } }"#,
        ),
        &exp_results,
    );
    println!("6");

    // TODO: stats queries

    expect_attestation_stats(
        &chain,
        &json!([{"subject": "bob", "uniqueAttesters": 2, "numHighConfAttestations": 1}, {"subject": "carol", "uniqueAttesters": 1, "numHighConfAttestations": 1}]),
    );

    // doesn't work
    // TASKS
    // 1) get this working (add PartialEq to AttestationStats)
    // 2) move PartialEq for AttestationStats out of test_helpers and just put it on the crate's AttestationStats struct?
    println!("7");
    let exp_results =
        json!({ "subject": "bob", "uniqueAttesters": 1, "numHighConfAttestations": 1});
    expect_from_query(
        &chain,
        "subjectStats",
        String::from(
            r#"query { subjectStats(subject: "bob") { subject, numHighConfAttestations, uniqueAttesters } }"#,
        ),
        &exp_results,
    );

    Ok(())
}

// #[psibase::test_case(services("identity"))]
// // ATTEST QUERY: verify empty query responses are correct
// pub fn test_empty_attestation_queries(chain: psibase::Chain) -> Result<(), psibase::Error> {
//     use crate::SERVICE;
//     use psibase::services::http_server;
//     http_server::Wrapper::push_from(&chain, SERVICE).registerServer(SERVICE);
//     chain.new_account(AccountNumber::from("carol"))?;
//     chain.start_block();

//     println!("1");
//     let exp_results = json!([]);
//     expect_from_query_array(
//         &chain,
//         "allAttestations",
//         String::from(r#"query { allAttestations { nodes { attester, subject, value } } }"#),
//         &exp_results,
//     );
//     println!("2");

//     test_attest(
//         &chain,
//         AccountNumber::from("carol"),
//         AccountNumber::from("bob"),
//         76,
//     )?;
//     test_attest(
//         &chain,
//         AccountNumber::from("alice"),
//         AccountNumber::from("carol"),
//         77,
//     )?;
//     test_attest(
//         &chain,
//         AccountNumber::from("alice"),
//         AccountNumber::from("bob"),
//         75,
//     )?;

//     chain.start_block();

//     println!("4");

//     expect_from_query_array(
//         &chain,
//         "attestationsByAttester",
//         String::from(
//             r#"query { attestationsByAttester(attester: "bob") { nodes { attester, subject, value } } }"#,
//         ),
//         &exp_results,
//     );
//     println!("5");

//     expect_from_query_array(
//         &chain,
//         "attestationsByAttestee",
//         String::from(
//             r#"query { attestationsByAttestee(attestee: "alice") { nodes { attester, subject, value } } }"#,
//         ),
//         &exp_results,
//     );
//     println!("6");

//     expect_attestation_stats(
//         &chain,
//         &json!([{"subject": "bob", "uniqueAttesters": 2, "numHighConfAttestations": 1}, {"subject": "carol", "uniqueAttesters": 1, "numHighConfAttestations": 1}]),
//     );

//     Ok(())
// }
// #[psibase::test_case(services("identity"))]
// // ATTEST: verify first *high* confidence attestation is saved properly to table
// pub fn test_attest_first_high_conf(chain: psibase::Chain) -> Result<(), psibase::Error> {
//     test_attest(
//         &chain,
//         AccountNumber::from("alice"),
//         AccountNumber::from("bob"),
//         95,
//     )?;

//     let exp_results = json!([ { "attester": "alice", "subject": "bob", "value": 95}]);
//     expect_attestations(&chain, &exp_results);

//     expect_attestation_stats(
//         &chain,
//         &json!([{"subject": "bob", "uniqueAttesters": 1, "numHighConfAttestations": 1}]),
//     );

//     Ok(())
// }

// #[psibase::test_case(services("identity"))]
// // ATTEST: verify first *low* confidence attestation is saved properly to table
// pub fn test_attest_first_low_conf(chain: psibase::Chain) -> Result<(), psibase::Error> {
//     test_attest(
//         &chain,
//         AccountNumber::from("alice"),
//         AccountNumber::from("bob"),
//         75,
//     )?;

//     let exp_results = json!([ { "attester": "alice", "subject": "bob", "value": 75}]);
//     expect_attestations(&chain, &exp_results);

//     expect_attestation_stats(
//         &chain,
//         &json!([{"subject": "bob", "uniqueAttesters": 1, "numHighConfAttestations": 0}]),
//     );

//     Ok(())
// }

// #[psibase::test_case(services("identity"))]
// // STATS: Verify that issued gets updated when a more recent attestation comes in
// pub fn test_issued_field_updates(chain: psibase::Chain) -> Result<(), psibase::Error> {
//     let attester = AccountNumber::from("alice");
//     let subject = AccountNumber::from("bob");

//     test_attest(&chain, attester, subject.clone(), 75)?;

//     // check that issued is updated when an attestation is updated
//     chain.start_block();
//     let reply: serde_json::Value = chain
//         .graphql(
//             crate::SERVICE,
//             r#"query { allAttestationStats { subject, uniqueAttesters, numHighConfAttestations, mostRecentAttestation { seconds } } }"#,
//         )
//         .unwrap();
//     let issued_first = &reply["data"]["allAttestationStats"][0]["mostRecentAttestation"]["seconds"];

//     test_attest(&chain, attester, subject.clone(), 65)?;

//     let reply: serde_json::Value = chain
//         .graphql(
//             crate::SERVICE,
//             r#"query { allAttestationStats { subject, uniqueAttesters, numHighConfAttestations, mostRecentAttestation { seconds } } }"#,
//         )
//         .unwrap();
//     let issued_second =
//         &reply["data"]["allAttestationStats"][0]["mostRecentAttestation"]["seconds"];

//     assert_ne!(issued_first, issued_second);

//     Ok(())
// }

// #[psibase::test_case(services("identity"))]
// // STATS: 3 attestations attesting to same subject; check that stats are updated properly as more recent attestations come in
// pub fn test_attest_stats_math(chain: psibase::Chain) -> Result<(), psibase::Error> {
//     let attester = AccountNumber::from("alice");
//     let subject = AccountNumber::from("bob");

//     test_attest(&chain, attester, subject.clone(), 75)?;

//     expect_attestation_stats(
//         &chain,
//         &json!([{"subject": subject.clone(), "uniqueAttesters": 1, "numHighConfAttestations": 0}]),
//     );

//     chain.start_block();
//     chain.new_account(attester)?;

//     chain.start_block();
//     test_attest(&chain, attester, subject.clone(), 76)?;

//     expect_attestation_stats(
//         &chain,
//         &json!([{"subject": subject, "uniqueAttesters": 1, "numHighConfAttestations": 1}]),
//     );

//     chain.start_block();
//     test_attest(&chain, attester, subject.clone(), 75)?;

//     expect_attestation_stats(
//         &chain,
//         &json!([{"subject": subject, "uniqueAttesters": 1, "numHighConfAttestations": 0}]),
//     );

//     Ok(())
// }

// #[psibase::test_case(services("identity"))]
// // STATS: 4 different attesters attesting to same subject; check that stats are updated properly as new attestations come in
// pub fn test_attest_stats_math_over_time(chain: psibase::Chain) -> Result<(), psibase::Error> {
//     let attester = AccountNumber::from("alice");
//     let subject = AccountNumber::from("bob");
//     let value = 75;

//     test_attest(&chain, attester, subject, value)?;

//     expect_attestation_stats(
//         &chain,
//         &json!([{"subject": subject, "uniqueAttesters": 1, "numHighConfAttestations": 0}]),
//     );

//     let attester2 = AccountNumber::from("carol");
//     let value2 = 76;

//     chain.start_block();
//     chain.new_account(attester2)?;

//     chain.start_block();
//     test_attest(&chain, attester2, subject.clone(), value2)?;

//     expect_attestation_stats(
//         &chain,
//         &json!([{"subject": subject, "uniqueAttesters": 2, "numHighConfAttestations": 1}]),
//     );

//     let attester3 = AccountNumber::from("david");
//     let value3 = 77;

//     chain.start_block();
//     chain.new_account(attester3)?;

//     chain.start_block();
//     test_attest(&chain, attester3, subject.clone(), value3)?;

//     expect_attestation_stats(
//         &chain,
//         &json!([{"subject": subject, "uniqueAttesters": 3, "numHighConfAttestations": 2}]),
//     );

//     let attester4 = AccountNumber::from("ed");
//     let value4 = 60;

//     chain.start_block();
//     chain.new_account(attester4)?;

//     chain.start_block();
//     test_attest(&chain, attester4, subject.clone(), value4)?;

//     expect_attestation_stats(
//         &chain,
//         &json!([{"subject": subject, "uniqueAttesters": 4, "numHighConfAttestations": 2}]),
//     );

//     Ok(())
// }

// #[psibase::test_case(services("identity"))]
// // ATTEST: Fails for bad subject names
// pub fn test_reject_invalid_accounts(chain: psibase::Chain) -> Result<(), psibase::Error> {
//     let expected_err = "subject account willy doesn't exist";
//     match test_attest(
//         &chain,
//         AccountNumber::from("alice"),
//         AccountNumber::from("willy"),
//         80,
//     ) {
//         Err(e) => assert!(
//             e.to_string().contains(expected_err),
//             "Transaction failed with \"{}\", but was expected to fail with: \"{}\"",
//             e.to_string(),
//             expected_err
//         ),
//         _ => panic!(
//             "Transaction succeeded, but was expected to fail with: \"{}\"",
//             expected_err
//         ),
//     }

//     Ok(())
// }

// #[psibase::test_case(services("identity"))]
// // ATTEST: Fails for bad scores (outside of [0..10])
// pub fn test_reject_invalid_scores(chain: psibase::Chain) -> Result<(), psibase::Error> {
//     let expected_err = "service 'identity' aborted with message: bad confidence score";
//     match test_attest(
//         &chain,
//         AccountNumber::from("alice"),
//         AccountNumber::from("bob"),
//         101,
//     ) {
//         Err(e) => assert_eq!(
//             e.to_string(),
//             expected_err,
//             "Transaction failed with \"{}\", but was expected to fail with: \"{}\"",
//             e.to_string(),
//             expected_err
//         ),
//         _ => panic!(
//             "Transaction succeeded, but was expected to fail with: \"{}\"",
//             expected_err
//         ),
//     }

//     chain.finish_block();
//     expect_attestation_stats(&chain, &json!([]));

//     chain.start_block();

//     match test_attest(
//         &chain,
//         AccountNumber::from("alice"),
//         AccountNumber::from("bob"),
//         255,
//     ) {
//         Ok(_) => {
//             return Err(psibase::Error::msg(
//                 "Confidence scores <0 should not have been accepted.",
//             ))
//         }
//         Err(_) => (), // This is expected
//     }

//     expect_attestation_stats(&chain, &json!([]));

//     Ok(())
// }
