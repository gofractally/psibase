#![allow(non_snake_case)]

#[cfg(test)]
mod tests {
    use crate::constants::{MAX_PREMIUM_NAME_LENGTH, MIN_PREMIUM_NAME_LENGTH};
    use crate::Wrapper as PremAccounts;
    use psibase::services::auth_sig::SubjectPublicKeyInfo;
    use psibase::services::nft::Wrapper as Nfts;
    use psibase::services::tokens::{Precision, Quantity, Wrapper as Tokens};
    use psibase::*;

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

    fn setup_tokens(chain: &psibase::Chain) -> Result<(), psibase::Error> {
        chain.finish_block();
        if let Err(e) = initial_setup(chain) {
            if e.to_string().contains("not initialized") {
                chain.finish_block();
                initial_setup(chain)?;
            } else {
                return Err(e);
            }
        }
        Ok(())
    }

    /// Former on-chain defaults (markets are no longer created in `init`).
    fn bootstrap_markets_1_9(
        chain: &psibase::Chain,
        admin: AccountNumber,
    ) -> Result<(), psibase::Error> {
        const INITIAL: u64 = 1000;
        const FLOOR: u64 = 100;
        const TARGET: u32 = 10;
        for len in 1u8..=9u8 {
            PremAccounts::push_from(chain, admin)
                .create(len, INITIAL, TARGET, FLOOR)
                .get()?;
        }
        Ok(())
    }

    /// Full PremAccounts integration on one chain (serial steps; avoids parallel `psitest` races).
    #[psibase::test_case(packages("Tokens", "Nft", "PremAccounts"))]
    fn prem_accounts_service_integration_serial(chain: psibase::Chain) -> Result<(), psibase::Error> {
        let alice = AccountNumber::from("alice");

        // --- setup_tokens ---
        setup_tokens(&chain)?;

        bootstrap_markets_1_9(&chain, alice)?;

        // max_cost below current ask (shared balance is sufficient; max_cost is the binding constraint)
        Tokens::push_from(&chain, alice)
            .credit(1, "prem-accounts".into(), 1000_0000u64.into(), "".into())
            .get()?;

        let err = PremAccounts::push_from(&chain, alice)
            .buy("a".to_string(), 1u64)
            .trace
            .error
            .expect("buy should fail when max_cost is below current price");
        assert!(
            err.contains("max cost") || err.contains("max_cost"),
            "unexpected error: {err}"
        );

        let raw: serde_json::Value = chain.graphql(
            AccountNumber::from("prem-accounts"),
            "query { marketParams { length enabled target } }",
        )?;
        let listed = raw
            .pointer("/data/marketParams")
            .and_then(|v| v.as_array())
            .expect("marketParams array");
        assert_eq!(listed.len(), 9);

        // --- disable + buy rules + claim ---
        Tokens::push_from(&chain, alice)
            .credit(1, "prem-accounts".into(), 1000_0000u64.into(), "".into())
            .get()?;

        PremAccounts::push_from(&chain, alice)
            .buy("test".to_string(), 1000_0000u64)
            .get()?;

        PremAccounts::push_from(&chain, alice).disable(4).get()?;

        let auth_len4 = chain.login(alice, PremAccounts::SERVICE)?;
        let raw_status: serde_json::Value = chain.graphql_auth(
            AccountNumber::from("prem-accounts"),
            r#"query {
                marketStatusEvents(length: 4, first: 10) {
                    edges { node { length enabled } }
                }
            }"#,
            &auth_len4,
        )?;
        let st_edges = raw_status
            .pointer("/data/marketStatusEvents/edges")
            .and_then(|v| v.as_array())
            .expect("marketStatusEvents edges");
        assert!(
            st_edges.iter().filter_map(|e| e.get("node")).any(|n| {
                n.get("length") == Some(&serde_json::json!(4))
                    && n.get("enabled") == Some(&serde_json::json!(false))
            }),
            "expected marketStatus disabled for length 4: {raw_status:?}"
        );

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

        // --- marketParams + configure ---
        let fetch = |c: &psibase::Chain| -> Result<serde_json::Value, psibase::Error> {
            c.graphql(
                AccountNumber::from("prem-accounts"),
                "query { marketParams { length enabled } }",
            )
        };

        let raw = fetch(&chain)?;
        let status = raw
            .pointer("/data/marketParams")
            .and_then(|v| v.as_array())
            .expect("marketParams array");
        assert_eq!(status.len(), 9, "sparse row per configured market after bootstrap");

        PremAccounts::push_from(&chain, alice).disable(6).get()?;

        let raw = fetch(&chain)?;
        let status = raw
            .pointer("/data/marketParams")
            .and_then(|v| v.as_array())
            .expect("marketParams array");
        let row6 = status
            .iter()
            .find(|v| v.get("length") == Some(&serde_json::json!(6)))
            .expect("row for length 6");
        assert_eq!(row6.get("enabled"), Some(&serde_json::json!(false)));

        // --- create(10), currentPrices, duplicate create(10) fails ---
        PremAccounts::push_from(&chain, alice)
            .create(10, 1000, 10, 100)
            .get()?;

        let raw: serde_json::Value = chain.graphql(
            AccountNumber::from("prem-accounts"),
            "query { currentPrices { length price } }",
        )?;
        let rows = raw
            .pointer("/data/currentPrices")
            .and_then(|v| v.as_array())
            .expect("currentPrices array");
        assert!(
            rows.iter().any(|v| v.get("length") == Some(&serde_json::json!(10))),
            "expected length-10 market in currentPrices: {rows:?}"
        );

        let err = PremAccounts::push_from(&chain, alice)
            .create(10, 1000, 10, 100)
            .trace
            .error
            .expect("duplicate create should fail");
        assert!(
            err.contains("market already exists"),
            "unexpected error: {err}"
        );

        // --- create(3) rejected (init market) ---
        let err = PremAccounts::push_from(&chain, alice)
            .create(3, 1000, 10, 100)
            .trace
            .error
            .expect("create for existing bootstrap market should fail");
        assert!(
            err.contains("market already exists"),
            "unexpected error: {err}"
        );

        // --- invalid lengths ---
        for length in [0u8, MAX_PREMIUM_NAME_LENGTH + 1] {
            let err = PremAccounts::push_from(&chain, alice)
                .create(length, 1000, 10, 100)
                .trace
                .error
                .unwrap_or_else(|| panic!("create({length}) should fail"));
            let expected = format!(
                "market name length must be {}-{}",
                MIN_PREMIUM_NAME_LENGTH, MAX_PREMIUM_NAME_LENGTH
            );
            assert!(
                err.contains(&expected),
                "unexpected error for length {length}: {err}"
            );
        }

        // --- buy on length-10 market (already added) ---
        Tokens::push_from(&chain, alice)
            .credit(1, "prem-accounts".into(), 1000_0000u64.into(), "".into())
            .get()?;

        PremAccounts::push_from(&chain, alice)
            .buy("abcdefghij".to_string(), 1000_0000u64)
            .get()?;

        // --- marketParams ---
        const TEST_WINDOW_SECS: u32 = 30 * 86400;
        const TEST_INCREASE_PPM: u32 = 48_000;
        const TEST_DECREASE_PPM: u32 = 52_000;
        PremAccounts::push_from(&chain, alice)
            .configure(
                5,
                TEST_WINDOW_SECS,
                8,
                150,
                TEST_INCREASE_PPM,
                TEST_DECREASE_PPM,
            )
            .get()?;

        let raw: serde_json::Value = chain.graphql(
            AccountNumber::from("prem-accounts"),
            "query { marketParams { length enabled target initialPrice floorPrice windowSeconds increasePpm decreasePpm } }",
        )?;
        let markets = raw
            .pointer("/data/marketParams")
            .and_then(|v| v.as_array())
            .expect("marketParams array");
        let cfg = markets
            .iter()
            .find(|v| v.get("length") == Some(&serde_json::json!(5)))
            .expect("marketParams row for length 5");
        assert_eq!(cfg.get("enabled"), Some(&serde_json::json!(true)));
        assert_eq!(cfg.get("target"), Some(&serde_json::json!(8)));
        assert_eq!(cfg.get("initialPrice"), Some(&serde_json::json!("0.1000")));
        assert_eq!(cfg.get("floorPrice"), Some(&serde_json::json!("0.0150")));
        assert_eq!(
            cfg.get("windowSeconds"),
            Some(&serde_json::json!(TEST_WINDOW_SECS))
        );
        assert_eq!(
            cfg.get("increasePpm"),
            Some(&serde_json::json!(TEST_INCREASE_PPM))
        );
        assert_eq!(
            cfg.get("decreasePpm"),
            Some(&serde_json::json!(TEST_DECREASE_PPM))
        );

        // --- marketConfigEvents (authenticated): full market configuration history ---
        PremAccounts::push_from(&chain, alice)
            .configure(
                7,
                TEST_WINDOW_SECS,
                9,
                120,
                TEST_INCREASE_PPM,
                TEST_DECREASE_PPM,
            )
            .get()?;

        let auth = chain.login(alice, PremAccounts::SERVICE)?;
        let raw: serde_json::Value = chain.graphql_auth(
            AccountNumber::from("prem-accounts"),
            r#"query {
                marketConfigEvents(length: 7, first: 10) {
                    edges { node { length enable target initialPrice floorPrice windowSeconds increasePpm decreasePpm } }
                }
            }"#,
            &auth,
        )?;
        let edges = raw
            .pointer("/data/marketConfigEvents/edges")
            .and_then(|v| v.as_array())
            .expect("edges");
        assert!(
            !edges.is_empty(),
            "expected marketConfigured event: {raw:?}"
        );
        let node = &edges[edges.len() - 1]["node"];
        assert_eq!(node.get("length"), Some(&serde_json::json!(7)));
        assert_eq!(node.get("enable"), Some(&serde_json::json!(true)));
        assert_eq!(node.get("target"), Some(&serde_json::json!(9)));
        assert_eq!(
            node.get("windowSeconds"),
            Some(&serde_json::json!(TEST_WINDOW_SECS))
        );
        assert_eq!(
            node.get("increasePpm"),
            Some(&serde_json::json!(TEST_INCREASE_PPM))
        );
        assert_eq!(
            node.get("decreasePpm"),
            Some(&serde_json::json!(TEST_DECREASE_PPM))
        );

        Ok(())
    }

    #[psibase::test_case(packages("Tokens", "Nft", "PremAccounts"))]
    fn prem_accounts_starts_with_no_configured_markets(
        chain: psibase::Chain,
    ) -> Result<(), psibase::Error> {
        setup_tokens(&chain)?;
        let raw: serde_json::Value = chain.graphql(
            AccountNumber::from("prem-accounts"),
            "query { marketParams { length } }",
        )?;
        let cfg = raw
            .pointer("/data/marketParams")
            .and_then(|v| v.as_array())
            .expect("marketParams array");
        assert!(cfg.is_empty());
        Ok(())
    }
}
