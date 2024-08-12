// #[psibase::test_case(services("identity"))]
// ATTEST: verify first *high* confidence attestation is saved properly to table
// pub fn test_attest_first_high_conf(chain: psibase::Chain) -> Result<(), psibase::Error> {
//     init_identity_svc(&chain)?;

//     let exp_results = vec![PartialAttestation {
//         attester: AccountNumber::from("alice"),
//         subject: AccountNumber::from("bob"),
//         value: 95,
//     }];

//     push_attest(
//         &chain,
//         exp_results[0].attester,
//         exp_results[0].subject,
//         exp_results[0].value,
//     )?;

//     // expect_attestations(&chain, &exp_results);
//     expect_from_attestation_query(
//         &chain,
//         "attestationsByAttestee",
//         get_gql_query_attestations_by_attestee(AccountNumber::from("bob")),
//         &exp_results,
//     );

//     expect_attestation_stats(
//         &chain,
//         &json!([{"subject": "bob", "uniqueAttesters": 1, "numHighConfAttestations": 1}]),
//     );

// let exp_results = vec![PartialAttestationStats {
//     subject: AccountNumber::from("bob"),
//     uniqueAttesters: 1,
//     numHighConfAttestations: 1,
// }];
// expect_from_attestation_stats_query(
//     &chain,
//     "allAttestationStats",
//     get_gql_query_attestation_stats(),
//     &exp_results,
// );

//     Ok(())
// }

// #[psibase::test_case(services("identity"))]
// // ATTEST: verify first *low* confidence attestation is saved properly to table
// pub fn test_attest_first_low_conf(chain: psibase::Chain) -> Result<(), psibase::Error> {
//     init_identity_svc(&chain)?;
//     push_attest(
//         &chain,
//         AccountNumber::from("alice"),
//         AccountNumber::from("bob"),
//         75,
//     )?;

//     let exp_results = vec![PartialAttestation {
//         attester: AccountNumber::from("alice"),
//         subject: AccountNumber::from("bob"),
//         value: 75,
//     }];
//     expect_from_attestation_query(
//         &chain,
//         "attestationsByAttestee",
//         get_gql_query_attestations_by_attestee(AccountNumber::from("bob")),
//         &exp_results,
//     );

//     let exp_results = vec![PartialAttestationStats {
//         subject: AccountNumber::from("bob"),
//         uniqueAttesters: 1,
//         numHighConfAttestations: 0,
//     }];
//     expect_from_attestation_stats_query(
//         &chain,
//         "allAttestationStats",
//         get_gql_query_attestation_stats(),
//         &exp_results,
//     );

//     Ok(())
// }
