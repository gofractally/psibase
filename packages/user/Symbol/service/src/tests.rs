#![allow(non_snake_case)]

#[cfg(test)]
mod tests {
    use crate::Wrapper;
    use psibase::*;

    #[psibase::test_case(packages("Symbol"))]
    fn test_set_thing(chain: psibase::Chain) -> Result<(), psibase::Error> {
        Wrapper::push(&chain).init();

        let alice = AccountNumber::from("alice");
        chain.new_account(alice).unwrap();

        Wrapper::push_from(&chain, alice)
            .setExampleThing("a new thing".to_string())
            .get()?;

        Ok(())
    }
}
