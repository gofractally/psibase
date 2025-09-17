#![allow(non_snake_case)]

#[cfg(test)]
mod tests {
    use crate::Wrapper;
    use psibase::*;

    #[psibase::test_case(packages("Difficulty"))]
    fn test_set_thing(chain: psibase::Chain) -> Result<(), psibase::Error> {
        let alice = AccountNumber::from("alice");
        chain.new_account(alice).unwrap();

        Wrapper::push_from(&chain, alice)
            .create(32, 32, 33.into(), 2)
            .get()?;

        Ok(())
    }
}
