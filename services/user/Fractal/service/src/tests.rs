#![allow(non_snake_case)]

#[cfg(test)]
mod tests {
    use crate::Wrapper;
    use psibase::*;

    #[psibase::test_case(packages("Fractal"))]
    fn test_create_fractal(chain: psibase::Chain) -> Result<(), psibase::Error> {
        Wrapper::push(&chain).init();

        let alice = AccountNumber::from("alice");
        chain.new_account(alice).unwrap();

        Wrapper::push_from(&chain, alice)
            .create_fractal("Fractal 1".to_string(), "To boldy test what no one has tested before".to_string())
            .get()?;

        Ok(())
    }
}
