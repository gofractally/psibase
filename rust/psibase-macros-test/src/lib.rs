#[psibase::service]
#[allow(non_snake_case)]
mod service {}

mod tests {

    #[psibase::test_case(packages("PsiMacroTest"))]
    // Chain is inited with default service + whatever is listed in attribute ^^^ (comma-delimited list (case-sensitive))
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
}
