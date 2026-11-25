#[psibase::service(name = "psimacro-t")]
#[allow(non_snake_case)]
mod service {}

#[cfg(test)]
mod tests {
    use psibase::services::http_server;
    use psibase::{account, Push};
    use serde_json::{json, Value};

    #[psibase::test_case(packages("PsiMacroTest"))]
    // Chain is inited with default service + whatever is listed in attribute ^^^ (comma-delimited list (case-sensitive))
    fn test_macro_generated_wrapper(chain: psibase::Chain) -> Result<(), psibase::Error> {
        use basicwquery::Wrapper;

        println!("{}", Wrapper::SERVICE);

        assert_eq!(Wrapper::SERVICE, account!("basicquery"));

        assert_eq!(Wrapper::push(&chain).add(3, 4).get()?, 7);

        // `mincallrecvr` asks for `psio = true`: its actions are also
        // declared as a PSIO interface.
        {
            use mincallrecvr::psio_actions;
            use psibase::psio::interface::{Interface, Method};
            assert_eq!(psio_actions::Tag::NAME, "minrecvr");
            assert_eq!(psio_actions::Tag::METHODS[0].name, "add2");
            assert_eq!(psio_actions::Tag::METHODS[0].params, ["a", "b"]);
            assert_eq!(<psio_actions::args::add2 as Method>::NAME, "add2");
            // The argument record is the tuple of the parameters.
            assert_eq!(
                psibase::psio::to_pssz(&psio_actions::args::add2 { a: 3, b: 5 }),
                psibase::psio::to_pssz(&(3i32, 5i32))
            );
        }

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

        assert_eq!(Wrapper::SERVICE, account!("addckinit"));

        // call action to trigger the pre_action() which is there and should find service not inited
        let _retval = Wrapper::push(&chain).add(3, 4).get();

        Ok(())
    }

    #[psibase::test_case(packages("PsiMacroTest"))]
    // Chain is inited with default service + whatever is listed in attribute ^^^ (comma-delimited list (case-sensitive))
    // Verifies pre_action() calls get inserted as designed
    fn test_pre_action_inserted(chain: psibase::Chain) -> Result<(), psibase::Error> {
        use addcheckinit::Wrapper;

        assert_eq!(Wrapper::SERVICE, account!("addckinit"));

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
