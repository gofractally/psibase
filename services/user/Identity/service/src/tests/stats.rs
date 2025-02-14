use crate::tables::AttestationStats;
use crate::tests::helpers::test_helpers::{init_identity_svc, PartialAttestationStats};
use psibase::AccountNumber;

#[psibase::test_case(services("identity"))]
// STATS: Verify that issued gets updated when a more recent attestation comes in
pub fn test_issued_field_updates(chain: psibase::Chain) -> Result<(), psibase::Error> {
    let svc = init_identity_svc(&chain);
    svc.from("alice").attest("bob".into(), 75).get()?;

    let response = svc.query::<Vec<AttestationStats>>("allAttestationStats");
    let issued_first = response[0].mostRecentAttestation.seconds;

    svc.from("alice").attest("bob".into(), 65).get()?;

    let response = svc.query::<Vec<AttestationStats>>("allAttestationStats");
    let issued_second = response[0].mostRecentAttestation.seconds;

    assert!(issued_first < issued_second);

    Ok(())
}

#[psibase::test_case(services("identity"))]
// STATS: 3 attestations attesting to same subject; check that stats are updated properly as more recent attestations come in
pub fn test_attest_stats_math(chain: psibase::Chain) -> Result<(), psibase::Error> {
    let svc = init_identity_svc(&chain);

    svc.from("alice").attest("bob".into(), 75).get()?;

    let exp_results = vec![PartialAttestationStats::new("bob".into(), 1, 0)];
    let response = svc.query::<Vec<AttestationStats>>("allAttestationStats");
    assert_eq!(&exp_results, &response);

    chain.new_account(AccountNumber::from("alice"))?;
    svc.from("alice").attest("bob".into(), 76).get()?;

    let exp_results = vec![PartialAttestationStats::new("bob".into(), 1, 1)];
    let response = svc.query::<Vec<AttestationStats>>("allAttestationStats");
    assert_eq!(&exp_results, &response);

    svc.from("alice").attest("bob".into(), 75).get()?;

    let exp_results = vec![PartialAttestationStats::new("bob".into(), 1, 0)];
    let response = svc.query::<Vec<AttestationStats>>("allAttestationStats");
    assert_eq!(&exp_results, &response);
    Ok(())
}

#[psibase::test_case(services("identity"))]
// STATS: 4 different attesters attesting to same subject; check that stats are updated properly as new attestations come in
pub fn test_attest_stats_math_over_time(chain: psibase::Chain) -> Result<(), psibase::Error> {
    let svc = init_identity_svc(&chain);

    svc.from("alice").attest("bob".into(), 75).get()?;

    let exp_results = vec![PartialAttestationStats::new("bob".into(), 1, 0)];
    let response = svc.query::<Vec<AttestationStats>>("allAttestationStats");
    assert_eq!(&exp_results, &response);

    chain.new_account(AccountNumber::from("carol"))?;
    svc.from("carol").attest("bob".into(), 76).get()?;

    let exp_results = vec![PartialAttestationStats::new("bob".into(), 2, 1)];
    let response = svc.query::<Vec<AttestationStats>>("allAttestationStats");
    assert_eq!(&exp_results, &response);

    chain.new_account(AccountNumber::from("david"))?;
    svc.from("david").attest("bob".into(), 77).get()?;

    let exp_results = vec![PartialAttestationStats::new("bob", 3, 2)];
    let response = svc.query::<Vec<AttestationStats>>("allAttestationStats");
    assert_eq!(&exp_results, &response);

    chain.new_account(AccountNumber::from("ed"))?;
    svc.from("ed").attest("bob".into(), 60).get()?;

    let exp_results = vec![PartialAttestationStats::new("bob".into(), 4, 2)];
    let response = svc.query::<Vec<AttestationStats>>("allAttestationStats");
    assert_eq!(&exp_results, &response);

    Ok(())
}
