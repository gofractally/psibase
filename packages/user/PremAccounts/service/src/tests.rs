#![allow(non_snake_case)]

#[cfg(test)]
mod tests {
    use crate::Wrapper as PremAccounts;
    use psibase::services::auth_sig::SubjectPublicKeyInfo;
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
        chain.finish_block();

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

    /// `update_market_status`, disabled-market `buy` rejection, and `claim` while the market stays disabled.
    #[psibase::test_case(packages("PremAccounts"))]
    fn test_market_status_and_purchase_rules(chain: psibase::Chain) -> Result<(), psibase::Error> {
        chain.finish_block();
        if let Err(e) = initial_setup(&chain) {
            if e.to_string().contains("not initialized") {
                chain.finish_block();
                initial_setup(&chain)?;
            } else {
                return Err(e);
            }
        }

        let alice = AccountNumber::from("alice");

        Tokens::push_from(&chain, alice)
            .credit(1, "prem-accounts".into(), 1000_0000u64.into(), "".into())
            .get()?;

        PremAccounts::push_from(&chain, alice)
            .buy("test".to_string(), 1000_0000u64)
            .get()?;

        PremAccounts::push_from(&chain, alice)
            .update_market_status(4, false)
            .get()?;

        let err = PremAccounts::push_from(&chain, alice)
            .buy("abcd".to_string(), 1000_0000u64)
            .trace
            .error
            .expect("buy should fail when market disabled");
        assert!(
            err.contains("market is disabled"),
            "unexpected error: {err}"
        );

        let (pub_pem, _priv_pem) = generate_keypair()?;
        let der = pem::parse(pub_pem.trim())
            .map_err(|e| anyhow::anyhow!(e))?
            .into_contents();

        PremAccounts::push_from(&chain, alice)
            .claim(
                "test".to_string(),
                SubjectPublicKeyInfo::from(der),
            )
            .get()?;

        Ok(())
    }

    /// `marketsStatus` GraphQL on the prem-accounts host (same URL as Config UI) tracks `update_market_status`.
    #[psibase::test_case(packages("PremAccounts"))]
    fn test_markets_status_graphql_prem_accounts_host(
        chain: psibase::Chain,
    ) -> Result<(), psibase::Error> {
        chain.finish_block();
        if let Err(e) = initial_setup(&chain) {
            if e.to_string().contains("not initialized") {
                chain.finish_block();
                initial_setup(&chain)?;
            } else {
                return Err(e);
            }
        }

        let fetch = |chain: &psibase::Chain| -> Result<serde_json::Value, psibase::Error> {
            chain.graphql(
                AccountNumber::from("prem-accounts"),
                "query { marketsStatus { length enabled } }",
            )
        };

        let raw = fetch(&chain)?;
        let status = raw
            .pointer("/data/marketsStatus")
            .and_then(|v| v.as_array())
            .expect("marketsStatus array");
        assert_eq!(status.len(), 9, "sparse row per configured market after init");

        let alice = AccountNumber::from("alice");
        PremAccounts::push_from(&chain, alice)
            .update_market_status(6, false)
            .get()?;

        let raw = fetch(&chain)?;
        let status = raw
            .pointer("/data/marketsStatus")
            .and_then(|v| v.as_array())
            .expect("marketsStatus array");
        let row6 = status
            .iter()
            .find(|v| v.get("length") == Some(&serde_json::json!(6)))
            .expect("row for length 6");
        assert_eq!(row6.get("enabled"), Some(&serde_json::json!(false)));

        Ok(())
    }

    /// `add_market` creates a new auction row; `getPrices` returns sparse `{ length, price }` nodes.
    #[psibase::test_case(packages("PremAccounts"))]
    fn test_add_market_and_get_prices_graphql(chain: psibase::Chain) -> Result<(), psibase::Error> {
        chain.finish_block();
        if let Err(e) = initial_setup(&chain) {
            if e.to_string().contains("not initialized") {
                chain.finish_block();
                initial_setup(&chain)?;
            } else {
                return Err(e);
            }
        }

        let alice = AccountNumber::from("alice");
        PremAccounts::push_from(&chain, alice).add_market(10).get()?;

        let raw: serde_json::Value = chain.graphql(
            AccountNumber::from("prem-accounts"),
            "query { getPrices { length price } }",
        )?;
        let rows = raw
            .pointer("/data/getPrices")
            .and_then(|v| v.as_array())
            .expect("getPrices array");
        assert!(
            rows.iter().any(|v| v.get("length") == Some(&serde_json::json!(10))),
            "expected length-10 market in getPrices: {rows:?}"
        );

        Ok(())
    }

    /// Second `add_market` for the same length fails.
    #[psibase::test_case(packages("PremAccounts"))]
    fn test_add_market_duplicate_fails(chain: psibase::Chain) -> Result<(), psibase::Error> {
        chain.finish_block();
        if let Err(e) = initial_setup(&chain) {
            if e.to_string().contains("not initialized") {
                chain.finish_block();
                initial_setup(&chain)?;
            } else {
                return Err(e);
            }
        }

        let alice = AccountNumber::from("alice");
        PremAccounts::push_from(&chain, alice).add_market(10).get()?;

        let err = PremAccounts::push_from(&chain, alice)
            .add_market(10)
            .trace
            .error
            .expect("duplicate add_market should fail");
        assert!(
            err.contains("market already exists"),
            "unexpected error: {err}"
        );

        Ok(())
    }

    /// `add_market` for a length that already exists from `init` fails.
    #[psibase::test_case(packages("PremAccounts"))]
    fn test_add_market_init_length_rejected(chain: psibase::Chain) -> Result<(), psibase::Error> {
        chain.finish_block();
        if let Err(e) = initial_setup(&chain) {
            if e.to_string().contains("not initialized") {
                chain.finish_block();
                initial_setup(&chain)?;
            } else {
                return Err(e);
            }
        }

        let alice = AccountNumber::from("alice");
        let err = PremAccounts::push_from(&chain, alice)
            .add_market(3)
            .trace
            .error
            .expect("add_market for existing init market should fail");
        assert!(
            err.contains("market already exists"),
            "unexpected error: {err}"
        );

        Ok(())
    }

    /// `add_market` rejects lengths outside 1–15 (aligns with Config UI validation).
    #[psibase::test_case(packages("PremAccounts"))]
    fn test_add_market_invalid_length_rejected(chain: psibase::Chain) -> Result<(), psibase::Error> {
        chain.finish_block();
        if let Err(e) = initial_setup(&chain) {
            if e.to_string().contains("not initialized") {
                chain.finish_block();
                initial_setup(&chain)?;
            } else {
                return Err(e);
            }
        }

        let alice = AccountNumber::from("alice");
        for length in [0u8, 16u8] {
            let err = PremAccounts::push_from(&chain, alice)
                .add_market(length)
                .trace
                .error
                .unwrap_or_else(|| panic!("add_market({length}) should fail"));
            assert!(
                err.contains("market name length must be 1-15"),
                "unexpected error for length {length}: {err}"
            );
        }

        Ok(())
    }

    /// After `add_market`, `buy` succeeds for a name whose UTF-8 length matches that market.
    #[psibase::test_case(packages("PremAccounts"))]
    fn test_buy_succeeds_for_sparse_market_length(chain: psibase::Chain) -> Result<(), psibase::Error> {
        chain.finish_block();
        if let Err(e) = initial_setup(&chain) {
            if e.to_string().contains("not initialized") {
                chain.finish_block();
                initial_setup(&chain)?;
            } else {
                return Err(e);
            }
        }

        let alice = AccountNumber::from("alice");

        Tokens::push_from(&chain, alice)
            .credit(1, "prem-accounts".into(), 1000_0000u64.into(), "".into())
            .get()?;

        PremAccounts::push_from(&chain, alice).add_market(10).get()?;

        PremAccounts::push_from(&chain, alice)
            .buy("abcdefghij".to_string(), 1000_0000u64)
            .get()?;

        Ok(())
    }
}
