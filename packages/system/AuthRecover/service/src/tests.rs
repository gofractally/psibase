#![allow(non_snake_case)]

#[cfg(test)]
mod tests {
    use crate::Wrapper;
    use psibase::*;

    #[psibase::test_case(packages("AuthRecover"))]
    fn test_(chain: psibase::Chain) -> Result<(), psibase::Error> {
        let alice = account!("alice");
        chain.new_account(alice).unwrap();

        // create bob
        // recover -> setKey + activate
        // setKey + activate w/out recover (using original key)
        // setKey without activate should fail
        //
        // recover by itself should not interfere with normal usage
        // setKey doesn't block other accounts (except for more setKeys)

        Ok(())
    }
}
