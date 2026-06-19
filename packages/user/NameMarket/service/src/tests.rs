#![allow(non_snake_case)]

#[cfg(test)]
mod tests {
    /// Matches Config UI default `PREMIUM_MARKET_DEFAULT_PCT` (5%) for `create` actions.
    const DEFAULT_CREATE_PPM: u32 = 50_000;
    /// Matches Config UI default `PREMIUM_MARKET_DEFAULT_WINDOW_SECONDS`.
    const DEFAULT_WINDOW_SECONDS: u32 = 30 * 86400;

    use crate::Wrapper as NameMarket;
    use psibase::services::nft::Wrapper as Nfts;
    use psibase::services::tokens::{Precision, Quantity, Wrapper as Tokens, TID};
    use psibase::*;
    use psibase::{MAX_ACCOUNT_NAME_LENGTH, MIN_ACCOUNT_NAME_LENGTH};

    fn initial_setup(chain: &psibase::Chain) -> Result<TID, psibase::Error> {
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

        Ok(sys)
    }

    fn setup_tokens(chain: &psibase::Chain) -> Result<TID, psibase::Error> {
        chain.finish_block();
        match initial_setup(chain) {
            Ok(sys) => Ok(sys),
            Err(e) => {
                if e.to_string().contains("not initialized") {
                    chain.finish_block();
                    let sys = initial_setup(chain)?;
                    Ok(sys)
                } else {
                    return Err(e);
                }
            }
        }
    }

    /// One market per premium name length 1..=7 (matches Config default bootstrap range).
    fn bootstrap_markets_1_7(chain: &psibase::Chain) -> Result<(), psibase::Error> {
        const INITIAL: u64 = 1000;
        const FLOOR: u64 = 100;
        const TARGET: u32 = 10;
        const BOOTSTRAP_MAX_LENGTH: u8 = 7;
        for len in 1u8..=BOOTSTRAP_MAX_LENGTH {
            NameMarket::push(chain)
                .create(
                    len,
                    Quantity::from(INITIAL),
                    DEFAULT_WINDOW_SECONDS,
                    TARGET,
                    Quantity::from(FLOOR),
                    DEFAULT_CREATE_PPM,
                    DEFAULT_CREATE_PPM,
                )
                .get()?;
        }
        Ok(())
    }

    #[test]
    fn create_tuple_unpacks_as_action_struct() {
        use crate::service::action_structs::create;
        use psibase::fracpack::{Pack, Unpack};
        use psibase::services::tokens::Quantity;

        let tuple = (
            1u8,
            1000.into(),
            DEFAULT_WINDOW_SECONDS,
            10u32,
            100.into(),
            DEFAULT_CREATE_PPM,
            DEFAULT_CREATE_PPM,
        );
        let packed = tuple.packed();
        let unpacked = create::unpacked(&packed).expect("create struct unpack");
        assert_eq!(unpacked.window_seconds, DEFAULT_WINDOW_SECONDS);
    }

    /// Full NameMarket integration on one chain (serial steps; avoids parallel `psitest` races).
    #[psibase::test_case(packages("Tokens", "Nft", "NameMarket"))]
    fn name_market_service_integration_serial(chain: psibase::Chain) -> Result<(), psibase::Error> {
        let alice = account!("alice");

        // --- setup_tokens ---
        setup_tokens(&chain)?;

        bootstrap_markets_1_7(&chain)?;

        let raw: serde_json::Value = chain.graphql(
            NameMarket::SERVICE,
            "query { marketParams { length enabled target } }",
        )?;
        let listed = raw
            .pointer("/data/marketParams")
            .and_then(|v| v.as_array())
            .expect("marketParams array");
        assert_eq!(listed.len(), 7);

        // --- disable + buy rules + claim ---
        Tokens::push_from(&chain, alice)
            .credit(1, NameMarket::SERVICE, 1000_0000u64.into(), "".into())
            .get()?;

        NameMarket::push_from(&chain, alice)
            .buy(account!("test"))
            .get()?;

        NameMarket::push(&chain).disable(4).get()?;

        let raw_after_disable: serde_json::Value = chain.graphql(
            NameMarket::SERVICE,
            "query { marketParams { length enabled } }",
        )?;
        let mp_rows = raw_after_disable
            .pointer("/data/marketParams")
            .and_then(|v| v.as_array())
            .expect("marketParams array");
        let row4 = mp_rows
            .iter()
            .find(|v| v.get("length") == Some(&serde_json::json!(4)))
            .expect("marketParams row for length 4");
        assert_eq!(
            row4.get("enabled"),
            Some(&serde_json::json!(false)),
            "expected length-4 market disabled: {raw_after_disable:?}"
        );

        let err = NameMarket::push_from(&chain, alice)
            .buy(account!("abcd"))
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

        NameMarket::push_from(&chain, alice)
            .claim(account!("test"))
            .get()?;

        // --- marketParams + configure ---
        let fetch = |c: &psibase::Chain| -> Result<serde_json::Value, psibase::Error> {
            c.graphql(
                NameMarket::SERVICE,
                "query { marketParams { length enabled } }",
            )
        };

        let raw = fetch(&chain)?;
        let status = raw
            .pointer("/data/marketParams")
            .and_then(|v| v.as_array())
            .expect("marketParams array");
        assert_eq!(
            status.len(),
            7,
            "sparse row per configured market after bootstrap"
        );

        NameMarket::push(&chain).disable(6).get()?;

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

        // --- currentPrices includes length-7 market ---
        let raw: serde_json::Value = chain.graphql(
            NameMarket::SERVICE,
            "query { currentPrices { length price } }",
        )?;
        let rows = raw
            .pointer("/data/currentPrices")
            .and_then(|v| v.as_array())
            .expect("currentPrices array");
        assert!(
            rows.iter()
                .any(|v| v.get("length") == Some(&serde_json::json!(7))),
            "expected length-7 market in currentPrices: {rows:?}"
        );

        // --- duplicate create(7) with matching params is idempotent ---
        NameMarket::push(&chain)
            .create(
                7,
                1000.into(),
                DEFAULT_WINDOW_SECONDS,
                10,
                100.into(),
                DEFAULT_CREATE_PPM,
                DEFAULT_CREATE_PPM,
            )
            .get()?;

        // --- duplicate create(7) with different params fails ---
        let err = NameMarket::push(&chain)
            .create(
                7,
                Quantity::from(1000u64),
                DEFAULT_WINDOW_SECONDS,
                20,
                Quantity::from(100u64),
                DEFAULT_CREATE_PPM,
                DEFAULT_CREATE_PPM,
            )
            .trace
            .error
            .expect("duplicate create with mismatched params should fail");
        assert!(
            err.contains("market already exists"),
            "unexpected error: {err}"
        );

        // --- create(3) with matching params is idempotent ---
        NameMarket::push(&chain)
            .create(
                3,
                Quantity::from(1000u64),
                DEFAULT_WINDOW_SECONDS,
                10,
                Quantity::from(100u64),
                DEFAULT_CREATE_PPM,
                DEFAULT_CREATE_PPM,
            )
            .get()?;

        // --- create(8) succeeds: valid on-chain name length, no market yet (bootstrap is 1..=7) ---
        NameMarket::push(&chain)
            .create(
                8,
                Quantity::from(1000u64),
                DEFAULT_WINDOW_SECONDS,
                10,
                Quantity::from(100u64),
                DEFAULT_CREATE_PPM,
                DEFAULT_CREATE_PPM,
            )
            .get()?;

        // --- invalid lengths: must be a valid on-chain account name length (1..=10) ---
        for length in [0u8, MAX_ACCOUNT_NAME_LENGTH + 1] {
            let err = NameMarket::push(&chain)
                .create(
                    length,
                    Quantity::from(1000u64),
                    DEFAULT_WINDOW_SECONDS,
                    10,
                    Quantity::from(100u64),
                    DEFAULT_CREATE_PPM,
                    DEFAULT_CREATE_PPM,
                )
                .trace
                .error
                .unwrap_or_else(|| panic!("create({length}) should fail"));
            let expected = format!(
                "market name length must be {}-{}",
                MIN_ACCOUNT_NAME_LENGTH, MAX_ACCOUNT_NAME_LENGTH
            );
            assert!(
                err.contains(&expected),
                "unexpected error for length {length}: {err}"
            );
        }

        // --- buy on max premium length (7) ---
        Tokens::push_from(&chain, alice)
            .credit(1, NameMarket::SERVICE, 1000_0000u64.into(), "".into())
            .get()?;

        NameMarket::push_from(&chain, alice)
            .buy(account!("abcdefg"))
            .get()?;

        // --- marketParams ---
        const TEST_WINDOW_SECS: u32 = 30 * 86400;
        const TEST_INCREASE_PPM: u32 = 48_000;
        const TEST_DECREASE_PPM: u32 = 52_000;
        NameMarket::push(&chain)
            .configure(
                5,
                TEST_WINDOW_SECS,
                8,
                Quantity::from(150u64),
                TEST_INCREASE_PPM,
                TEST_DECREASE_PPM,
            )
            .get()?;

        let raw: serde_json::Value = chain.graphql(
            NameMarket::SERVICE,
            "query { marketParams { length enabled initialPrice target floorPrice windowSeconds increasePct decreasePct } }",
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
        assert_eq!(cfg.get("initialPrice"), Some(&serde_json::json!("0.1000")));
        assert_eq!(cfg.get("target"), Some(&serde_json::json!(8)));
        assert_eq!(cfg.get("floorPrice"), Some(&serde_json::json!("0.0150")));
        assert_eq!(
            cfg.get("windowSeconds"),
            Some(&serde_json::json!(TEST_WINDOW_SECS))
        );
        assert_eq!(cfg.get("increasePct"), Some(&serde_json::json!(5)));
        assert_eq!(cfg.get("decreasePct"), Some(&serde_json::json!(5)));

        Ok(())
    }

    #[psibase::test_case(packages("Tokens", "Nft", "NameMarket"))]
    fn name_market_starts_with_no_configured_markets(
        chain: psibase::Chain,
    ) -> Result<(), psibase::Error> {
        setup_tokens(&chain)?;
        let raw: serde_json::Value =
            chain.graphql(NameMarket::SERVICE, "query { marketParams { length } }")?;
        let cfg = raw
            .pointer("/data/marketParams")
            .and_then(|v| v.as_array())
            .expect("marketParams array");
        assert!(cfg.is_empty());
        Ok(())
    }
}
