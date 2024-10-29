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

        assert_eq!(Wrapper::push(&chain).add(3, 4).get()?, 7);

        // Q: How to call query function? Call serveSys with a graphql request
        // TODO: from James: The unit test in test_contract_2 has an example of making a GET, POST, and a graphql POST on the chain object.

        Ok(())
    }
}
