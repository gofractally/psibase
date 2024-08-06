// Q: How is SERVICE possibly properly defined here? and how is the Wrapper the right wrapper?
use serde_json::json;

use psibase::AccountNumber;

use crate::tests::test_helpers::*;

#[psibase::test_case(services("identity"))]
pub fn test_reject_invalid_scores(chain: psibase::Chain) -> Result<(), psibase::Error> {
    let expected_err = "service 'identity' aborted with message: bad confidence score";
    match test_attest(
        &chain,
        AccountNumber::from("alice"),
        String::from("bob"),
        101,
    ) {
        Err(e) => assert_eq!(
            e.to_string(),
            expected_err,
            "Transaction failed with \"{}\", but was expected to fail with: \"{}\"",
            e.to_string(),
            expected_err
        ),
        _ => panic!(
            "Transaction succeeded, but was expected to fail with: \"{}\"",
            expected_err
        ),
    }

    chain.finish_block();
    expect_attestation_stats(&chain, &json!([]));

    chain.start_block();

    match test_attest(
        &chain,
        AccountNumber::from("alice"),
        String::from("bob"),
        255,
    ) {
        Ok(_) => {
            return Err(psibase::Error::msg(
                "Confidence scores <0 should not have been accepted.",
            ))
        }
        Err(_) => (), // This is expected
    }

    expect_attestation_stats(&chain, &json!([]));

    Ok(())
}

#[psibase::test_case(services("identity"))]
pub fn test_attest_first_high_conf(chain: psibase::Chain) -> Result<(), psibase::Error> {
    test_attest(
        &chain,
        AccountNumber::from("alice"),
        String::from("bob"),
        95,
    )?;

    expect_attestation_stats(
        &chain,
        &json!([{"subject": "bob", "uniqueAttesters": 1, "numHighConfAttestations": 1}]),
    );

    Ok(())
}

#[psibase::test_case(services("identity"))]
pub fn test_attest_first_low_conf(chain: psibase::Chain) -> Result<(), psibase::Error> {
    test_attest(
        &chain,
        AccountNumber::from("alice"),
        String::from("bob"),
        75,
    )?;

    expect_attestation_stats(
        &chain,
        &json!([{"subject": "bob", "uniqueAttesters": 1, "numHighConfAttestations": 0}]),
    );

    Ok(())
}

#[psibase::test_case(services("identity"))]
pub fn test_attest_stats_math(chain: psibase::Chain) -> Result<(), psibase::Error> {
    let attester = AccountNumber::from("alice");
    let subject = String::from("bob");
    let value = 75;

    test_attest(&chain, attester, subject.clone(), value)?;

    expect_attestation_stats(
        &chain,
        &json!([{"subject": subject.clone(), "uniqueAttesters": 1, "numHighConfAttestations": 0}]),
    );

    expect_attestations(
        &chain,
        &json!([{"attester": attester, "subject": subject.clone().to_string(), "value": value}]),
    );

    let attester2 = AccountNumber::from("carol");
    let value2 = 76;

    chain.start_block();
    chain.new_account(attester2)?;

    chain.start_block();
    test_attest(&chain, attester2, subject.clone(), value2)?;

    expect_attestations(
        &chain,
        &json!([{"attester": attester, "subject": subject.clone().to_string(), "value": value},{"attester": attester2, "subject": subject.clone().to_string(), "value": value2}]),
    );

    expect_attestation_stats(
        &chain,
        &json!([{"subject": subject, "uniqueAttesters": 2, "numHighConfAttestations": 1}]),
    );

    let attester3 = AccountNumber::from("david");
    let value3 = 77;

    chain.start_block();
    chain.new_account(attester3)?;

    chain.start_block();
    test_attest(&chain, attester3, subject.clone(), value3)?;

    expect_attestations(
        &chain,
        &json!([{"attester": attester, "subject": subject.clone().to_string(), "value": value},{"attester": attester2, "subject": subject.clone().to_string(), "value": value2},{"attester": attester3, "subject": subject.clone().to_string(), "value": value3}]),
    );

    expect_attestation_stats(
        &chain,
        &json!([{"subject": subject, "uniqueAttesters": 3, "numHighConfAttestations": 2}]),
    );

    // check that issued is updated when an attestation is updated
    chain.start_block();
    let reply: serde_json::Value = chain
        .graphql(
            crate::SERVICE,
            r#"query { allAttestationStats { subject, uniqueAttesters, numHighConfAttestations, mostRecentAttestation { seconds } } }"#,
        )
        .unwrap();
    let issued1 = &reply["data"]["allAttestationStats"][0]["mostRecentAttestation"]["seconds"];

    let value4 = 83;

    test_attest(&chain, attester3, subject.clone(), value4)?;

    let reply: serde_json::Value = chain
        .graphql(
            crate::SERVICE,
            r#"query { allAttestationStats { subject, uniqueAttesters, numHighConfAttestations, mostRecentAttestation { seconds } } }"#,
        )
        .unwrap();
    let issued2 = &reply["data"]["allAttestationStats"][0]["mostRecentAttestation"]["seconds"];

    assert_ne!(issued1, issued2);

    Ok(())
}

#[psibase::test_case(services("identity"))]
pub fn test_attest_stats_math_over_time(chain: psibase::Chain) -> Result<(), psibase::Error> {
    let attester = AccountNumber::from("alice");
    let subject = String::from("bob");
    let value = 75;

    test_attest(&chain, attester, subject.clone(), value)?;

    expect_attestation_stats(
        &chain,
        &json!([{"subject": subject.clone(), "uniqueAttesters": 1, "numHighConfAttestations": 0}]),
    );

    let attester2 = AccountNumber::from("carol");
    let value2 = 76;

    chain.start_block();
    chain.new_account(attester2)?;

    chain.start_block();
    test_attest(&chain, attester2, subject.clone(), value2)?;

    expect_attestation_stats(
        &chain,
        &json!([{"subject": subject, "uniqueAttesters": 2, "numHighConfAttestations": 1}]),
    );

    let attester3 = AccountNumber::from("david");
    let value3 = 77;

    chain.start_block();
    chain.new_account(attester3)?;

    chain.start_block();
    test_attest(&chain, attester3, subject.clone(), value3)?;

    expect_attestation_stats(
        &chain,
        &json!([{"subject": subject, "uniqueAttesters": 3, "numHighConfAttestations": 2}]),
    );

    let attester4 = AccountNumber::from("ed");
    let value4 = 95;

    chain.start_block();
    chain.new_account(attester4)?;

    chain.start_block();
    test_attest(&chain, attester4, subject.clone(), value4)?;

    expect_attestation_stats(
        &chain,
        &json!([{"subject": subject, "uniqueAttesters": 4, "numHighConfAttestations": 3}]),
    );

    Ok(())
}
