use psibase::AccountNumber;

use crate::tests::test_helpers::{
    expect_from_attestation_stats_query, get_gql_query_attestation_stats_no_args,
    init_identity_svc, push_attest, PartialAttestationStats,
};

// TODO: issued field update; maybe my query functions should *return* PartialX objects and let the test do the assertion to handle special cases like this?
// #[psibase::test_case(services("identity"))]
// // STATS: Verify that issued gets updated when a more recent attestation comes in
// pub fn test_issued_field_updates(chain: psibase::Chain) -> Result<(), psibase::Error> {
//     init_identity_svc(&chain)?;

//     push_attest(
//         &chain,
//         AccountNumber::from("alice"),
//         AccountNumber::from("bob"),
//         75,
//     )?;

//     // check that issued is updated when an attestation is updated
//     chain.start_block();
//     let reply: serde_json::Value = chain
//         .graphql(
//             crate::SERVICE,
//             r#"query { allAttestationStats { subject, uniqueAttesters, numHighConfAttestations, mostRecentAttestation { seconds } } }"#,
//         )
//         .unwrap();
//     let issued_first = &reply["data"]["allAttestationStats"][0]["mostRecentAttestation"]["seconds"];

//     push_attest(
//         &chain,
//         AccountNumber::from("alice"),
//         AccountNumber::from("bob"),
//         65,
//     )?;

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

#[psibase::test_case(services("identity"))]
// STATS: 3 attestations attesting to same subject; check that stats are updated properly as more recent attestations come in
pub fn test_attest_stats_math(chain: psibase::Chain) -> Result<(), psibase::Error> {
    init_identity_svc(&chain)?;

    push_attest(
        &chain,
        AccountNumber::from("alice"),
        AccountNumber::from("bob"),
        75,
    )?;

    let exp_results = vec![PartialAttestationStats {
        subject: AccountNumber::from("bob"),
        uniqueAttesters: 1,
        numHighConfAttestations: 0,
    }];
    expect_from_attestation_stats_query(
        &chain,
        "allAttestationStats",
        get_gql_query_attestation_stats_no_args("allAttestationStats"),
        &exp_results,
    );

    chain.start_block();
    chain.new_account(AccountNumber::from("alice"))?;

    chain.start_block();
    push_attest(
        &chain,
        AccountNumber::from("alice"),
        AccountNumber::from("bob"),
        76,
    )?;

    let exp_results = vec![PartialAttestationStats {
        subject: AccountNumber::from("bob"),
        uniqueAttesters: 1,
        numHighConfAttestations: 1,
    }];
    expect_from_attestation_stats_query(
        &chain,
        "allAttestationStats",
        get_gql_query_attestation_stats_no_args("allAttestationStats"),
        &exp_results,
    );

    chain.start_block();
    push_attest(
        &chain,
        AccountNumber::from("alice"),
        AccountNumber::from("bob"),
        75,
    )?;

    let exp_results = vec![PartialAttestationStats {
        subject: AccountNumber::from("bob"),
        uniqueAttesters: 1,
        numHighConfAttestations: 0,
    }];
    expect_from_attestation_stats_query(
        &chain,
        "allAttestationStats",
        get_gql_query_attestation_stats_no_args("allAttestationStats"),
        &exp_results,
    );
    Ok(())
}

#[psibase::test_case(services("identity"))]
// STATS: 4 different attesters attesting to same subject; check that stats are updated properly as new attestations come in
pub fn test_attest_stats_math_over_time(chain: psibase::Chain) -> Result<(), psibase::Error> {
    init_identity_svc(&chain)?;

    push_attest(
        &chain,
        AccountNumber::from("alice"),
        AccountNumber::from("bob"),
        75,
    )?;

    let exp_results = vec![PartialAttestationStats {
        subject: AccountNumber::from("bob"),
        uniqueAttesters: 1,
        numHighConfAttestations: 0,
    }];
    expect_from_attestation_stats_query(
        &chain,
        "allAttestationStats",
        get_gql_query_attestation_stats_no_args("allAttestationStats"),
        &exp_results,
    );

    chain.start_block();
    chain.new_account(AccountNumber::from("carol"))?;

    chain.start_block();
    push_attest(
        &chain,
        AccountNumber::from("carol"),
        AccountNumber::from("bob"),
        76,
    )?;

    let exp_results = vec![PartialAttestationStats {
        subject: AccountNumber::from("bob"),
        uniqueAttesters: 2,
        numHighConfAttestations: 1,
    }];
    expect_from_attestation_stats_query(
        &chain,
        "allAttestationStats",
        get_gql_query_attestation_stats_no_args("allAttestationStats"),
        &exp_results,
    );

    chain.start_block();
    chain.new_account(AccountNumber::from("david"))?;

    chain.start_block();
    push_attest(
        &chain,
        AccountNumber::from("david"),
        AccountNumber::from("bob"),
        77,
    )?;

    let exp_results = vec![PartialAttestationStats {
        subject: AccountNumber::from("bob"),
        uniqueAttesters: 3,
        numHighConfAttestations: 2,
    }];
    expect_from_attestation_stats_query(
        &chain,
        "allAttestationStats",
        get_gql_query_attestation_stats_no_args("allAttestationStats"),
        &exp_results,
    );

    chain.start_block();
    chain.new_account(AccountNumber::from("ed"))?;

    chain.start_block();
    push_attest(
        &chain,
        AccountNumber::from("ed"),
        AccountNumber::from("bob"),
        60,
    )?;

    let exp_results = vec![PartialAttestationStats {
        subject: AccountNumber::from("bob"),
        uniqueAttesters: 4,
        numHighConfAttestations: 2,
    }];
    expect_from_attestation_stats_query(
        &chain,
        "allAttestationStats",
        get_gql_query_attestation_stats_no_args("allAttestationStats"),
        &exp_results,
    );

    Ok(())
}
