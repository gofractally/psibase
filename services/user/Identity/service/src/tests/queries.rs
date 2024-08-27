use crate::{
    service::{Attestation, AttestationStats},
    tests::helpers::test_helpers::{
        init_identity_svc, PartialAttestation, PartialAttestationStats,
    },
};

#[psibase::test_case(services("identity"))]
// ATTEST QUERY: verify first *high* confidence attestation is saved properly to table
pub fn test_attestation_queries(chain: psibase::Chain) -> Result<(), psibase::Error> {
    let svc = init_identity_svc(&chain);
    chain.new_account("carol".into())?;

    svc.from("carol").attest("bob".into(), 76).get()?;
    svc.from("alice").attest("carol".into(), 77).get()?;
    svc.from("alice").attest("bob".into(), 75).get()?;

    let all = svc.query::<Vec<Attestation>>("allAttestations", &[]);
    let all_expected = vec![
        PartialAttestation::new("alice", "bob", 75),
        PartialAttestation::new("carol", "bob", 76),
        PartialAttestation::new("alice", "carol", 77),
    ];
    assert_eq!(&all_expected, &all);

    let all_stats = svc.query::<Vec<AttestationStats>>("allAttestationStats", &[]);
    let all_stats_expected = vec![
        PartialAttestationStats::new("bob", 2, 1),
        PartialAttestationStats::new("carol", 1, 1),
    ];
    assert_eq!(&all_stats_expected, &all_stats);

    let by_subject = svc.query::<Vec<Attestation>>("attestationsBySubject", &[("subject", "bob")]);
    let by_subject_expected = vec![
        PartialAttestation::new("alice", "bob", 75),
        PartialAttestation::new("carol", "bob", 76),
    ];
    assert_eq!(&by_subject_expected, &by_subject);

    let by_subject_stats = svc
        .query::<Option<AttestationStats>>("subjectStats", &[("subject", "bob")])
        .unwrap();
    let by_subject_stats_expected = PartialAttestationStats::new("bob", 2, 1);
    assert!(by_subject_stats_expected == by_subject_stats);

    let by_attester =
        svc.query::<Vec<Attestation>>("attestationsByAttester", &[("attester", "alice")]);
    let by_attester_expected = vec![
        PartialAttestation::new("alice", "bob", 75),
        PartialAttestation::new("alice", "carol", 77),
    ];
    assert_eq!(&by_attester_expected, &by_attester);

    Ok(())
}

#[psibase::test_case(services("identity"))]
// ATTEST QUERY: verify empty query responses are correct
pub fn test_empty_attestation_queries(chain: psibase::Chain) -> Result<(), psibase::Error> {
    let svc = init_identity_svc(&chain);
    chain.new_account("carol".into())?;

    let response = svc.query::<Vec<Attestation>>("allAttestations", &[]);
    assert!(response.len() == 0);

    let response = svc.query::<Vec<AttestationStats>>("allAttestationStats", &[]);
    assert!(response.len() == 0);

    svc.from("carol").attest("bob".into(), 76).get()?;
    svc.from("alice").attest("carol".into(), 77).get()?;
    svc.from("alice").attest("bob".into(), 75).get()?;

    let response = svc.query::<Vec<Attestation>>("attestationsByAttester", &[("attester", "bob")]);
    assert!(response.len() == 0);

    let response = svc.query::<Vec<Attestation>>("attestationsBySubject", &[("subject", "alice")]);
    assert!(response.len() == 0);

    let response = svc.query::<Option<AttestationStats>>("subjectStats", &[("subject", "alice")]);
    assert!(response.is_none());

    Ok(())
}
