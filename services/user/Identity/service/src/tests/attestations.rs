use psibase::AccountNumber;

use crate::tables::{Attestation, AttestationStats};
use crate::tests::helpers::test_helpers::{
    init_identity_svc, PartialAttestation, PartialAttestationStats,
};

#[psibase::test_case(packages("Identity"))]
// ATTEST: verify first *high* confidence attestation is saved properly to table
pub fn test_attest_first_high_conf(chain: psibase::Chain) -> Result<(), psibase::Error> {
    let svc = init_identity_svc(&chain);

    chain.new_account("alice".into())?;
    chain.new_account("bob".into())?;

    svc.from("alice").attest("bob".into(), 95).get()?;

    let exp_results = vec![PartialAttestation::new("alice".into(), "bob".into(), 95)];
    let results = svc.query::<Vec<Attestation>>(r#"attestationsBySubject(subject: "bob")"#);
    assert_eq!(&exp_results, &results);

    let exp_results = vec![PartialAttestationStats::new("bob".into(), 1, 1)];
    let response = svc.query::<Vec<AttestationStats>>("allAttestationStats");
    assert_eq!(&exp_results, &response);

    Ok(())
}

#[psibase::test_case(packages("Identity"))]
// ATTEST: verify first *low* confidence attestation is saved properly to table
pub fn test_attest_first_low_conf(chain: psibase::Chain) -> Result<(), psibase::Error> {
    let svc = init_identity_svc(&chain);

    let alice = AccountNumber::from("alice");
    chain.new_account(alice).unwrap();
    let bob = AccountNumber::from("bob");
    chain.new_account(bob).unwrap();

    svc.from("alice").attest("bob".into(), 75).get()?;

    let exp_results = vec![PartialAttestation::new("alice".into(), "bob".into(), 75)];
    let results = svc.query::<Vec<Attestation>>(r#"attestationsBySubject(subject: "bob")"#);
    assert_eq!(&results, &exp_results);

    let exp_results = vec![PartialAttestationStats::new("bob".into(), 1, 0)];
    let response = svc.query::<Vec<AttestationStats>>("allAttestationStats");
    assert_eq!(&exp_results, &response);

    Ok(())
}
