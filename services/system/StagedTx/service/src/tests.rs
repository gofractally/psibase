#![allow(non_snake_case)]

#[cfg(test)]
mod tests {
    use crate::Wrapper;
    use psibase::fracpack::Pack;
    use psibase::services::nft as Nft;
    use psibase::*;

    #[psibase::test_case(packages("StagedTx", "Nft", "AuthSig"))]
    fn test_propose(chain: psibase::Chain) -> Result<(), psibase::Error> {
        let alice = AccountNumber::from("alice");
        chain.new_account(alice).unwrap();

        let bob = AccountNumber::from("bob");
        chain.new_account(bob).unwrap();

        Wrapper::push_from(&chain, alice)
            .propose(vec![Action {
                sender: bob,
                service: Nft::SERVICE,
                method: MethodNumber::from("mint"),
                rawData: Nft::action_structs::mint {}.packed().into(),
            }])
            .get()?;

        Ok(())
    }
}
