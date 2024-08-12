use psibase::AccountNumber;

use crate::tests::test_helpers::{init_identity_svc, push_attest};

#[psibase::test_case(services("identity"))]
// STATS: Verify that issued gets updated when a more recent attestation comes in
pub fn test_issued_field_updates(chain: psibase::Chain) -> Result<(), psibase::Error> {
    init_identity_svc(&chain)?;

    let attester = AccountNumber::from("alice");
    let subject = AccountNumber::from("bob");

    push_attest(&chain, attester, subject.clone(), 75)?;

    // check that issued is updated when an attestation is updated
    chain.start_block();
    let reply: serde_json::Value = chain
        .graphql(
            crate::SERVICE,
            r#"query { allAttestationStats { subject, uniqueAttesters, numHighConfAttestations, mostRecentAttestation { seconds } } }"#,
        )
        .unwrap();
    let issued_first = &reply["data"]["allAttestationStats"][0]["mostRecentAttestation"]["seconds"];

    push_attest(&chain, attester, subject.clone(), 65)?;

    let reply: serde_json::Value = chain
        .graphql(
            crate::SERVICE,
            r#"query { allAttestationStats { subject, uniqueAttesters, numHighConfAttestations, mostRecentAttestation { seconds } } }"#,
        )
        .unwrap();
    let issued_second =
        &reply["data"]["allAttestationStats"][0]["mostRecentAttestation"]["seconds"];

    assert_ne!(issued_first, issued_second);

    Ok(())
}

// #[psibase::test_case(services("identity"))]
// // STATS: 3 attestations attesting to same subject; check that stats are updated properly as more recent attestations come in
// pub fn test_attest_stats_math(chain: psibase::Chain) -> Result<(), psibase::Error> {
//     init_identity_svc(&chain)?;

//     let attester = AccountNumber::from("alice");
//     let subject = AccountNumber::from("bob");

//     push_attest(&chain, attester, subject.clone(), 75)?;

//     expect_attestation_stats(
//         &chain,
//         &json!([{"subject": subject.clone(), "uniqueAttesters": 1, "numHighConfAttestations": 0}]),
//     );

//     chain.start_block();
//     chain.new_account(attester)?;

//     chain.start_block();
//     push_attest(&chain, attester, subject.clone(), 76)?;

//     expect_attestation_stats(
//         &chain,
//         &json!([{"subject": subject, "uniqueAttesters": 1, "numHighConfAttestations": 1}]),
//     );

//     chain.start_block();
//     push_attest(&chain, attester, subject.clone(), 75)?;

//     expect_attestation_stats(
//         &chain,
//         &json!([{"subject": subject, "uniqueAttesters": 1, "numHighConfAttestations": 0}]),
//     );

//     Ok(())
// }

// #[psibase::test_case(services("identity"))]
// // STATS: 4 different attesters attesting to same subject; check that stats are updated properly as new attestations come in
// pub fn test_attest_stats_math_over_time(chain: psibase::Chain) -> Result<(), psibase::Error> {
//     init_identity_svc(&chain)?;

//     let attester = AccountNumber::from("alice");
//     let subject = AccountNumber::from("bob");
//     let value = 75;

//     push_attest(&chain, attester, subject, value)?;

//     expect_attestation_stats(
//         &chain,
//         &json!([{"subject": subject, "uniqueAttesters": 1, "numHighConfAttestations": 0}]),
//     );

//     let attester2 = AccountNumber::from("carol");
//     let value2 = 76;

//     chain.start_block();
//     chain.new_account(attester2)?;

//     chain.start_block();
//     push_attest(&chain, attester2, subject.clone(), value2)?;

//     expect_attestation_stats(
//         &chain,
//         &json!([{"subject": subject, "uniqueAttesters": 2, "numHighConfAttestations": 1}]),
//     );

//     let attester3 = AccountNumber::from("david");
//     let value3 = 77;

//     chain.start_block();
//     chain.new_account(attester3)?;

//     chain.start_block();
//     push_attest(&chain, attester3, subject.clone(), value3)?;

//     expect_attestation_stats(
//         &chain,
//         &json!([{"subject": subject, "uniqueAttesters": 3, "numHighConfAttestations": 2}]),
//     );

//     let attester4 = AccountNumber::from("ed");
//     let value4 = 60;

//     chain.start_block();
//     chain.new_account(attester4)?;

//     chain.start_block();
//     push_attest(&chain, attester4, subject.clone(), value4)?;

//     expect_attestation_stats(
//         &chain,
//         &json!([{"subject": subject, "uniqueAttesters": 4, "numHighConfAttestations": 2}]),
//     );

//     Ok(())
// }
