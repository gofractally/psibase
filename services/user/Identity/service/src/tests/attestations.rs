use crate::service::{Attestation, AttestationStats};
use crate::tests::helpers::test_helpers::{
    assert_equal, init_identity_svc, PartialAttestation, PartialAttestationStats,
};

#[psibase::test_case(services("identity"))]
// ATTEST: verify first *high* confidence attestation is saved properly to table
pub fn test_attest_first_high_conf(chain: psibase::Chain) -> Result<(), psibase::Error> {
    let svc = init_identity_svc(&chain);

    svc.from("alice").attest("bob".into(), 95).get()?;

    let exp_results = vec![PartialAttestation::new("alice".into(), "bob".into(), 95)];
    let results = svc.query::<Vec<Attestation>>("attestationsBySubject", &[("subject", "bob")]);
    assert_equal(&exp_results, &results);

    let exp_results = vec![PartialAttestationStats::new("bob".into(), 1, 1)];
    let response = svc.query::<Vec<AttestationStats>>("allAttestationStats", &[]);
    assert_equal(&exp_results, &response);

    Ok(())
}

#[psibase::test_case(services("identity"))]
// ATTEST: verify first *low* confidence attestation is saved properly to table
pub fn test_attest_first_low_conf(chain: psibase::Chain) -> Result<(), psibase::Error> {
    let svc = init_identity_svc(&chain);

    svc.from("alice").attest("bob".into(), 75).get()?;

    let exp_results = vec![PartialAttestation::new("alice".into(), "bob".into(), 75)];
    let results = svc.query::<Vec<Attestation>>("attestationsBySubject", &[("subject", "bob")]);
    assert_equal(&results, &exp_results);

    let exp_results = vec![PartialAttestationStats::new("bob".into(), 1, 0)];
    let response = svc.query::<Vec<AttestationStats>>("allAttestationStats", &[]);
    assert_equal(&exp_results, &response);

    Ok(())
}
