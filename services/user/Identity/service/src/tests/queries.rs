use psibase::AccountNumber;

use crate::tests::helpers::{
    query_builders::{
        get_gql_query_attestation_stats_no_args, get_gql_query_attestations_no_args,
        get_gql_query_attestations_one_arg, get_gql_query_subject_stats_one_arg,
    },
    test_helpers::{
        are_equal_vecs_of_attestations, are_equal_vecs_of_attestations_stats, init_identity_svc,
        push_attest, query_attestation_stats, query_attestations, query_subject_stats,
        PartialAttestation, PartialAttestationStats,
    },
};

#[psibase::test_case(services("identity"))]
// ATTEST QUERY: verify first *high* confidence attestation is saved properly to table
pub fn test_attestation_queries(chain: psibase::Chain) -> Result<(), psibase::Error> {
    init_identity_svc(&chain)?;

    chain.new_account(AccountNumber::from("carol"))?;
    chain.start_block();
    push_attest(
        &chain,
        AccountNumber::from("carol"),
        AccountNumber::from("bob"),
        76,
    )?;
    push_attest(
        &chain,
        AccountNumber::from("alice"),
        AccountNumber::from("carol"),
        77,
    )?;
    push_attest(
        &chain,
        AccountNumber::from("alice"),
        AccountNumber::from("bob"),
        75,
    )?;

    chain.start_block();

    let exp_results = vec![
        PartialAttestation {
            attester: AccountNumber::from("alice"),
            subject: AccountNumber::from("bob"),
            value: 75,
        },
        PartialAttestation {
            attester: AccountNumber::from("alice"),
            subject: AccountNumber::from("carol"),
            value: 77,
        },
        PartialAttestation {
            attester: AccountNumber::from("carol"),
            subject: AccountNumber::from("bob"),
            value: 76,
        },
    ];

    let response = query_attestations(
        &chain,
        "allAttestations",
        get_gql_query_attestations_no_args(String::from("allAttestations")),
    );
    assert!(are_equal_vecs_of_attestations(&exp_results, &response));

    let exp_result2 = exp_results
        .clone()
        .into_iter()
        .filter(|pa| pa.subject == AccountNumber::from("bob"))
        .collect::<Vec<PartialAttestation>>();

    let response = query_attestations(
        &chain,
        "attestationsBySubject",
        get_gql_query_attestations_one_arg("attestationsBySubject", "subject", "bob"),
    );
    assert!(are_equal_vecs_of_attestations(&exp_result2, &response));

    let exp_result2 = exp_results
        .into_iter()
        .filter(|pa| pa.attester == AccountNumber::from("alice"))
        .collect::<Vec<PartialAttestation>>();
    let response = query_attestations(
        &chain,
        "attestationsByAttester",
        get_gql_query_attestations_one_arg("attestationsByAttester", "attester", "alice"),
    );
    assert!(are_equal_vecs_of_attestations(&exp_result2, &response));

    let exp_results = vec![
        PartialAttestationStats {
            subject: AccountNumber::from("bob"),
            uniqueAttesters: 2,
            numHighConfAttestations: 1,
        },
        PartialAttestationStats {
            subject: AccountNumber::from("carol"),
            uniqueAttesters: 1,
            numHighConfAttestations: 1,
        },
    ];
    let response = query_attestation_stats(
        &chain,
        "allAttestationStats",
        get_gql_query_attestation_stats_no_args("allAttestationStats"),
    );
    assert!(are_equal_vecs_of_attestations_stats(
        &exp_results,
        &response
    ));

    let exp_results2 = exp_results
        .iter()
        .find(|pa| pa.subject == AccountNumber::from("bob"))
        .unwrap();
    let response = query_subject_stats(
        &chain,
        "subjectStats",
        get_gql_query_subject_stats_one_arg("subjectStats", "subject", "bob"),
    )
    .unwrap();
    assert!(
        response.subject == exp_results2.subject
            && response.uniqueAttesters == exp_results2.uniqueAttesters
            && response.numHighConfAttestations == exp_results2.numHighConfAttestations
    );

    Ok(())
}

#[psibase::test_case(services("identity"))]
// ATTEST QUERY: verify empty query responses are correct
pub fn test_empty_attestation_queries(chain: psibase::Chain) -> Result<(), psibase::Error> {
    init_identity_svc(&chain)?;
    chain.new_account(AccountNumber::from("carol"))?;
    chain.start_block();

    let exp_results = vec![];
    let response = query_attestations(
        &chain,
        "allAttestations",
        get_gql_query_attestations_no_args(String::from("allAttestations")),
    );
    assert!(are_equal_vecs_of_attestations(&exp_results, &response));

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

    let exp_results3 = vec![
        PartialAttestation {
            attester: AccountNumber::from("alice"),
            subject: AccountNumber::from("bob"),
            value: 75,
        },
        PartialAttestation {
            attester: AccountNumber::from("alice"),
            subject: AccountNumber::from("carol"),
            value: 77,
        },
        PartialAttestation {
            attester: AccountNumber::from("carol"),
            subject: AccountNumber::from("bob"),
            value: 76,
        },
    ];
    push_attest(
        &chain,
        AccountNumber::from("carol"),
        AccountNumber::from("bob"),
        76,
    )?;
    push_attest(
        &chain,
        AccountNumber::from("alice"),
        AccountNumber::from("carol"),
        77,
    )?;
    push_attest(
        &chain,
        AccountNumber::from("alice"),
        AccountNumber::from("bob"),
        75,
    )?;

    chain.start_block();

    let exp_result2 = exp_results3
        .clone()
        .into_iter()
        .filter(|pa| pa.attester == AccountNumber::from("bob"))
        .collect::<Vec<PartialAttestation>>();
    let response = query_attestations(
        &chain,
        "attestationsByAttester",
        get_gql_query_attestations_one_arg("attestationsByAttester", "attester", "bob"),
    );
    assert!(are_equal_vecs_of_attestations(&exp_result2, &response));

    let exp_result2 = exp_results3
        .into_iter()
        .filter(|pa| pa.subject == AccountNumber::from("alice"))
        .collect::<Vec<PartialAttestation>>();
    let response = query_attestations(
        &chain,
        "attestationsBySubject",
        get_gql_query_attestations_one_arg("attestationsBySubject", "subject", "alice"),
    );
    assert!(are_equal_vecs_of_attestations(&exp_result2, &response));

    let exp_results = None;
    let response = query_subject_stats(
        &chain,
        "subjectStats",
        get_gql_query_subject_stats_one_arg("subjectStats", "subject", "alice"),
    );
    assert_eq!(exp_results, response);

    Ok(())
}
