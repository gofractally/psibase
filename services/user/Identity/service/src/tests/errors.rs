use crate::tests::test_helpers::*;
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
    match push_attest(
        &chain,
        AccountNumber::from("alice"),
        AccountNumber::from("bob"),
        101,
    ) {
        Err(e) => assert_eq!(
            e.to_string(),
            expected_err,
            "Transaction failed with \"{}\", but was expected to fail with: \"{}\"",
            e.to_string(),
            expected_err
        ),
        _ => panic!(
            "Transaction succeeded, but was expected to fail with: \"{}\"",
            expected_err
        ),
    }
    chain.finish_block();

    let exp_results = vec![];
    expect_from_attestation_stats_query(
        &chain,
        "allAttestationStats",
        get_gql_query_attestation_stats_no_args("allAttestationStats"),
        &exp_results,
    );

    chain.start_block();

    match push_attest(
        &chain,
        AccountNumber::from("alice"),
        AccountNumber::from("bob"),
        255,
    ) {
        Ok(_) => {
            return Err(psibase::Error::msg(
                "Confidence scores <0 should not have been accepted.",
            ))
        }
        Err(_) => (), // This is expected
    }

    let exp_results = vec![];
    expect_from_attestation_stats_query(
        &chain,
        "allAttestationStats",
        get_gql_query_attestation_stats_no_args("allAttestationStats"),
        &exp_results,
    );

    Ok(())
}
