#[psibase::service]
#[allow(non_snake_case)]
mod service {}

#[cfg(test)]
mod tests {
    use psibase::services::http_server;
    use serde_json::{json, Value};

    #[psibase::test_case(packages("PsiMacroTest"))]
    // Chain is inited with default service + whatever is listed in attribute ^^^ (comma-delimited list (case-sensitive))
    fn test_macro_generated_wrapper(chain: psibase::Chain) -> Result<(), psibase::Error> {
        use basicwquery::Wrapper;
        use psibase::AccountNumber;

        println!("{}", Wrapper::SERVICE);
        http_server::Wrapper::push_from(&chain, Wrapper::SERVICE).registerServer(Wrapper::SERVICE);

        assert_eq!(Wrapper::SERVICE, AccountNumber::from("basicwquery"));

        assert_eq!(Wrapper::push(&chain).add(3, 4).get()?, 7);

        chain.finish_block();
        let reply: Value = chain.graphql(Wrapper::SERVICE, r#"query { queryFn1 }"#)?;
        assert_eq!(reply, json!({ "data": { "queryFn1": "Return value" }}));

        Ok(())
    }
}
