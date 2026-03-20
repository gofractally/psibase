#![allow(non_snake_case)]

#[cfg(test)]
mod tests {
    use crate::Wrapper as PremAccounts;
    use psibase::services::nft::Wrapper as Nfts;
    use psibase::services::tokens::{Precision, Quantity, Wrapper as Tokens};
    use psibase::*;

    // Creates a system token and distributes it to alice and bob
    fn initial_setup(chain: &psibase::Chain) -> Result<(), psibase::Error> {
        let tokens_service = Tokens::SERVICE;
        let symbol = account!("symbol");
        let alice = account!("alice");
        let bob = account!("bob");

        chain.new_account(alice).unwrap();
        chain.new_account(bob).unwrap();

        let supply: u64 = 10_000_000_000_000_0000u64.into();
        let sys = Tokens::push_from(chain, symbol)
            .create(Precision::new(4).unwrap(), Quantity::from(supply))
            .get()?;

        let nid = Tokens::push(&chain).getToken(sys).get()?.nft_id;
        Nfts::push_from(chain, symbol).debit(nid, "".into()).get()?;

        Tokens::push_from(chain, tokens_service)
            .setSysToken(sys)
            .get()?;

        Tokens::push_from(chain, symbol)
            .mint(sys, Quantity::from(supply), "".into())
            .get()?;

        Tokens::push_from(chain, symbol)
            .credit(sys, alice, 100_000_0000u64.into(), "".into())
            .get()?;

        Tokens::push_from(chain, symbol)
            .credit(sys, bob, 100_000_0000u64.into(), "".into())
            .get()?;

        Ok(())
    }

    #[psibase::test_case(packages("PremAccounts"))] //, "Tokens", "Nft"))]
    fn test_buy_account(chain: psibase::Chain) -> Result<(), psibase::Error> {
        initial_setup(&chain)?;

        let alice = AccountNumber::from("alice");

        Tokens::push_from(&chain, alice)
            .credit(1, "prem-accounts".into(), 1000_0000u64.into(), "".into())
            .get()?;

        PremAccounts::push_from(&chain, alice)
            .buy("test".to_string(), 1000_0000u64)
            .get()?;

        Ok(())
    }
}
