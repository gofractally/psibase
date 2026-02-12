#![allow(non_snake_case)]

#[cfg(test)]
mod tests {
    use crate::Wrapper;
    use psibase::services::nft::Wrapper as Nfts;
    use psibase::services::tokens::{Precision, Quantity, Wrapper as Tokens};
    use psibase::*;

    #[psibase::test_case(packages("PremAccounts"))]
    fn test_buy_account(chain: psibase::Chain) -> Result<(), psibase::Error> {
        Wrapper::push(&chain).init();

        let alice = AccountNumber::from("alice");
        chain.new_account(alice).unwrap();

        // Set up system token
        // Create token from symbol service (or we can use a test account)
        let symbol_service = account!("symbol");
        let sys_token_id = Tokens::push_from(&chain, symbol_service)
            .create(
                Precision::new(4).unwrap(),
                Quantity::from(1_000_000_000_0000),
            )
            .get()?;

        // Debit the NFT from symbol service
        let token_info = Tokens::push(&chain).getToken(sys_token_id).get()?;
        Nfts::push_from(&chain, symbol_service)
            .debit(token_info.nft_id, "".to_string().try_into().unwrap());

        Tokens::push(&chain).setSysToken(sys_token_id).get()?;

        let mint_amount = Quantity::from(1_000_000_000_0000);
        Tokens::push_from(&chain, symbol_service)
            .mint(
                sys_token_id,
                mint_amount,
                "memo".to_string().try_into().unwrap(),
            )
            .get()?;

        Tokens::push_from(&chain, symbol_service)
            .setTokenConf(sys_token_id, 0, false) // 0 = untransferable flag
            .get()?;

        let alice_amount = Quantity::from(1001_0000); // 1001 with 4 decimal precision
        Tokens::push_from(&chain, symbol_service)
            .credit(
                sys_token_id,
                alice,
                alice_amount,
                "memo".to_string().try_into().unwrap(),
            )
            .get()?;

        // Test buying a short account name (1-9 characters)
        Wrapper::push_from(&chain, alice)
            .buy("test".to_string(), 1001)
            .get()?;

        Ok(())
    }
}
