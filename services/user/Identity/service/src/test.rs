#[psibase::test_case(services("identity"))]
pub fn test_1(chain: psibase::Chain) -> Result<(), psibase::Error> {
    use psibase::services::http_server;
    use psibase::AccountNumber;
    // use serde_json::{json, Value};

    http_server::Wrapper::push_from_to(&chain, AccountNumber::from("alice1"), SERVICE)
        .registerServer(SERVICE);
    let result = Wrapper::push(&chain).attest(String::from("bob1"), 95);
    assert_eq!(result.get()?, ());
    println!("\n\nTrace:\n{}", result.trace);

    chain.finish_block();
    // let reply: Value = chain.graphql(
    //     SERVICE,
    //     r#"query { allAttestationStats { uniqueAttestations } }"#,
    // )?;
    // assert_eq!(
    //     reply,
    //     json!({ "data": { "allAttestationsStats": {"uniqueAttestations": 1} } })
    // );

    Ok(())
}
