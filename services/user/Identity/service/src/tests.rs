// Q: How is SERVICE possibly properly defined here? and how is the Wrapper the right wrapper?
use crate::SERVICE;
use psibase::services::http_server;
use psibase::AccountNumber;

fn test_attest(
    chain: &psibase::Chain,
    attester: AccountNumber,
    subject: String,
    conf: u8,
) -> Result<(), psibase::Error> {
    http_server::Wrapper::push_from(&chain, SERVICE).registerServer(SERVICE);
    http_server::Wrapper::push_to(&chain, SERVICE).registerServer(SERVICE);
    let result = crate::Wrapper::push_from(&chain, attester).attest(subject, conf);
    assert_eq!(result.get()?, ());
    println!("\n\nTrace:\n{}", result.trace);

    chain.finish_block();
    Ok(())
}

#[psibase::test_case(services("identity"))]
pub fn test_attest_high_conf(chain: psibase::Chain) -> Result<(), psibase::Error> {
    use serde_json::{json, Value};

    test_attest(
        &chain,
        AccountNumber::from("alice"),
        String::from("bob"),
        95,
    )?;

    let attestation_reply: Value = chain.graphql(
        SERVICE,
        r#"query { attestationsByAttestee(attestee: "bob") { nodes { attester, subject, value } } }"#,
    )?;
    println!("graphql reply: {}", attestation_reply);
    assert_eq!(
        attestation_reply,
        json!({ "data": { "attestationsByAttestee": { "nodes": [{"attester": "alice", "subject": "bob", "value": 95}] } } })
    );

    let reply: Value = chain.graphql(
        SERVICE,
        r#"query { allAttestationStats { subject, uniqueAttesters } }"#,
    )?;
    println!("graphql reply: {}", reply);
    assert_eq!(
        reply,
        json!({ "data": { "allAttestationStats": [{"subject": "bob", "uniqueAttesters": 1}] } })
    );

    Ok(())
}

#[psibase::test_case(services("identity"))]
pub fn test_attest_low_conf(chain: psibase::Chain) -> Result<(), psibase::Error> {
    // use psibase::HttpBody;
    use serde_json::{json, Value};

    test_attest(
        &chain,
        AccountNumber::from("alice"),
        String::from("bob"),
        75,
    )?;

    let attestation_reply: Value = chain.graphql(
        SERVICE,
        r#"query { attestationsByAttestee(attestee: "bob") { nodes { attester, subject, value } } }"#,
    )?;
    println!("graphql reply: {}", attestation_reply);
    assert_eq!(
        attestation_reply,
        json!({ "data": { "attestationsByAttestee": { "nodes": [{"attester": "alice", "subject": "bob", "value": 75}] } } })
    );

    let reply: Value = chain.graphql(
        SERVICE,
        r#"query { allAttestationStats { subject, uniqueAttesters } }"#,
        // r#"query { allAttestations { attester subject value } }"#,
    )?;
    println!("graphql reply: {}", reply);
    assert_eq!(
        reply,
        json!({ "data": { "allAttestationStats": [{"subject": "bob", "uniqueAttesters": 1}] } })
    );

    Ok(())
}
