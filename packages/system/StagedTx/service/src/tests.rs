#![allow(non_snake_case)]

#[cfg(test)]
mod tests {
    use crate::Wrapper;
    use psibase::fracpack::Pack;
    use psibase::services::nft as Nft;
    use psibase::*;

    #[psibase::test_case(packages("StagedTx", "Nft", "AuthSig"))]
    fn test_propose(chain: psibase::Chain) -> Result<(), psibase::Error> {
        Wrapper::push(&chain).init();

        let alice = AccountNumber::from("alice");
        chain.new_account(alice).unwrap();

        let bob = AccountNumber::from("bob");
        chain.new_account(bob).unwrap();

        // Find next free NFT id (boot or other packages may already use 1)
        let next_id = (1..)
            .find(|&id| !Nft::Wrapper::push(&chain).exists(id).get().unwrap())
            .unwrap();

        Wrapper::push_from(&chain, alice)
            .propose(
                vec![Action {
                    sender: bob,
                    service: Nft::SERVICE,
                    method: MethodNumber::from("mint"),
                    rawData: Nft::action_structs::mint {}.packed().into(),
                }],
                true,
            )
            .get()?;

        chain.finish_block();

        // After execution, bob owns the minted NFT
        let nft = Nft::Wrapper::push(&chain).getNft(next_id).get()?;
        assert_eq!(nft.owner, bob);

        Ok(())
    }
}
