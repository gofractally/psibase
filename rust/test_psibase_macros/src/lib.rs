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

    #[should_panic]
    #[psibase::test_case(packages("PsiMacroTest"))]
    // Chain is inited with default service + whatever is listed in attribute ^^^ (comma-delimited list (case-sensitive))
    // Verifies pre_action() calls get inserted as designed
    fn test_pre_action_fails_if_service_not_inited(
        chain: psibase::Chain,
    ) -> Result<(), psibase::Error> {
        use addcheckinit::Wrapper;
        use psibase::AccountNumber;

        assert_eq!(Wrapper::SERVICE, AccountNumber::from("addcheckinit"));

        // call action to trigger the pre_action() which is there and should find service not inited
        let _retval = Wrapper::push(&chain).add(3, 4).get();

        Ok(())
    }

    #[psibase::test_case(packages("PsiMacroTest"))]
    // Chain is inited with default service + whatever is listed in attribute ^^^ (comma-delimited list (case-sensitive))
    // Verifies pre_action() calls get inserted as designed
    fn test_pre_action_inserted(chain: psibase::Chain) -> Result<(), psibase::Error> {
        // TODO: check that pre_action() is *not* inserted into excluded fns
        use addcheckinit::Wrapper;
        use psibase::AccountNumber;

        assert_eq!(Wrapper::SERVICE, AccountNumber::from("addcheckinit"));

        // init service
        let _retval = Wrapper::push(&chain).init();

        // call action to trigger the pre_action() which is now there
        let _retval = Wrapper::push(&chain).add(3, 4).get();

        // check that pre_action() was there and was called
        let retval = Wrapper::push(&chain).check_inited().get().unwrap();
        assert_eq!(retval, true);

        Ok(())
    }
}
