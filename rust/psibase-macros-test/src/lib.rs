#[psibase::service]
#[allow(non_snake_case)]
mod service {}

mod tests {

    #[psibase::test_case(packages("PsiMacroTest"))]
    // Chain is inited with default service + whatever is listed in attribute ^^^ (comma-delimited list (case-sensitive))
    // Verifies hygiene (how to expect a particular error?)
    fn test_macro_generated_wrapper(chain: psibase::Chain) -> Result<(), psibase::Error> {
        use basicwquery::Wrapper;
        use psibase::AccountNumber;

        println!("{}", Wrapper::SERVICE);
        assert_eq!(Wrapper::SERVICE, AccountNumber::from("basicwquery"));

        // Wrapper::push(&chain).add(3, 4);
        // Don't know why the .get()? break this line:
        assert_eq!(Wrapper::push(&chain).add(3, 4).get()?, 7);

        // event emission must be called from within service; so this is call we can do here
        Wrapper::emit().history();

        // This can only be called from within a service
        // Wrapper::call() uses and therefore covers the testing of service::Actions
        // let ret = Wrapper::call(); //.add(2, 3);

        // Q: How to call query function? Call serveSys with a graphql request

        Ok(())
    }

    #[psibase::test_case(packages("PsiMacroTest"))]
    // Chain is inited with default service + whatever is listed in attribute ^^^ (comma-delimited list (case-sensitive))
    // Verifies check_init() calls get inserted as designed
    fn test_check_init(chain: psibase::Chain) -> Result<(), psibase::Error> {
        use addcheckinit::Wrapper;
        use psibase::AccountNumber;

        println!("{}", Wrapper::SERVICE);
        assert_eq!(Wrapper::SERVICE, AccountNumber::from("addcheckinit"));

        println!("result of 3+4: {}", Wrapper::push(&chain).add(3, 4).get()?);
        assert_eq!(Wrapper::push(&chain).add(3, 4).get()?, 7);

        let retval = Wrapper::push(&chain).check_inited().get();
        println!("check_init() retval: {:?}", retval);
        assert!(Wrapper::push(&chain).check_inited().get().is_ok());

        // Q: How to call query function? Call serveSys with a graphql request

        Ok(())
    }
}
