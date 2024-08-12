use psibase::AccountNumber;

use crate::tests::test_helpers::{
    expect_from_attestation_query, expect_from_attestation_stats_query,
    get_gql_query_attestation_stats_no_args, get_gql_query_attestations_one_arg, init_identity_svc,
    push_attest, PartialAttestation, PartialAttestationStats,
};

#[psibase::test_case(services("identity"))]
// ATTEST: verify first *high* confidence attestation is saved properly to table
pub fn test_attest_first_high_conf(chain: psibase::Chain) -> Result<(), psibase::Error> {
    init_identity_svc(&chain)?;

    let exp_results = vec![PartialAttestation {
        attester: AccountNumber::from("alice"),
        subject: AccountNumber::from("bob"),
        value: 95,
    }];

    push_attest(
        &chain,
        AccountNumber::from("alice"),
        AccountNumber::from("bob"),
        95,
    )?;

    expect_from_attestation_query(
        &chain,
        "attestationsByAttestee",
        get_gql_query_attestations_one_arg("attestationsByAttestee", "attestee", "bob"),
        &exp_results,
    );

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

    Ok(())
}

#[psibase::test_case(services("identity"))]
// ATTEST: verify first *low* confidence attestation is saved properly to table
pub fn test_attest_first_low_conf(chain: psibase::Chain) -> Result<(), psibase::Error> {
    init_identity_svc(&chain)?;

    push_attest(
        &chain,
        AccountNumber::from("alice"),
        AccountNumber::from("bob"),
        75,
    )?;

    let exp_results = vec![PartialAttestation {
        attester: AccountNumber::from("alice"),
        subject: AccountNumber::from("bob"),
        value: 75,
    }];
    expect_from_attestation_query(
        &chain,
        "attestationsByAttestee",
        get_gql_query_attestations_one_arg("attestationsByAttestee", "attestee", "bob"),
        &exp_results,
    );

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
