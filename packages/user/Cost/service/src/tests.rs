#![allow(non_snake_case)]

#[cfg(test)]
mod tests {
    use psibase::services::tokens;

    use crate::Wrapper;

    // use psibase::services::accounts::Wrapper;

    #[psibase::test_case(packages("Cost"))]
    fn test_set_thing(chain: psibase::Chain) -> Result<(), psibase::Error> {
        // Wrapper::push(&chain).init();

        let alice = AccountNumber::from("alice");
        chain.new_account(alice).unwrap();

        tokens::Wrapper::push_from(&chain, alice).create(precision, max_issued_supply);

        Wrapper::push_from(&chain, alice).new_asset("cats".into(), token_id, tax_rate, valuation)
        Ok(())
    }
}
