#![allow(non_snake_case)]

#[cfg(test)]
mod tests {

    #[psibase::test_case(packages("Guilds"))]
    fn test_set_thing(_chain: psibase::Chain) -> Result<(), psibase::Error> {
        // Wrapper::push(&chain).init();

        // let alice = AccountNumber::from("alice");
        // chain.new_account(alice).unwrap();

        // Wrapper::push_from(&chain, alice)
        //     .setExampleThing("a new thing".to_string())
        //     .get()?;

        Ok(())
    }
}
