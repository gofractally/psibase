#![allow(non_snake_case)]

#[cfg(test)]
mod tests {
    use crate::Wrapper;
    use psibase::services::http_server;
    use psibase::services::nft::Wrapper as Nfts;
    use psibase::services::tokens::{Precision, Quantity, Wrapper as Tokens};
    use psibase::{account, *};
    use serde_json::Value;

    /// Drives the GraphQL endpoint via serveSys: seeds chain state via actions,
    /// builds a POST /graphql request, and asserts on response (no errors, expected data).
    #[psibase::test_case(packages("PremAccounts"))]
    fn test_markets_status_graphql(chain: psibase::Chain) -> Result<(), psibase::Error> {
        Wrapper::push(&chain).init();
        http_server::Wrapper::push_from(&chain, Wrapper::SERVICE)
            .registerServer(account!("r-prem-accts"))
            .get()?;
        chain.finish_block();

        // Seed: disable market for length 2 so we can assert on it
        Wrapper::push(&chain).update_market_status(2, false).get()?;
        chain.finish_block();

        let reply: Value = chain.graphql(
            account!("r-prem-accts"),
            r#"{ marketsStatus { length enabled } }"#,
        )?;

        assert!(
            reply.get("errors").and_then(|e| e.as_array()).map_or(true, |a| a.is_empty()),
            "GraphQL errors: {:?}",
            reply.get("errors")
        );
        let data = reply
            .get("data")
            .and_then(|d| d.get("marketsStatus"))
            .and_then(|m| m.as_array())
            .expect("expected data.marketsStatus array");
        assert!(!data.is_empty(), "marketsStatus should not be empty after init");
        let has_length_2_disabled = data.iter().any(|v| {
            v.get("length").and_then(|l| l.as_u64()) == Some(2)
                && v.get("enabled").and_then(|e| e.as_bool()) == Some(false)
        });
        assert!(
            has_length_2_disabled,
            "expected length 2 market to be disabled: {:?}",
            data
        );
        Ok(())
    }

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
