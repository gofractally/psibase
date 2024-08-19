use crate::tests::helpers::{
    query_builders::get_gql_query_attestation_stats_no_args,
    test_helpers::{
        are_equal_vecs_of_attestations_stats, assert_test_failed, init_identity_svc, push_attest,
        query_attestation_stats,
    },
};
use psibase::AccountNumber;

#[psibase::test_case(services("identity"))]
// ATTEST: Fails for bad subject names
pub fn test_reject_invalid_accounts(chain: psibase::Chain) -> Result<(), psibase::Error> {
    init_identity_svc(&chain)?;

    let expected_err = "subject account willy doesn't exist";
    match push_attest(
        &chain,
        AccountNumber::from("alice"),
        AccountNumber::from("willy"),
        80,
    ) {
        Err(e) => assert!(
            e.to_string().contains(expected_err),
            "Transaction failed with \"{}\", but was expected to fail with: \"{}\"",
            e.to_string(),
            expected_err
        ),
        _ => panic!(
            "Transaction succeeded, but was expected to fail with: \"{}\"",
            expected_err
        ),
    }

    Ok(())
}

#[psibase::test_case(services("identity"))]
// ATTEST: Fails for bad scores (outside of [0..10])
pub fn test_reject_invalid_scores(chain: psibase::Chain) -> Result<(), psibase::Error> {
    init_identity_svc(&chain)?;

    let expected_err = "service 'identity' aborted with message: bad confidence score";
    let res = push_attest(
        &chain,
        AccountNumber::from("alice"),
        AccountNumber::from("bob"),
        101,
    );
    assert_test_failed(&res, expected_err);

    chain.finish_block();

    let exp_results = vec![];
    let response = query_attestation_stats(
        &chain,
        "allAttestationStats",
        get_gql_query_attestation_stats_no_args("allAttestationStats"),
    );
    assert!(are_equal_vecs_of_attestations_stats(
        &exp_results,
        &response
    ));

    chain.start_block();

    let res = push_attest(
        &chain,
        AccountNumber::from("alice"),
        AccountNumber::from("bob"),
        255,
    );

    assert_test_failed(&res, expected_err);

    let exp_results = vec![];
    let response = query_attestation_stats(
        &chain,
        "allAttestationStats",
        get_gql_query_attestation_stats_no_args("allAttestationStats"),
    );
    assert!(are_equal_vecs_of_attestations_stats(
        &exp_results,
        &response
    ));

    Ok(())
}
