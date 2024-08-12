use crate::tests::test_helpers::*;
use psibase::AccountNumber;

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

    expect_from_attestation_query(
        &chain,
        "allAttestations",
        get_gql_query_attestations_no_args(String::from("allAttestations")),
        &exp_results,
    );

    let exp_result2 = exp_results
        .clone()
        .into_iter()
        .filter(|pa| pa.subject == AccountNumber::from("bob"))
        .collect::<Vec<PartialAttestation>>();
    expect_from_attestation_query(
        &chain,
        "attestationsByAttestee",
        get_gql_query_attestations_one_arg("attestationsByAttestee", "attestee", "bob"),
        &exp_result2,
    );

    let exp_result2 = exp_results
        .into_iter()
        .filter(|pa| pa.attester == AccountNumber::from("alice"))
        .collect::<Vec<PartialAttestation>>();
    expect_from_attestation_query(
        &chain,
        "attestationsByAttester",
        get_gql_query_attestations_one_arg("attestationsByAttester", "attester", "alice"),
        &exp_result2,
    );

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
    expect_from_attestation_stats_query(
        &chain,
        "allAttestationStats",
        get_gql_query_attestation_stats_no_args("allAttestationStats"),
        &exp_results,
    );

    let exp_results2 = exp_results
        .iter()
        .find(|pa| pa.subject == AccountNumber::from("bob"))
        .unwrap();
    expect_from_subject_stats_query(
        &chain,
        "subjectStats",
        get_gql_query_subject_stats_one_arg("subjectStats", "subject", "bob"),
        &exp_results2,
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
    expect_from_attestation_query(
        &chain,
        "allAttestations",
        get_gql_query_attestations_no_args(String::from("allAttestations")),
        &exp_results,
    );

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
    expect_from_attestation_query(
        &chain,
        "attestationsByAttester",
        get_gql_query_attestations_one_arg("attestationsByAttester", "attester", "bob"),
        &exp_result2,
    );

    let exp_result2 = exp_results3
        .into_iter()
        .filter(|pa| pa.subject == AccountNumber::from("alice"))
        .collect::<Vec<PartialAttestation>>();
    expect_from_attestation_query(
        &chain,
        "attestationsByAttestee",
        get_gql_query_attestations_one_arg("attestationsByAttestee", "attestee", "alice"),
        &exp_result2,
    );

    let exp_results = vec![];
    expect_from_attestation_stats_query(
        &chain,
        "allAttestationStats",
        get_gql_query_attestation_stats_no_args("allAttestationStats"),
        &exp_results,
    );

    Ok(())
}
