// Q: How is SERVICE possibly properly defined here? and how is the Wrapper the right wrapper?
use serde_json::json;

use psibase::AccountNumber;

use crate::tests::test_helpers::*;

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
        &json!([{"subject": "bob", "uniqueAttesters": 1, "percHighConf": 100}]),
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
        &json!([{"subject": "bob", "uniqueAttesters": 1, "percHighConf": 0}]),
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
        &json!([{"subject": subject.clone(), "uniqueAttesters": 1, "percHighConf": 0}]),
    );

    expect_attestations(
        &chain,
        &json!([{"attester": attester, "subject": subject.clone().to_string(), "value": value}]),
    );

    let attester2 = AccountNumber::from("carol");
    let value2 = 76;

    chain.start_block();
    // http_server::Wrapper::push_from(&chain, SERVICE).registerServer(SERVICE);
    chain.new_account(attester2)?;

    chain.start_block();
    test_attest(&chain, attester2, subject.clone(), value2)?;

    expect_attestations(
        &chain,
        &json!([{"attester": attester, "subject": subject.clone().to_string(), "value": value},{"attester": attester2, "subject": subject.clone().to_string(), "value": value2}]),
    );

    expect_attestation_stats(
        &chain,
        &json!([{"subject": subject, "uniqueAttesters": 2, "percHighConf": 50}]),
    );

    let attester3 = AccountNumber::from("david");
    let value3 = 77;

    chain.start_block();
    // http_server::Wrapper::push_from(&chain, SERVICE).registerServer(SERVICE);
    chain.new_account(attester3)?;

    chain.start_block();
    test_attest(&chain, attester3, subject.clone(), value3)?;

    expect_attestations(
        &chain,
        &json!([{"attester": attester, "subject": subject.clone().to_string(), "value": value},{"attester": attester2, "subject": subject.clone().to_string(), "value": value2},{"attester": attester3, "subject": subject.clone().to_string(), "value": value3}]),
    );

    expect_attestation_stats(
        &chain,
        &json!([{"subject": subject, "uniqueAttesters": 3, "percHighConf": 67}]),
    );

    Ok(())
}
