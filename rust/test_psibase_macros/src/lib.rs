#[psibase::service]
#[allow(non_snake_case)]
mod service {}

mod tests {

    #[psibase::test_case(packages("PsiMacroTest"))]
    // Chain is inited with default service + whatever is listed in attribute ^^^ (comma-delimited list (case-sensitive))
    // Verifies hygiene
    // TODO: how to expect a particular error?
    fn test_macro_generated_wrapper(chain: psibase::Chain) -> Result<(), psibase::Error> {
        use basicwquery::Wrapper;
        use psibase::AccountNumber;

        println!("{}", Wrapper::SERVICE);
        assert_eq!(Wrapper::SERVICE, AccountNumber::from("basicwquery"));

        assert_eq!(Wrapper::push(&chain).add(3, 4).get()?, 7);

        // TODO: Q: How to call query function? Call serveSys with a graphql request

        Ok(())
    }
}
