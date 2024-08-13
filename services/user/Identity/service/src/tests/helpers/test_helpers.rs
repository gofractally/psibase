use crate::service::{Attestation, AttestationStats};
use crate::SERVICE;
use psibase::AccountNumber;

#[derive(Clone, Debug)]
pub struct PartialAttestation {
    pub attester: AccountNumber,
    pub subject: AccountNumber,
    pub value: u8,
}

#[derive(Clone, Debug)]
#[allow(non_snake_case)]
pub struct PartialAttestationStats {
    pub subject: AccountNumber,
    pub uniqueAttesters: u16,
    pub numHighConfAttestations: u16,
}

pub fn init_identity_svc(chain: &psibase::Chain) -> Result<(), psibase::Error> {
    use crate::SERVICE;
    use psibase::services::http_server;

    http_server::Wrapper::push_from(&chain, SERVICE).registerServer(SERVICE);

    return Ok(());
}

pub fn push_attest(
    chain: &psibase::Chain,
    attester: AccountNumber,
    subject: AccountNumber,
    conf: u8,
) -> Result<(), psibase::Error> {
    crate::Wrapper::push_from(&chain, attester)
        .attest(subject.clone(), conf)
        .get()?;

    chain.finish_block();
    Ok(())
}

pub fn query_attestations(
    chain: &psibase::Chain,
    query_name: &str,
    graphql_query: String,
) -> Vec<Attestation> {
    let res: serde_json::Value = chain.graphql(SERVICE, &graphql_query).unwrap();
    serde_json::from_value::<Vec<Attestation>>(res["data"][query_name]["nodes"].clone()).unwrap()
}

pub fn query_subject_stats(
    chain: &psibase::Chain,
    query_name: &str,
    graphql_query: String,
) -> Option<AttestationStats> {
    let res: serde_json::Value = chain.graphql(SERVICE, &graphql_query).unwrap();
    match serde_json::from_value::<AttestationStats>(res["data"][query_name].clone()) {
        Ok(val) => return Some(val),
        Err(_) => return None,
    }
}

pub fn query_attestation_stats(
    chain: &psibase::Chain,
    query_name: &str,
    graphql_query: String,
) -> Vec<AttestationStats> {
    let res: serde_json::Value = chain.graphql(SERVICE, &graphql_query).unwrap();
    serde_json::from_value::<Vec<AttestationStats>>(res["data"][query_name]["nodes"].clone())
        .unwrap()
}

pub fn are_equal_vecs_of_attestations_stats(
    exp_results: &Vec<PartialAttestationStats>,
    results: &Vec<AttestationStats>,
) -> bool {
    if results.len() != exp_results.len() {
        return false;
    }
    for exp_rec in exp_results {
        match results.iter().find(|rec| {
            rec.subject == exp_rec.subject
                && rec.uniqueAttesters == exp_rec.uniqueAttesters
                && rec.numHighConfAttestations == exp_rec.numHighConfAttestations
        }) {
            Some(_) => continue,
            None => return false,
        }
    }
    true
}

pub fn are_equal_vecs_of_attestations(
    exp_results: &Vec<PartialAttestation>,
    results: &Vec<Attestation>,
) -> bool {
    if results.len() != exp_results.len() {
        return false;
    }
    for exp_rec in exp_results {
        match results.iter().find(|rec| {
            rec.attester == exp_rec.attester
                && rec.subject == exp_rec.subject
                && rec.value == exp_rec.value
        }) {
            Some(_) => continue,
            None => return false,
        }
    }
    true
}
