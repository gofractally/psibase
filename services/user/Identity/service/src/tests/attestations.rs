use psibase::AccountNumber;

use crate::tests::helpers::{
    query_builders::{get_gql_query_attestation_stats_no_args, get_gql_query_attestations_one_arg},
    test_helpers::{
        are_equal_vecs_of_attestations, are_equal_vecs_of_attestations_stats, init_identity_svc,
        push_attest, query_attestation_stats, query_attestations, PartialAttestation,
        PartialAttestationStats,
    },
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

    let results = query_attestations(
        &chain,
        "attestationsBySubject",
        get_gql_query_attestations_one_arg("attestationsBySubject", "subject", "bob"),
    );
    assert!(are_equal_vecs_of_attestations(&exp_results, &results));

    let exp_results = vec![PartialAttestationStats {
        subject: AccountNumber::from("bob"),
        uniqueAttesters: 1,
        numHighConfAttestations: 1,
    }];
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
    let results = query_attestations(
        &chain,
        "attestationsBySubject",
        get_gql_query_attestations_one_arg("attestationsBySubject", "subject", "bob"),
    );
    assert!(are_equal_vecs_of_attestations(&exp_results, &results));

    let exp_results = vec![PartialAttestationStats {
        subject: AccountNumber::from("bob"),
        uniqueAttesters: 1,
        numHighConfAttestations: 0,
    }];
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
