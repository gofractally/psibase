#![allow(non_snake_case)]

#[cfg(test)]
mod tests {
    use crate::tables::{
        Asset, BanxInvite, BanxInviteTable, BanxRelay, BookAuth, CashQuote, ClaimOffer, FxOffer,
        InitTable, Pair, PairTable, PathHop, PayAuth, PayAuthTab, PayRequest, TokenRelay,
        PPM_SCALE, RATE_SCALE,
    };
    use crate::Wrapper;
    use psibase::fracpack::Pack;
    use psibase::services::tokens::{Decimal, Precision, Quantity};
    use psibase::*;

    fn hop(account: AccountNumber, asset_id: u16) -> PathHop {
        PathHop { account, asset_id }
    }

    const TEST_ROUTE_KEY: [u8; 32] = [7; 32];

    fn ensure_route_key(chain: &psibase::Chain) {
        let table = crate::tables::RouteKeyTable::read();
        if table.get_index_pk().get(&0).is_some() {
            return;
        }
        Wrapper::push_from(chain, Wrapper::SERVICE)
            .rotate_key(TEST_ROUTE_KEY.to_vec())
            .get()
            .expect("rotate route key");
    }

    fn chain_seconds(chain: &psibase::Chain) -> i64 {
        psibase::services::transact::Wrapper::push(chain)
            .currentBlock()
            .get()
            .expect("current block")
            .time
            .seconds()
            .seconds
    }

    /// Seal a hop list the way the query service would, with every term set.
    fn seal_with(
        chain: &psibase::Chain,
        payer: AccountNumber,
        hops: Vec<PathHop>,
        amount_in: u64,
        amount_out: u64,
        expires_at: i64,
    ) -> String {
        ensure_route_key(chain);
        let mut random = [0_u8; 24 + 12 * 48];
        random[0] = 1;
        let last = *hops.last().expect("hops");
        // What each hop will draw. A hop that cannot be priced reads 0: the
        // payment fails at that hop before the amount is compared.
        let (amounts, _) = crate::tables::peek_hop_amounts(&hops, amount_in, chain_seconds(chain));
        crate::route::seal(
            &TEST_ROUTE_KEY,
            crate::route::RouteTerms {
                epoch: 1,
                payer,
                payee: last.account,
                from_asset: hops[0].asset_id,
                to_asset: last.asset_id,
                amount_in,
                amount_out,
                expires_at,
            },
            &hops,
            &amounts,
            &random,
        )
        .expect("seal route")
    }

    /// Seal a hop list the way the query service would. `amount` is the draw.
    /// Most tests pass `min_return` on the action, so the sealed receive is
    /// left open. The `route_*` tests below set it.
    fn seal(
        chain: &psibase::Chain,
        payer: AccountNumber,
        hops: Vec<PathHop>,
        amount: Quantity,
    ) -> String {
        let now = chain_seconds(chain);
        seal_with(chain, payer, hops, amount.value, u64::MAX, now + 60)
    }

    /// Seal for `pay_inv`: the send is the smallest that clears the invoice.
    fn seal_inv(
        chain: &psibase::Chain,
        payer: AccountNumber,
        hops: Vec<PathHop>,
        request_id: u32,
    ) -> String {
        let remaining = PayRequest::get(request_id)
            .map(|row| row.remaining.value)
            .unwrap_or(1);
        let now = chain_seconds(chain);
        let send = crate::tables::peek_required_send(&hops, remaining, now).unwrap_or(remaining);
        seal_with(chain, payer, hops, send, u64::MAX, now + 60)
    }

    /// Seal for `run_pay_ath`: the send is the smallest that delivers one period.
    fn seal_auth(
        chain: &psibase::Chain,
        payer: AccountNumber,
        hops: Vec<PathHop>,
        id: u32,
    ) -> String {
        let now = chain_seconds(chain);
        let send = PayAuth::get(id)
            .and_then(|row| crate::tables::peek_required_send(&hops, row.amount.value, now))
            .unwrap_or(1);
        seal_with(chain, payer, hops, send, u64::MAX, now + 60)
    }

    fn never() -> TimePointSec {
        TimePointSec { seconds: 0 }
    }

    fn exp(
        chain: &psibase::Chain,
        creditor: AccountNumber,
        debtor: AccountNumber,
        asset_id: u16,
    ) -> u64 {
        Wrapper::push(chain)
            .get_exposure(creditor, debtor, asset_id)
            .get()
            .unwrap()
            .value
    }

    fn banx_gql(chain: &psibase::Chain, query: &str) -> Result<serde_json::Value, psibase::Error> {
        Ok(chain.graphql(Wrapper::SERVICE, query)?)
    }

    /// A query as `user`, through the same session token the UI uses.
    fn banx_gql_as(
        chain: &psibase::Chain,
        user: AccountNumber,
        query: &str,
    ) -> Result<serde_json::Value, psibase::Error> {
        let token = chain.login(user, Wrapper::SERVICE)?;
        Ok(chain.graphql_auth(Wrapper::SERVICE, query, &token)?)
    }

    /// The first GraphQL error message, or a marker when there is none.
    fn gql_error(reply: &serde_json::Value) -> String {
        reply
            .pointer("/errors/0/message")
            .and_then(|m| m.as_str())
            .unwrap_or("(no error)")
            .to_string()
    }

    /// `account`'s own feed, read as `account`: history is private to its owner.
    fn activity_nodes(chain: &psibase::Chain, account: AccountNumber) -> Vec<serde_json::Value> {
        let graph = banx_gql_as(
            chain,
            account,
            &format!(
                r#"{{ activity(account: "{account}", last: 50) {{
                    edges {{ node {{ kind amount netted actor counterparty memo assetId }} }}
                }} }}"#
            ),
        )
        .unwrap_or_else(|err| panic!("activity query failed: {err}"));
        let edges = graph
            .pointer("/data/activity/edges")
            .and_then(|v| v.as_array())
            .cloned()
            .unwrap_or_else(|| panic!("activity edges missing: {graph}"));
        edges
            .into_iter()
            .filter_map(|edge| edge.get("node").cloned())
            .collect()
    }

    #[psibase::test_case(packages("Banx"))]
    fn test_init_seeds_default_assets(chain: psibase::Chain) -> Result<(), psibase::Error> {
        Wrapper::push(&chain).init().get()?;

        let seeded = crate::iso4217::SEEDED_ASSETS;
        assert_eq!(
            InitTable::read()
                .get_index_pk()
                .get(&())
                .unwrap()
                .next_asset_id,
            seeded.len() as u16 + 1
        );
        for (i, &(symbol, precision, description)) in seeded.iter().enumerate() {
            let asset = Asset::get_by_symbol_assert(symbol);
            assert_eq!(asset.id, (i as u16) + 1);
            assert_eq!(asset.precision.value(), precision);
            assert_eq!(asset.description.to_string(), description);
            assert!(
                !description.to_ascii_lowercase().contains("ounce"),
                "{description}"
            );
        }
        for symbol in [
            account!("euro"),
            account!("ved"),
            account!("svc"),
            account!("xau"),
            account!("xag"),
            account!("xpt"),
            account!("xpd"),
            account!("bov"),
            account!("xdr"),
            account!("xts"),
            account!("xxx"),
        ] {
            assert!(Asset::get_by_symbol(symbol).is_none());
        }

        Ok(())
    }

    #[psibase::test_case(packages("Banx"))]
    fn test_add_asset_anyone(chain: psibase::Chain) -> Result<(), psibase::Error> {
        Wrapper::push(&chain).init().get()?;

        let alice = account!("alice");
        let bob = account!("bob");
        chain.new_account(alice).unwrap();
        chain.new_account(bob).unwrap();

        let prec = Precision::new(2).unwrap();
        let next = InitTable::read()
            .get_index_pk()
            .get(&())
            .unwrap()
            .next_asset_id;
        let id = Wrapper::push_from(&chain, alice)
            .add_asset(account!("foo"), prec, "Test foo".into())
            .get()?;
        assert_eq!(id, next);
        let asset = Asset::get_assert(id);
        assert_eq!(asset.symbol, account!("foo"));
        assert_eq!(asset.precision.value(), 2);

        let id2 = Wrapper::push_from(&chain, bob)
            .add_asset(
                account!("bar"),
                Precision::new(0).unwrap(),
                "Test bar".into(),
            )
            .get()?;
        assert_eq!(id2, next + 1);
        assert_eq!(Asset::get_assert(id2).precision.value(), 0);

        let dup = Wrapper::push_from(&chain, alice)
            .add_asset(account!("foo"), prec, "duplicate".into())
            .get();
        assert!(dup.is_err());

        let empty = Wrapper::push_from(&chain, alice)
            .add_asset(AccountNumber::new(0), prec, "no symbol".into())
            .get();
        assert!(empty.is_err());

        Ok(())
    }

    /// Two accounts and a USD route between them. No lines: every route test
    /// below fails before a hop is drawn.
    fn route_net(chain: &psibase::Chain) -> (AccountNumber, AccountNumber, u16) {
        Wrapper::push(chain).init().get().unwrap();
        let alice = account!("alice");
        let gary = account!("gary");
        chain.new_account(alice).unwrap();
        chain.new_account(gary).unwrap();
        let usd = Asset::get_by_symbol_assert(account!("usd")).id;
        (alice, gary, usd)
    }

    fn pay_error(
        chain: &psibase::Chain,
        sender: AccountNumber,
        route: String,
        amount: u64,
        min_return: u64,
    ) -> String {
        let pushed = Wrapper::push_from(chain, sender).path_pay(
            route,
            Quantity::new(amount),
            Quantity::new(min_return),
            0,
        );
        pushed
            .trace
            .error
            .clone()
            .unwrap_or_else(|| "(no error: path_pay succeeded)".to_string())
    }

    #[psibase::test_case(packages("Banx"))]
    fn test_route_key_unset_blocks_payment_and_reports_not_ready(
        chain: psibase::Chain,
    ) -> Result<(), psibase::Error> {
        let (alice, _gary, _usd) = route_net(&chain);
        let ready = banx_gql(&chain, "{ routingReady }")?;
        assert_eq!(
            ready.pointer("/data/routingReady"),
            Some(&serde_json::json!(false)),
            "{ready}"
        );

        let err = pay_error(&chain, alice, "00".to_string(), 10, 10);
        assert!(err.contains("routing key is not set"), "{err}");
        Ok(())
    }

    #[psibase::test_case(packages("Banx"))]
    fn test_route_key_provision_rotate_and_permissions(
        chain: psibase::Chain,
    ) -> Result<(), psibase::Error> {
        let (alice, gary, usd) = route_net(&chain);

        let denied = Wrapper::push_from(&chain, alice)
            .rotate_key(vec![1; 32])
            .get()
            .expect_err("only the service account may set the key");
        assert!(
            denied.to_string().contains("only the service account"),
            "{denied}"
        );
        let short = Wrapper::push_from(&chain, Wrapper::SERVICE)
            .rotate_key(vec![1; 31])
            .get()
            .expect_err("key must be 32 bytes");
        assert!(short.to_string().contains("must be 32 bytes"), "{short}");

        // Provision, seal under epoch 1, then rotate: the old quote stops opening.
        let route = seal(&chain, alice, vec![hop(gary, usd)], Quantity::new(10));
        let ready = banx_gql(&chain, "{ routingReady }")?;
        assert_eq!(
            ready.pointer("/data/routingReady"),
            Some(&serde_json::json!(true)),
            "{ready}"
        );
        Wrapper::push_from(&chain, Wrapper::SERVICE)
            .rotate_key(TEST_ROUTE_KEY.to_vec())
            .get()?;
        let err = pay_error(&chain, alice, route, 10, 0);
        assert!(err.contains("route is from an old key"), "{err}");
        Ok(())
    }

    #[psibase::test_case(packages("Banx"))]
    fn test_route_is_bound_to_payer_amount_receive_and_time(
        chain: psibase::Chain,
    ) -> Result<(), psibase::Error> {
        let (alice, gary, usd) = route_net(&chain);
        let now = chain_seconds(&chain);

        // Quoted for alice. Gary cannot spend it.
        let route = seal_with(&chain, alice, vec![hop(gary, usd)], 500, 500, now + 60);
        let err = pay_error(&chain, gary, route.clone(), 500, 500);
        assert!(
            err.contains("route was quoted for a different payer"),
            "{err}"
        );

        // The signed amount must be the quoted draw.
        let err = pay_error(&chain, alice, route.clone(), 400, 400);
        assert!(
            err.contains("route amount does not match the signed amount"),
            "{err}"
        );

        // A floor above the quoted receive is rejected before any hop runs.
        let err = pay_error(&chain, alice, route.clone(), 500, 501);
        assert!(err.contains("route receive is below min_return"), "{err}");

        // A flipped character in the blob is not a route.
        let mut bytes = route.clone().into_bytes();
        let mid = bytes.len() / 2;
        bytes[mid] = if bytes[mid] == b'0' { b'1' } else { b'0' };
        let err = pay_error(&chain, alice, String::from_utf8(bytes).unwrap(), 500, 500);
        assert!(err.contains("payment unavailable"), "{err}");

        // The same blob is rejected once its quote has expired.
        pin(&chain, now + 120);
        let err = pay_error(&chain, alice, route, 500, 500);
        assert!(err.contains("payment unavailable"), "{err}");
        Ok(())
    }

    #[psibase::test_case(packages("Banx"))]
    fn test_quote_path_needs_a_signed_in_caller(
        chain: psibase::Chain,
    ) -> Result<(), psibase::Error> {
        let (_alice, _gary, usd) = route_net(&chain);
        ensure_route_key(&chain);
        let query = format!(
            r#"{{ quotePath(from: "alice", to: "gary", amount: "1", fromAsset: {usd}, toAsset: {usd}, maxHops: 3, exactOut: true) {{ route }} }}"#
        );
        let reply = banx_gql(&chain, &query)?;
        assert!(gql_error(&reply).contains("sign in"), "{reply}");
        assert!(reply.pointer("/data/quotePath/route").is_none(), "{reply}");

        // Signed in as someone who is neither end of the payment.
        let carol = account!("carol");
        chain.new_account(carol).unwrap();
        let reply = banx_gql_as(&chain, carol, &query)?;
        assert!(gql_error(&reply).contains("payer or the payee"), "{reply}");
        Ok(())
    }

    /// Lines and forwarding that alice, gary and carol can tell apart:
    /// alice->gary, carol->alice, and gary->carol, which alice is not a party to.
    fn private_net(chain: &psibase::Chain) -> (AccountNumber, AccountNumber, AccountNumber, u16) {
        let (alice, gary, usd) = route_net(chain);
        let carol = account!("carol");
        chain.new_account(carol).unwrap();
        Wrapper::push_from(chain, alice)
            .st_crd_lne(gary, usd, Quantity::new(100), false)
            .get()
            .unwrap();
        Wrapper::push_from(chain, carol)
            .st_crd_lne(alice, usd, Quantity::new(50), false)
            .get()
            .unwrap();
        Wrapper::push_from(chain, gary)
            .st_crd_lne(carol, usd, Quantity::new(70), false)
            .get()
            .unwrap();
        Wrapper::push_from(chain, alice)
            .st_glb_fwd(usd, Quantity::new(0), 10_000, never(), true)
            .get()
            .unwrap();
        (alice, gary, carol, usd)
    }

    #[psibase::test_case(packages("Banx"))]
    fn test_private_queries_need_sign_in(chain: psibase::Chain) -> Result<(), psibase::Error> {
        let (_alice, _gary, _carol, usd) = private_net(&chain);
        for query in [
            r#"{ creditLines(account: "alice") { creditor } }"#.to_string(),
            r#"{ obligations(account: "alice") { creditor } }"#.to_string(),
            r#"{ bookAuths(account: "alice") { creditor } }"#.to_string(),
            format!(r#"{{ exposure(creditor: "alice", debtor: "gary", assetId: {usd}) }}"#),
            r#"{ forwardOffers(poster: "alice") { poster } }"#.to_string(),
            r#"{ requests(account: "alice") { id } }"#.to_string(),
            r#"{ request(id: 1) { id } }"#.to_string(),
            r#"{ payAuths(account: "alice") { id } }"#.to_string(),
            r#"{ invites(inviter: "alice") { id } }"#.to_string(),
            r#"{ activity(account: "alice", last: 5) { edges { node { kind } } } }"#.to_string(),
        ] {
            let reply = banx_gql(&chain, &query)?;
            assert!(gql_error(&reply).contains("sign in"), "{query} -> {reply}");
        }
        Ok(())
    }

    #[psibase::test_case(packages("Banx"))]
    fn test_network_wide_queries_are_gone(chain: psibase::Chain) -> Result<(), psibase::Error> {
        let (alice, _gary, _carol, _usd) = private_net(&chain);
        for query in [
            "{ networkLines { creditor } }",
            "{ networkForwardOffers { poster } }",
            r#"{ pathGraph(from: "alice", to: "gary", maxHops: 3) { now } }"#,
        ] {
            // Not even a signed-in caller can ask for the whole graph.
            let reply = banx_gql_as(&chain, alice, query)?;
            assert!(
                gql_error(&reply).contains("Unknown field"),
                "{query} -> {reply}"
            );
        }
        Ok(())
    }

    #[psibase::test_case(packages("Banx"))]
    fn test_private_queries_return_only_rows_the_caller_is_party_to(
        chain: psibase::Chain,
    ) -> Result<(), psibase::Error> {
        let (alice, gary, carol, usd) = private_net(&chain);
        let creditors = |reply: &serde_json::Value| -> Vec<String> {
            let mut rows: Vec<String> = reply
                .pointer("/data/creditLines")
                .and_then(|v| v.as_array())
                .unwrap_or_else(|| panic!("no creditLines in {reply}"))
                .iter()
                .map(|r| {
                    format!(
                        "{}>{}",
                        r["creditor"].as_str().unwrap(),
                        r["debtor"].as_str().unwrap()
                    )
                })
                .collect();
            rows.sort();
            rows
        };
        let lines = |who: AccountNumber, about: &str| {
            banx_gql_as(
                &chain,
                who,
                &format!(r#"{{ creditLines(account: "{about}") {{ creditor debtor }} }}"#),
            )
        };

        // Your own account: every line you are on.
        assert_eq!(
            creditors(&lines(alice, "alice")?),
            vec!["alice>gary", "carol>alice"]
        );
        // Someone else's account: only the lines between you and them.
        assert_eq!(creditors(&lines(gary, "alice")?), vec!["alice>gary"]);
        assert_eq!(creditors(&lines(gary, "carol")?), vec!["gary>carol"]);
        assert_eq!(creditors(&lines(carol, "gary")?), vec!["gary>carol"]);
        // gary->carol is not visible to alice at all.
        let alice_on_gary = creditors(&lines(alice, "gary")?);
        assert_eq!(alice_on_gary, vec!["alice>gary"]);

        // Obligations follow the same rule.
        Wrapper::push_from(&chain, carol)
            .path_pay(
                seal(&chain, carol, vec![hop(gary, usd)], Quantity::new(10)),
                Quantity::new(10),
                Quantity::new(0),
                0,
            )
            .get()?;
        let owed = banx_gql_as(
            &chain,
            alice,
            r#"{ obligations(account: "gary") { creditor debtor } }"#,
        )?;
        assert_eq!(
            owed.pointer("/data/obligations")
                .and_then(|v| v.as_array())
                .map(|v| v.len()),
            Some(0),
            "alice is not a party to gary and carol's debt: {owed}"
        );
        let owed = banx_gql_as(
            &chain,
            carol,
            r#"{ obligations(account: "gary") { creditor debtor } }"#,
        )?;
        assert_eq!(
            owed.pointer("/data/obligations")
                .and_then(|v| v.as_array())
                .map(|v| v.len()),
            Some(1),
            "{owed}"
        );

        // Things only the owner may read.
        let routing = banx_gql_as(
            &chain,
            gary,
            r#"{ forwardOffers(poster: "alice") { poster } }"#,
        )?;
        assert!(gql_error(&routing).contains("your own"), "{routing}");
        let own = banx_gql_as(
            &chain,
            alice,
            r#"{ forwardOffers(poster: "alice") { poster } }"#,
        )?;
        assert_eq!(gql_error(&own), "(no error)", "{own}");
        let feed = banx_gql_as(
            &chain,
            gary,
            r#"{ activity(account: "alice", last: 5) { edges { node { kind } } } }"#,
        )?;
        assert!(gql_error(&feed).contains("your own"), "{feed}");
        let invites = banx_gql_as(&chain, gary, r#"{ invites(inviter: "alice") { id } }"#)?;
        assert!(gql_error(&invites).contains("your own"), "{invites}");
        let third_party = banx_gql_as(
            &chain,
            alice,
            &format!(r#"{{ exposure(creditor: "gary", debtor: "carol", assetId: {usd}) }}"#),
        )?;
        assert!(gql_error(&third_party).contains("party"), "{third_party}");

        // Marketplace data stays public: no sign-in needed.
        let public = banx_gql(&chain, "{ assets { id } constants { ppmScale } }")?;
        assert_eq!(gql_error(&public), "(no error)", "{public}");
        Ok(())
    }

    /// Quote through the real query service, then execute the sealed route.
    /// Also proves the search's per-hop amounts equal what the chain draws.
    fn quote_route(
        chain: &psibase::Chain,
        payer: AccountNumber,
        payee: AccountNumber,
        usd: u16,
        receive_raw: u64,
    ) -> Result<(String, u64, u64, u64), psibase::Error> {
        let precision = Asset::get(usd).unwrap().precision;
        let human = Decimal::new(Quantity::new(receive_raw), precision).to_string();
        let reply = banx_gql_as(
            chain,
            payer,
            &format!(
                r#"{{ quotePath(from: "{payer}", to: "{payee}", amount: "{human}", fromAsset: {usd}, toAsset: {usd}, maxHops: 4, exactOut: true) {{ route amountIn amountOut minReturn hopCount }} }}"#
            ),
        )?;
        let q = reply
            .pointer("/data/quotePath")
            .unwrap_or_else(|| panic!("quotePath failed: {reply}"));
        let num = |k: &str| q[k].as_str().unwrap().parse::<u64>().unwrap();
        Ok((
            q["route"].as_str().unwrap().to_string(),
            num("amountIn"),
            num("amountOut"),
            q["hopCount"].as_u64().unwrap(),
        ))
    }

    /// alice -> gary (2% forward) -> steve, with room on every line.
    fn quoted_net(chain: &psibase::Chain) -> (AccountNumber, AccountNumber, AccountNumber, u16) {
        Wrapper::push(chain).init().get().unwrap();
        let alice = account!("alice");
        let gary = account!("gary");
        let steve = account!("steve");
        for a in [alice, gary, steve] {
            chain.new_account(a).unwrap();
        }
        let usd = Asset::get_by_symbol_assert(account!("usd")).id;
        Wrapper::push_from(chain, gary)
            .st_crd_lne(alice, usd, Quantity::new(10_000), false)
            .get()
            .unwrap();
        Wrapper::push_from(chain, steve)
            .st_crd_lne(gary, usd, Quantity::new(10_000), false)
            .get()
            .unwrap();
        Wrapper::push_from(chain, gary)
            .st_glb_fwd(usd, Quantity::new(0), PPM_SCALE * 2 / 100, never(), true)
            .get()
            .unwrap();
        ensure_route_key(chain);
        (alice, gary, steve, usd)
    }

    #[psibase::test_case(packages("Banx"))]
    fn test_quoted_route_executes_with_the_quoted_amounts(
        chain: psibase::Chain,
    ) -> Result<(), psibase::Error> {
        let (alice, gary, steve, usd) = quoted_net(&chain);
        let (route, amount_in, amount_out, hops) = quote_route(&chain, alice, steve, usd, 490)?;
        assert_eq!(hops, 2);
        assert!(
            amount_out >= 490 && amount_in > amount_out,
            "{amount_in} {amount_out}"
        );

        Wrapper::push_from(&chain, alice)
            .path_pay(route, Quantity::new(amount_in), Quantity::new(490), 0)
            .get()?;
        assert_eq!(exp(&chain, gary, alice, usd), amount_in);
        assert_eq!(exp(&chain, steve, gary, usd), amount_out);
        Ok(())
    }

    /// The amounts are the protection here, not `min_return`: a floor of 0
    /// would accept any fill, and a replaced fee still fails.
    #[psibase::test_case(packages("Banx"))]
    fn test_a_changed_fee_fails_even_with_no_min_return(
        chain: psibase::Chain,
    ) -> Result<(), psibase::Error> {
        let (alice, gary, steve, usd) = quoted_net(&chain);
        let (route, amount_in, _out, _) = quote_route(&chain, alice, steve, usd, 490)?;

        // Gary raises his fee from 2% to 10% after the quote.
        Wrapper::push_from(&chain, gary)
            .st_glb_fwd(usd, Quantity::new(0), PPM_SCALE / 10, never(), true)
            .get()?;
        let err = pay_error(&chain, alice, route.clone(), amount_in, 0);
        assert!(err.contains("path price changed since the quote"), "{err}");
        assert_eq!(exp(&chain, gary, alice, usd), 0);
        assert_eq!(exp(&chain, steve, gary, usd), 0);

        // Put the fee back and the same quote runs.
        Wrapper::push_from(&chain, gary)
            .st_glb_fwd(usd, Quantity::new(0), PPM_SCALE * 2 / 100, never(), true)
            .get()?;
        Wrapper::push_from(&chain, alice)
            .path_pay(route, Quantity::new(amount_in), Quantity::new(0), 0)
            .get()?;
        assert_eq!(exp(&chain, gary, alice, usd), amount_in);
        Ok(())
    }

    /// A route whose sealed amount for one hop is off by one does not run, even
    /// though the draw would have succeeded and `min_return` is 0.
    #[psibase::test_case(packages("Banx"))]
    fn test_each_sealed_hop_amount_must_match_the_live_price(
        chain: psibase::Chain,
    ) -> Result<(), psibase::Error> {
        let (alice, gary, steve, usd) = quoted_net(&chain);
        let now = chain_seconds(&chain);
        let hops = vec![hop(gary, usd), hop(steve, usd)];
        let seal_amounts = |amounts: [u64; 2]| {
            let mut random = [0_u8; 24 + 12 * 48];
            random[0] = 1;
            crate::route::seal(
                &TEST_ROUTE_KEY,
                crate::route::RouteTerms {
                    epoch: 1,
                    payer: alice,
                    payee: steve,
                    from_asset: usd,
                    to_asset: usd,
                    amount_in: 500,
                    amount_out: u64::MAX,
                    expires_at: now + 60,
                },
                &hops,
                &amounts,
                &random,
            )
            .expect("seal route")
        };
        // 500 through a 2% forward draws 490 on the second hop.
        for wrong in [489, 491, 0] {
            let err = pay_error(&chain, alice, seal_amounts([500, wrong]), 500, 0);
            assert!(
                err.contains("path price changed since the quote"),
                "{wrong}: {err}"
            );
        }
        assert_eq!(exp(&chain, gary, alice, usd), 0);
        Wrapper::push_from(&chain, alice)
            .path_pay(
                seal_amounts([500, 490]),
                Quantity::new(500),
                Quantity::new(0),
                0,
            )
            .get()?;
        assert_eq!(exp(&chain, steve, gary, usd), 490);
        Ok(())
    }

    struct Quoted {
        route: String,
        amount_in: u64,
        amount_out: u64,
        min_return: u64,
        hops: u64,
    }

    /// Quote through the real query service, as `user`. `amount_raw` is what the
    /// payee receives in `to_asset` when `exact_out`, otherwise what the payer
    /// sends in `from_asset`.
    fn quote_between(
        chain: &psibase::Chain,
        user: AccountNumber,
        payer: AccountNumber,
        payee: AccountNumber,
        (from_asset, to_asset): (u16, u16),
        amount_raw: u64,
        exact_out: bool,
    ) -> Quoted {
        let amount_asset = if exact_out { to_asset } else { from_asset };
        let precision = Asset::get(amount_asset).unwrap().precision;
        let human = Decimal::new(Quantity::new(amount_raw), precision).to_string();
        let reply = banx_gql_as(
            chain,
            user,
            &format!(
                r#"{{ quotePath(from: "{payer}", to: "{payee}", amount: "{human}", fromAsset: {from_asset}, toAsset: {to_asset}, maxHops: 5, exactOut: {exact_out}) {{ route amountIn amountOut minReturn hopCount }} }}"#
            ),
        )
        .unwrap();
        let q = reply
            .pointer("/data/quotePath")
            .unwrap_or_else(|| panic!("quotePath failed: {reply}"));
        let num = |k: &str| q[k].as_str().unwrap().parse::<u64>().unwrap();
        Quoted {
            route: q["route"].as_str().unwrap().to_string(),
            amount_in: num("amountIn"),
            amount_out: num("amountOut"),
            min_return: num("minReturn"),
            hops: q["hopCount"].as_u64().unwrap(),
        }
    }

    struct FxNet {
        isabelle: AccountNumber,
        john: AccountNumber,
        mike: AccountNumber,
        james: AccountNumber,
        aud: u16,
        usd: u16,
    }

    /// Isabelle owes in AUD. John takes AUD and posts an AUD->USD offer (0.65,
    /// 10 flat). Mike and James are USD hops, Mike keeping a 1% forward fee.
    fn fx_net(chain: &psibase::Chain) -> FxNet {
        Wrapper::push(chain).init().get().unwrap();
        let isabelle = account!("isabelle");
        let john = account!("john");
        let mike = account!("mike");
        let james = account!("james");
        for a in [isabelle, john, mike, james] {
            chain.new_account(a).unwrap();
        }
        let aud = Asset::get_by_symbol_assert(account!("aud")).id;
        let usd = Asset::get_by_symbol_assert(account!("usd")).id;
        let limit = Quantity::new(1_000_000);
        Wrapper::push_from(chain, john)
            .st_crd_lne(isabelle, aud, limit, false)
            .get()
            .unwrap();
        Wrapper::push_from(chain, mike)
            .st_crd_lne(john, usd, limit, false)
            .get()
            .unwrap();
        Wrapper::push_from(chain, james)
            .st_crd_lne(mike, usd, limit, false)
            .get()
            .unwrap();
        Wrapper::push_from(chain, john)
            .st_glb_fwd(usd, Quantity::new(0), 0, never(), true)
            .get()
            .unwrap();
        Wrapper::push_from(chain, mike)
            .st_glb_fwd(usd, Quantity::new(0), PPM_SCALE / 100, never(), true)
            .get()
            .unwrap();
        post_fx(chain, john, aud, usd, 65);
        ensure_route_key(chain);
        FxNet {
            isabelle,
            john,
            mike,
            james,
            aud,
            usd,
        }
    }

    /// John's AUD->USD offer at `percent` USD per 100 AUD, with a flat 10 AUD fee.
    fn post_fx(chain: &psibase::Chain, john: AccountNumber, aud: u16, usd: u16, percent: u64) {
        Wrapper::push_from(chain, john)
            .st_fx_ofr(
                aud,
                usd,
                true,
                Quantity::new(10),
                RATE_SCALE * percent / 100,
                Quantity::new(u64::MAX),
                never(),
            )
            .get()
            .unwrap();
    }

    /// Isabelle pays James in USD while owing John in AUD, across John's offer.
    #[psibase::test_case(packages("Banx"))]
    fn test_quoted_fx_route_exact_out_crosses_currencies(
        chain: psibase::Chain,
    ) -> Result<(), psibase::Error> {
        let n = fx_net(&chain);
        let q = quote_between(
            &chain,
            n.isabelle,
            n.isabelle,
            n.james,
            (n.aud, n.usd),
            5_000,
            true,
        );
        assert_eq!(q.hops, 3, "john (AUD), mike (USD), james (USD)");
        assert!(q.amount_out >= 5_000);

        Wrapper::push_from(&chain, n.isabelle)
            .path_pay(
                q.route,
                Quantity::new(q.amount_in),
                Quantity::new(q.min_return),
                0,
            )
            .get()?;

        // Isabelle stays in AUD. John takes the USD liability to Mike.
        assert_eq!(exp(&chain, n.john, n.isabelle, n.aud), q.amount_in);
        assert_eq!(exp(&chain, n.isabelle, n.john, n.usd), 0);
        // Worked from the offer, not from the quote: (send - 10 flat) * 0.65.
        let fx_out = (q.amount_in - 10) * 65 / 100;
        assert_eq!(exp(&chain, n.mike, n.john, n.usd), fx_out);
        // Mike keeps 1% of what he forwards to James.
        let paid = exp(&chain, n.james, n.mike, n.usd);
        assert_eq!(paid, q.amount_out);
        let fee = fx_out - paid;
        assert!(
            fee >= fx_out / 100 && fee <= fx_out / 100 + 1,
            "fee {fee} of {fx_out}"
        );
        Ok(())
    }

    #[psibase::test_case(packages("Banx"))]
    fn test_quoted_fx_route_exact_in_crosses_currencies(
        chain: psibase::Chain,
    ) -> Result<(), psibase::Error> {
        let n = fx_net(&chain);
        let q = quote_between(
            &chain,
            n.isabelle,
            n.isabelle,
            n.james,
            (n.aud, n.usd),
            10_000,
            false,
        );
        assert_eq!(q.amount_in, 10_000);
        assert_eq!(
            q.min_return, q.amount_out,
            "exact-in floors at the quoted receive"
        );

        Wrapper::push_from(&chain, n.isabelle)
            .path_pay(
                q.route,
                Quantity::new(10_000),
                Quantity::new(q.min_return),
                0,
            )
            .get()?;
        assert_eq!(exp(&chain, n.john, n.isabelle, n.aud), 10_000);
        // (10_000 - 10) * 0.65 = 6_493.5, floored.
        assert_eq!(exp(&chain, n.mike, n.john, n.usd), 6_493);
        assert_eq!(exp(&chain, n.james, n.mike, n.usd), q.amount_out);
        Ok(())
    }

    /// John moves his rate after the quote. Even a better-for-John rate fails
    /// with no floor set: the payer approved a different price.
    #[psibase::test_case(packages("Banx"))]
    fn test_a_replaced_fx_rate_fails_the_quoted_route(
        chain: psibase::Chain,
    ) -> Result<(), psibase::Error> {
        let n = fx_net(&chain);
        let pair = (n.aud, n.usd);
        let q = quote_between(&chain, n.isabelle, n.isabelle, n.james, pair, 5_000, true);

        post_fx(&chain, n.john, n.aud, n.usd, 60);
        let err = pay_error(&chain, n.isabelle, q.route.clone(), q.amount_in, 0);
        assert!(err.contains("path price changed since the quote"), "{err}");
        assert_eq!(exp(&chain, n.john, n.isabelle, n.aud), 0);
        assert_eq!(exp(&chain, n.james, n.mike, n.usd), 0);

        // A fresh quote prices the new rate: more AUD for the same USD.
        let fresh = quote_between(&chain, n.isabelle, n.isabelle, n.james, pair, 5_000, true);
        assert!(
            fresh.amount_in > q.amount_in,
            "{} vs {}",
            fresh.amount_in,
            q.amount_in
        );
        Wrapper::push_from(&chain, n.isabelle)
            .path_pay(
                fresh.route,
                Quantity::new(fresh.amount_in),
                Quantity::new(fresh.min_return),
                0,
            )
            .get()?;
        assert_eq!(exp(&chain, n.john, n.isabelle, n.aud), fresh.amount_in);
        Ok(())
    }

    /// Bob pays Alice in AUD through John's USD/AUD relay curve.
    #[psibase::test_case(packages("Banx"))]
    fn test_quoted_relay_route_executes_and_goes_stale_after_another_trade(
        chain: psibase::Chain,
    ) -> Result<(), psibase::Error> {
        let net = relay_net(&chain);
        post_relay(&chain, net.john, net.usd, net.aud);
        ensure_route_key(&chain);
        let pair = (net.usd, net.aud);
        let quote =
            |amount: u64| quote_between(&chain, net.bob, net.bob, net.alice, pair, amount, true);

        let first = quote(1_000);
        let second = quote(1_000);
        assert_eq!(first.amount_in, second.amount_in);
        assert_eq!(first.hops, 3, "brandon, john (USD), alice (AUD)");

        Wrapper::push_from(&chain, net.bob)
            .path_pay(
                first.route,
                Quantity::new(first.amount_in),
                Quantity::new(first.min_return),
                0,
            )
            .get()?;
        assert_eq!(exp(&chain, net.brandon, net.bob, net.usd), first.amount_in);
        assert_eq!(exp(&chain, net.alice, net.john, net.aud), first.amount_out);

        // That trade moved the curve. The second quote priced the old reserves.
        let err = pay_error(&chain, net.bob, second.route, second.amount_in, 0);
        assert!(err.contains("path price changed since the quote"), "{err}");

        // A fresh quote prices the new reserves: AUD is dearer in USD now.
        let third = quote(1_000);
        assert!(
            third.amount_in > first.amount_in,
            "{} vs {}",
            third.amount_in,
            first.amount_in
        );
        Wrapper::push_from(&chain, net.bob)
            .path_pay(
                third.route,
                Quantity::new(third.amount_in),
                Quantity::new(third.min_return),
                0,
            )
            .get()?;
        assert_eq!(
            exp(&chain, net.alice, net.john, net.aud),
            first.amount_out + third.amount_out
        );
        Ok(())
    }

    #[psibase::test_case(packages("Banx"))]
    fn test_quoted_route_pays_an_invoice_and_binds_the_price(
        chain: psibase::Chain,
    ) -> Result<(), psibase::Error> {
        let (alice, gary, steve, usd) = quoted_net(&chain);
        let id = Wrapper::push_from(&chain, steve)
            .st_req(
                PayRequest::INVOICE,
                alice,
                usd,
                Quantity::new(400),
                "lunch".into(),
                never(),
            )
            .get()?;
        let q = quote_between(&chain, alice, alice, steve, (usd, usd), 400, true);

        // A budget under the quoted send is refused.
        let low = Wrapper::push_from(&chain, alice)
            .pay_inv(q.route.clone(), Quantity::new(q.amount_in - 1), id)
            .get()
            .expect_err("budget below the send");
        assert!(
            low.to_string().contains("max_spend below required send"),
            "{low}"
        );

        // Gary raises his fee. A generous budget would absorb it. The price
        // check does not.
        Wrapper::push_from(&chain, gary)
            .st_glb_fwd(usd, Quantity::new(0), PPM_SCALE / 10, never(), true)
            .get()?;
        let moved = Wrapper::push_from(&chain, alice)
            .pay_inv(q.route.clone(), Quantity::new(q.amount_in * 2), id)
            .get()
            .expect_err("the fee moved");
        assert!(
            moved
                .to_string()
                .contains("path price changed since the quote"),
            "{moved}"
        );
        assert!(PayRequest::get(id).is_some());

        Wrapper::push_from(&chain, gary)
            .st_glb_fwd(usd, Quantity::new(0), PPM_SCALE * 2 / 100, never(), true)
            .get()?;
        Wrapper::push_from(&chain, alice)
            .pay_inv(q.route, Quantity::new(q.amount_in), id)
            .get()?;
        assert!(PayRequest::get(id).is_none());
        assert_eq!(exp(&chain, steve, gary, usd), 400);
        assert_eq!(exp(&chain, gary, alice, usd), q.amount_in);
        Ok(())
    }

    /// The payee runs the payer's repeating payment with a route they quoted
    /// for the payer.
    #[psibase::test_case(packages("Banx"))]
    fn test_quoted_route_runs_a_repeating_payment_and_binds_the_price(
        chain: psibase::Chain,
    ) -> Result<(), psibase::Error> {
        let (alice, gary, steve, usd) = quoted_net(&chain);
        let start = chain_seconds(&chain);
        let id = schedule(&chain, alice, steve, usd, 400, 1_000, 100, start, 0);
        let q = quote_between(&chain, steve, alice, steve, (usd, usd), 400, true);

        Wrapper::push_from(&chain, gary)
            .st_glb_fwd(usd, Quantity::new(0), PPM_SCALE / 10, never(), true)
            .get()?;
        let moved = Wrapper::push_from(&chain, steve)
            .run_pay_ath(id, q.route.clone())
            .get()
            .expect_err("the fee moved");
        assert!(
            moved
                .to_string()
                .contains("path price changed since the quote"),
            "{moved}"
        );
        assert_eq!(pay_row(id).next_due.seconds, start);
        assert_eq!(exp(&chain, gary, alice, usd), 0);

        Wrapper::push_from(&chain, gary)
            .st_glb_fwd(usd, Quantity::new(0), PPM_SCALE * 2 / 100, never(), true)
            .get()?;
        Wrapper::push_from(&chain, steve)
            .run_pay_ath(id, q.route)
            .get()?;
        assert_eq!(pay_row(id).next_due.seconds, start + 100);
        assert_eq!(exp(&chain, steve, gary, usd), 400);
        assert_eq!(exp(&chain, gary, alice, usd), q.amount_in);
        Ok(())
    }

    #[psibase::test_case(packages("Banx"))]
    fn test_path_pay_same_asset_hops(chain: psibase::Chain) -> Result<(), psibase::Error> {
        Wrapper::push(&chain).init().get()?;

        let alice = account!("alice");
        let gary = account!("gary");
        let steve = account!("steve");
        chain.new_account(alice).unwrap();
        chain.new_account(gary).unwrap();
        chain.new_account(steve).unwrap();

        let usd = Asset::get_by_symbol_assert(account!("usd")).id;
        let amount = Quantity::new(500);

        Wrapper::push_from(&chain, gary)
            .st_crd_lne(alice, usd, Quantity::new(10_000), false)
            .get()?;
        Wrapper::push_from(&chain, steve)
            .st_crd_lne(gary, usd, Quantity::new(10_000), false)
            .get()?;

        Wrapper::push_from(&chain, gary)
            .st_glb_fwd(usd, Quantity::new(0), PPM_SCALE * 2 / 100, never(), true)
            .get()?;

        Wrapper::push_from(&chain, alice)
            .path_pay(
                seal(&chain, alice, vec![hop(gary, usd), hop(steve, usd)], amount),
                amount,
                Quantity::new(490),
                0,
            )
            .get()?;

        assert_eq!(exp(&chain, gary, alice, usd), 500);
        assert_eq!(exp(&chain, steve, gary, usd), 490);

        Ok(())
    }

    /// Bandit books $10 AUD of chores (he owes Bluey). Bluey pays Bingo $2.50
    /// for a popper through dad — Bingo will not take Bluey's IOU. No line
    /// from Bandit to Bluey: she can only spend what she is already owed.
    #[psibase::test_case(packages("Banx"))]
    fn test_bluey_pays_bingo_popper_through_bandit(
        chain: psibase::Chain,
    ) -> Result<(), psibase::Error> {
        Wrapper::push(&chain).init().get()?;
        let bandit = account!("bandit");
        let bluey = account!("bluey");
        let bingo = account!("bingo");
        for a in [bandit, bluey, bingo] {
            chain.new_account(a).unwrap();
        }
        let aud = Asset::get_by_symbol_assert(account!("aud")).id;
        let chores = Quantity::new(100_000); // $10.0000
        let popper = Quantity::new(25_000); // $2.5000
        let leftover = Quantity::new(chores.value - popper.value);

        Wrapper::push_from(&chain, bandit)
            .deposit(bluey, aud, chores, 0)
            .get()?;
        assert_eq!(exp(&chain, bluey, bandit, aud), chores.value);

        // Children consider their parents debt to be as good as cash.
        // Therefore set high credit limits.
        Wrapper::push_from(&chain, bingo)
            .st_crd_lne(bandit, aud, Quantity::new(1_000_000), false)
            .get()?;
        Wrapper::push_from(&chain, bluey)
            .st_crd_lne(bandit, aud, Quantity::new(1_000_000), false)
            .get()?;

        // Bandit allows forwarding to his children, free of charge.
        Wrapper::push_from(&chain, bandit)
            .st_fwd_ofr(bingo, aud, Quantity::new(0), 0, never(), true)
            .get()?;

        Wrapper::push_from(&chain, bandit)
            .st_fwd_ofr(bluey, aud, Quantity::new(0), 0, never(), true)
            .get()?;

        assert!(Wrapper::push_from(&chain, bluey)
            .path_pay(
                seal(&chain, bluey, vec![hop(bingo, aud)], popper),
                popper,
                popper,
                0
            )
            .get()
            .is_err());

        Wrapper::push_from(&chain, bluey)
            .path_pay(
                seal(
                    &chain,
                    bluey,
                    vec![hop(bandit, aud), hop(bingo, aud)],
                    popper,
                ),
                popper,
                popper,
                0,
            )
            .get()?;

        assert_eq!(exp(&chain, bluey, bandit, aud), leftover.value);
        assert_eq!(exp(&chain, bingo, bandit, aud), popper.value);
        assert_eq!(exp(&chain, bandit, bluey, aud), 0);
        assert_eq!(exp(&chain, bingo, bluey, aud), 0);
        assert_eq!(exp(&chain, bluey, bingo, aud), 0);

        assert!(Wrapper::push_from(&chain, bluey)
            .path_pay(
                seal(
                    &chain,
                    bluey,
                    vec![hop(bandit, aud), hop(bingo, aud)],
                    Quantity::new(leftover.value + 1)
                ),
                Quantity::new(leftover.value + 1),
                Quantity::new(leftover.value + 1),
                0,
            )
            .get()
            .is_err());

        Wrapper::push_from(&chain, bluey)
            .path_pay(
                seal(
                    &chain,
                    bluey,
                    vec![hop(bandit, aud), hop(bingo, aud)],
                    leftover,
                ),
                leftover,
                leftover,
                0,
            )
            .get()?;
        assert_eq!(exp(&chain, bluey, bandit, aud), 0);
        assert_eq!(exp(&chain, bingo, bandit, aud), chores.value);
        Ok(())
    }

    #[psibase::test_case(packages("Banx"))]
    fn test_path_pay_cross_asset(chain: psibase::Chain) -> Result<(), psibase::Error> {
        Wrapper::push(&chain).init().get()?;

        let alice = account!("alice");
        let gary = account!("gary");
        let steve = account!("steve");
        chain.new_account(alice).unwrap();
        chain.new_account(gary).unwrap();
        chain.new_account(steve).unwrap();

        let aud = Asset::get_by_symbol_assert(account!("aud")).id;
        let usd = Asset::get_by_symbol_assert(account!("usd")).id;

        Wrapper::push_from(&chain, gary)
            .st_crd_lne(alice, aud, Quantity::new(10_000), false)
            .get()?;
        Wrapper::push_from(&chain, steve)
            .st_crd_lne(gary, usd, Quantity::new(10_000), false)
            .get()?;

        // Gary (middle man / claim holder) posts AUD→USD (0.70).
        Wrapper::push_from(&chain, gary)
            .st_fx_ofr(
                aud,
                usd,
                true,
                Quantity::new(0),
                RATE_SCALE * 70 / 100,
                Quantity::new(u64::MAX),
                never(),
            )
            .get()?;
        // Gary routes same-asset USD to Steve (no fee).
        Wrapper::push_from(&chain, gary)
            .st_glb_fwd(usd, Quantity::new(0), 0, never(), true)
            .get()?;

        Wrapper::push_from(&chain, alice)
            .path_pay(
                seal(
                    &chain,
                    alice,
                    vec![hop(gary, aud), hop(steve, usd)],
                    Quantity::new(1_000),
                ),
                Quantity::new(1_000),
                Quantity::new(700),
                0,
            )
            .get()?;

        // Alice stays in AUD; Gary takes the USD liability to Steve.
        assert_eq!(exp(&chain, gary, alice, aud), 1_000);
        assert_eq!(exp(&chain, gary, alice, usd), 0);
        assert_eq!(exp(&chain, steve, gary, usd), 700);

        Ok(())
    }

    /// Multi-hop currency path:
    ///   Zac → Mitchell → John  (AUD)
    ///   John → Mike → Brandon  (USD, FX at John→Mike)
    ///
    /// Atomic path_pay:
    ///   [(mitchell, AUD), (john, AUD), (mike, USD), (brandon, USD)]
    #[psibase::test_case(packages("Banx"))]
    fn test_path_pay_zac_mitchell_john_aud_then_usd_mike_brandon(
        chain: psibase::Chain,
    ) -> Result<(), psibase::Error> {
        Wrapper::push(&chain).init().get()?;

        let zac = account!("zac");
        let mitchell = account!("mitchell");
        let john = account!("john");
        let mike = account!("mike");
        let brandon = account!("brandon");
        for a in [zac, mitchell, john, mike, brandon] {
            chain.new_account(a).unwrap();
        }

        let aud = Asset::get_by_symbol_assert(account!("aud")).id;
        let usd = Asset::get_by_symbol_assert(account!("usd")).id;
        let limit = Quantity::new(1_000_000);
        let amount_aud = Quantity::new(10_000);

        // --- Credit lines (creditor extends to debtor) ---
        // Mitchell ← Zac (AUD)
        Wrapper::push_from(&chain, mitchell)
            .st_crd_lne(zac, aud, limit, false)
            .get()?;
        // John ← Mitchell (AUD)
        Wrapper::push_from(&chain, john)
            .st_crd_lne(mitchell, aud, limit, false)
            .get()?;
        // Mike ← John (USD) — capacity for AUD→USD hop
        Wrapper::push_from(&chain, mike)
            .st_crd_lne(john, usd, limit, false)
            .get()?;
        // Brandon ← Mike (USD)
        Wrapper::push_from(&chain, brandon)
            .st_crd_lne(mike, usd, limit, false)
            .get()?;

        // --- Routing (same-asset fees) ---
        // Mitchell → John, AUD, 5% hop fee
        Wrapper::push_from(&chain, mitchell)
            .st_glb_fwd(aud, Quantity::new(0), PPM_SCALE * 5 / 100, never(), true)
            .get()?;
        // John → Mike, USD (after convert), no fee
        Wrapper::push_from(&chain, john)
            .st_glb_fwd(usd, Quantity::new(0), 0, never(), true)
            .get()?;
        // Mike → Brandon, USD, 1% hop fee
        Wrapper::push_from(&chain, mike)
            .st_glb_fwd(usd, Quantity::new(0), PPM_SCALE * 1 / 100, never(), true)
            .get()?;
        // John (AUD creditor / middle man into USD) posts AUD→USD at 0.65
        Wrapper::push_from(&chain, john)
            .st_fx_ofr(
                aud,
                usd,
                true,
                Quantity::new(0),
                RATE_SCALE * 65 / 100,
                Quantity::new(u64::MAX),
                never(),
            )
            .get()?;

        // 10_000 AUD:
        //   Zac owes Mitchell 10_000 AUD
        //   Mitchell owes John  9_500 AUD  (5% hop fee; not rebooked)
        //   John owes Mike      6_175 USD  (John's 0.65 FX)
        //   Mike owes Brandon   6_113 USD  (1% hop fee)
        let min_brandon = Quantity::new(6_113);

        Wrapper::push_from(&chain, zac)
            .path_pay(
                seal(
                    &chain,
                    zac,
                    vec![
                        hop(mitchell, aud),
                        hop(john, aud),
                        hop(mike, usd),
                        hop(brandon, usd),
                    ],
                    amount_aud,
                ),
                amount_aud,
                min_brandon,
                0,
            )
            .get()?;

        // AUD book
        assert_eq!(
            exp(&chain, mitchell, zac, aud),
            10_000,
            "Zac owes Mitchell 10000 AUD"
        );
        // John prices AUD→USD but does not rebook Mitchell's AUD claim.
        assert_eq!(
            exp(&chain, john, mitchell, aud),
            9_500,
            "Mitchell still owes John 9500 AUD"
        );
        assert_eq!(
            exp(&chain, john, mitchell, usd),
            0,
            "path_pay does not rebook into USD"
        );
        // USD path
        assert_eq!(
            exp(&chain, mike, john, usd),
            6_175,
            "John owes Mike 6175 USD"
        );
        assert_eq!(
            exp(&chain, brandon, mike, usd),
            6_113,
            "Mike owes Brandon 6113 USD after 1% fee"
        );

        assert_eq!(exp(&chain, mike, john, aud), 0);
        assert_eq!(exp(&chain, brandon, mike, aud), 0);

        Ok(())
    }

    /// Cafe cash flow:
    /// John prepays $100 cash; the cafe books a deposit (cafe owes John).
    /// Friends pay the cafe through John instead of cards. John posts a
    /// 1% path-forward toward the cafe. Cafe invoices Mitchell $5; he
    /// path-pays through John and must send more than $5 so $5 arrives.
    /// John is leaving, so he sells $90 of cafe claim to Pippa
    /// at a 5/90 haircut: she takes the $90 claim and owes him $85.
    #[psibase::test_case(packages("Banx"))]
    fn test_path_pay_cafe(chain: psibase::Chain) -> Result<(), psibase::Error> {
        Wrapper::push(&chain).init().get()?;

        let mitchell = account!("mitchell");
        let john = account!("john");
        let cafe = account!("cafe");
        let pippa = account!("pippa");
        for a in [mitchell, john, cafe, pippa] {
            chain.new_account(a).unwrap();
        }

        let aud = Asset::get_by_symbol_assert(account!("aud")).id;

        Wrapper::push_from(&chain, cafe)
            .deposit(john, aud, 100_0000.into(), 0)
            .get()?;

        Wrapper::push_from(&chain, john)
            .st_crd_lne(mitchell, aud, 10_0000.into(), false)
            .get()?;
        Wrapper::push_from(&chain, john)
            .st_fwd_ofr(cafe, aud, 0.into(), PPM_SCALE / 100, never(), false)
            .get()?;

        let id = Wrapper::push_from(&chain, cafe)
            .st_req(
                PayRequest::INVOICE,
                mitchell,
                aud,
                5_0000.into(),
                "coffee".into(),
                never(),
            )
            .get()?;

        // 1% hop fee: 50506 * 99/100 floors to 50000.
        Wrapper::push_from(&chain, mitchell)
            .path_pay(
                seal(
                    &chain,
                    mitchell,
                    vec![hop(john, aud), hop(cafe, aud)],
                    5_0506.into(),
                ),
                5_0506.into(),
                5_0000.into(),
                id,
            )
            .get()?;

        assert!(PayRequest::get(id).is_none());
        assert_eq!(exp(&chain, john, cafe, aud), 95_0000);
        assert_eq!(exp(&chain, john, mitchell, aud), 5_0506);
        assert_eq!(exp(&chain, mitchell, cafe, aud), 0);

        // $90 face at a 5/90 (~5.555%) haircut → Pippa owes John $85.
        // buy_claim draws that cost on John's line to Pippa.
        Wrapper::push_from(&chain, john)
            .st_crd_lne(pippa, aud, 85_0000.into(), false)
            .get()?;
        Wrapper::push_from(&chain, john)
            .st_sell_clm(
                cafe,
                aud,
                Quantity::new(0),
                -((PPM_SCALE as i32) * 5 / 90),
                Quantity::new(u64::MAX),
                never(),
            )
            .get()?;
        Wrapper::push_from(&chain, cafe)
            .st_crd_lne(pippa, aud, Quantity::new(0), false)
            .get()?;
        Wrapper::push_from(&chain, pippa)
            .st_crd_lne(cafe, aud, 90_0000.into(), false)
            .get()?;
        Wrapper::push_from(&chain, pippa)
            .buy_claim(john, cafe, aud, 90_0000.into(), Quantity::new(0))
            .get()?;

        assert_eq!(exp(&chain, john, cafe, aud), 5_0000);
        assert_eq!(exp(&chain, pippa, cafe, aud), 90_0000);
        assert_eq!(exp(&chain, john, pippa, aud), 85_0000);
        assert_eq!(exp(&chain, john, mitchell, aud), 5_0506);

        Ok(())
    }

    /// Same multi-hop graph, but min_return too high after FX + fee → full revert.
    #[psibase::test_case(packages("Banx"))]
    fn test_path_pay_currency_hop_min_return_reverts(
        chain: psibase::Chain,
    ) -> Result<(), psibase::Error> {
        Wrapper::push(&chain).init().get()?;

        let zac = account!("zac");
        let mitchell = account!("mitchell");
        let john = account!("john");
        let mike = account!("mike");
        let brandon = account!("brandon");
        for a in [zac, mitchell, john, mike, brandon] {
            chain.new_account(a).unwrap();
        }

        let aud = Asset::get_by_symbol_assert(account!("aud")).id;
        let usd = Asset::get_by_symbol_assert(account!("usd")).id;
        let limit = Quantity::new(1_000_000);

        Wrapper::push_from(&chain, mitchell)
            .st_crd_lne(zac, aud, limit, false)
            .get()?;
        Wrapper::push_from(&chain, john)
            .st_crd_lne(mitchell, aud, limit, false)
            .get()?;
        Wrapper::push_from(&chain, mike)
            .st_crd_lne(john, usd, limit, false)
            .get()?;
        Wrapper::push_from(&chain, brandon)
            .st_crd_lne(mike, usd, limit, false)
            .get()?;

        Wrapper::push_from(&chain, mitchell)
            .st_glb_fwd(aud, Quantity::new(0), PPM_SCALE * 5 / 100, never(), true)
            .get()?;
        Wrapper::push_from(&chain, john)
            .st_glb_fwd(usd, Quantity::new(0), 0, never(), true)
            .get()?;
        Wrapper::push_from(&chain, mike)
            .st_glb_fwd(usd, Quantity::new(0), PPM_SCALE * 1 / 100, never(), true)
            .get()?;
        Wrapper::push_from(&chain, john)
            .st_fx_ofr(
                aud,
                usd,
                true,
                Quantity::new(0),
                RATE_SCALE * 65 / 100,
                Quantity::new(u64::MAX),
                never(),
            )
            .get()?;

        // Actual final = 6113; demand 7000 → fail; no legs stick.
        let result = Wrapper::push_from(&chain, zac)
            .path_pay(
                seal(
                    &chain,
                    zac,
                    vec![
                        hop(mitchell, aud),
                        hop(john, aud),
                        hop(mike, usd),
                        hop(brandon, usd),
                    ],
                    Quantity::new(10_000),
                ),
                Quantity::new(10_000),
                Quantity::new(7_000),
                0,
            )
            .get();
        assert!(result.is_err());

        assert_eq!(exp(&chain, mitchell, zac, aud), 0);
        assert_eq!(exp(&chain, john, mitchell, aud), 0);
        assert_eq!(exp(&chain, mike, john, usd), 0);
        assert_eq!(exp(&chain, brandon, mike, usd), 0);

        Ok(())
    }

    /// From-asset `remaining` caps path FX. A hop larger than what is left
    /// is rejected whole. Posting again replaces what is left.
    #[psibase::test_case(packages("Banx"))]
    fn test_fx_offer_remaining_caps_path(chain: psibase::Chain) -> Result<(), psibase::Error> {
        Wrapper::push(&chain).init().get()?;
        let alice = account!("alice");
        let gary = account!("gary");
        let steve = account!("steve");
        for a in [alice, gary, steve] {
            chain.new_account(a).unwrap();
        }
        let aud = Asset::get_by_symbol_assert(account!("aud")).id;
        let usd = Asset::get_by_symbol_assert(account!("usd")).id;

        Wrapper::push_from(&chain, gary)
            .st_crd_lne(alice, aud, Quantity::new(10_000), false)
            .get()?;

        let zero = Wrapper::push_from(&chain, gary).st_fx_ofr(
            aud,
            usd,
            true,
            Quantity::new(0),
            RATE_SCALE * 50 / 100,
            Quantity::new(0),
            never(),
        );
        let err = zero.trace.error.as_deref().unwrap_or("(no error)");
        assert!(
            err.contains("fx offer remaining must be positive"),
            "zero remaining: {err}"
        );
        assert!(FxOffer::get(gary, aud, usd, true).is_none());

        // 1000 AUD at 0.70 needs 1000 of budget. 500 delivers 350 USD.
        Wrapper::push_from(&chain, steve)
            .st_crd_lne(gary, usd, Quantity::new(10_000), false)
            .get()?;
        Wrapper::push_from(&chain, gary)
            .st_glb_fwd(usd, Quantity::new(0), 0, never(), true)
            .get()?;
        Wrapper::push_from(&chain, gary)
            .st_fx_ofr(
                aud,
                usd,
                true,
                Quantity::new(0),
                RATE_SCALE * 70 / 100,
                Quantity::new(500),
                never(),
            )
            .get()?;

        let too_big = Wrapper::push_from(&chain, alice).path_pay(
            seal(
                &chain,
                alice,
                vec![hop(gary, aud), hop(steve, usd)],
                Quantity::new(1_000),
            ),
            Quantity::new(1_000),
            Quantity::new(700),
            0,
        );
        let err = too_big.trace.error.as_deref().unwrap_or("(no error)");
        assert!(
            err.contains("fx offer amount exceeds remaining"),
            "path over remaining: {err}"
        );
        assert_eq!(exp(&chain, gary, alice, aud), 0);
        assert_eq!(exp(&chain, steve, gary, usd), 0);
        assert_eq!(
            FxOffer::get_assert(gary, aud, usd, true).remaining.value,
            500
        );

        let id = Wrapper::push_from(&chain, steve)
            .st_req(
                PayRequest::INVOICE,
                alice,
                usd,
                Quantity::new(700),
                "x".into(),
                never(),
            )
            .get()?;
        let inv = Wrapper::push_from(&chain, alice).pay_inv(
            seal_inv(&chain, alice, vec![hop(gary, aud), hop(steve, usd)], id),
            Quantity::new(2_000),
            id,
        );
        let err = inv.trace.error.as_deref().unwrap_or("(no error)");
        assert!(
            err.contains("fx offer amount exceeds remaining"),
            "invoice over remaining: {err}"
        );
        assert_eq!(PayRequest::get_assert(id).remaining.value, 700);
        assert_eq!(exp(&chain, steve, gary, usd), 0);

        Wrapper::push_from(&chain, alice)
            .path_pay(
                seal(
                    &chain,
                    alice,
                    vec![hop(gary, aud), hop(steve, usd)],
                    Quantity::new(500),
                ),
                Quantity::new(500),
                Quantity::new(350),
                0,
            )
            .get()?;
        assert_eq!(exp(&chain, gary, alice, aud), 500);
        assert_eq!(exp(&chain, steve, gary, usd), 350);
        assert!(FxOffer::get(gary, aud, usd, true).is_none());
        assert!(Wrapper::push_from(&chain, alice)
            .path_pay(
                seal(
                    &chain,
                    alice,
                    vec![hop(gary, aud), hop(steve, usd)],
                    Quantity::new(1)
                ),
                Quantity::new(1),
                Quantity::new(0),
                0,
            )
            .get()
            .is_err());
        assert_eq!(exp(&chain, gary, alice, aud), 500);
        assert_eq!(exp(&chain, steve, gary, usd), 350);

        Ok(())
    }

    #[psibase::test_case(packages("Banx"))]
    fn test_rm_fx_ofr_removes_offer(chain: psibase::Chain) -> Result<(), psibase::Error> {
        Wrapper::push(&chain).init().get()?;
        let gary = account!("gary");
        chain.new_account(gary).unwrap();
        let aud = Asset::get_by_symbol_assert(account!("aud")).id;
        let usd = Asset::get_by_symbol_assert(account!("usd")).id;

        Wrapper::push_from(&chain, gary)
            .st_fx_ofr(
                aud,
                usd,
                true,
                Quantity::new(0),
                RATE_SCALE,
                Quantity::new(u64::MAX),
                never(),
            )
            .get()?;
        assert!(FxOffer::get(gary, aud, usd, true).is_some());

        Wrapper::push_from(&chain, gary)
            .rm_fx_ofr(aud, usd, true)
            .get()?;
        assert!(FxOffer::get(gary, aud, usd, true).is_none());
        assert!(Wrapper::push_from(&chain, gary)
            .rm_fx_ofr(aud, usd, true)
            .get()
            .is_err());
        Ok(())
    }

    #[psibase::test_case(packages("Banx"))]
    fn test_path_pay_requires_routing(chain: psibase::Chain) -> Result<(), psibase::Error> {
        Wrapper::push(&chain).init().get()?;

        let alice = account!("alice");
        let gary = account!("gary");
        let steve = account!("steve");
        chain.new_account(alice).unwrap();
        chain.new_account(gary).unwrap();
        chain.new_account(steve).unwrap();

        let usd = Asset::get_by_symbol_assert(account!("usd")).id;
        Wrapper::push_from(&chain, gary)
            .st_crd_lne(alice, usd, Quantity::new(1_000), false)
            .get()?;
        Wrapper::push_from(&chain, steve)
            .st_crd_lne(gary, usd, Quantity::new(1_000), false)
            .get()?;

        let result = Wrapper::push_from(&chain, alice)
            .path_pay(
                seal(
                    &chain,
                    alice,
                    vec![hop(gary, usd), hop(steve, usd)],
                    Quantity::new(100),
                ),
                Quantity::new(100),
                Quantity::new(0),
                0,
            )
            .get();
        assert!(result.is_err());

        Ok(())
    }

    #[psibase::test_case(packages("Banx"))]
    fn test_path_pay_min_return(chain: psibase::Chain) -> Result<(), psibase::Error> {
        Wrapper::push(&chain).init().get()?;

        let alice = account!("alice");
        let gary = account!("gary");
        let steve = account!("steve");
        chain.new_account(alice).unwrap();
        chain.new_account(gary).unwrap();
        chain.new_account(steve).unwrap();

        let usd = Asset::get_by_symbol_assert(account!("usd")).id;
        Wrapper::push_from(&chain, gary)
            .st_crd_lne(alice, usd, Quantity::new(10_000), false)
            .get()?;
        Wrapper::push_from(&chain, steve)
            .st_crd_lne(gary, usd, Quantity::new(10_000), false)
            .get()?;
        Wrapper::push_from(&chain, gary)
            .st_glb_fwd(usd, Quantity::new(50), 0, never(), true)
            .get()?;

        let result = Wrapper::push_from(&chain, alice)
            .path_pay(
                seal(
                    &chain,
                    alice,
                    vec![hop(gary, usd), hop(steve, usd)],
                    Quantity::new(100),
                ),
                Quantity::new(100),
                Quantity::new(80),
                0,
            )
            .get();
        assert!(result.is_err());

        Wrapper::push_from(&chain, alice)
            .path_pay(
                seal(
                    &chain,
                    alice,
                    vec![hop(gary, usd), hop(steve, usd)],
                    Quantity::new(100),
                ),
                Quantity::new(100),
                Quantity::new(50),
                0,
            )
            .get()?;
        assert_eq!(exp(&chain, steve, gary, usd), 50);

        Ok(())
    }

    #[psibase::test_case(packages("Banx"))]
    fn test_deposit_auto_nets_full(chain: psibase::Chain) -> Result<(), psibase::Error> {
        Wrapper::push(&chain).init().get()?;

        let alice = account!("alice");
        let bob = account!("bob");
        chain.new_account(alice).unwrap();
        chain.new_account(bob).unwrap();

        let usd = Asset::get_by_symbol_assert(account!("usd")).id;
        let amount = Quantity::new(100);

        Wrapper::push_from(&chain, bob)
            .st_crd_lne(alice, usd, Quantity::new(1_000), false)
            .get()?;
        Wrapper::push_from(&chain, alice)
            .path_pay(
                seal(&chain, alice, vec![hop(bob, usd)], amount),
                amount,
                amount,
                0,
            )
            .get()?;

        Wrapper::push_from(&chain, bob)
            .deposit(alice, usd, amount, 0)
            .get()?;

        assert_eq!(exp(&chain, bob, alice, usd), 0);
        assert_eq!(exp(&chain, alice, bob, usd), 0);

        Ok(())
    }

    /// path_pay / Connection::draw auto-nets mutual claims on the pair.
    #[psibase::test_case(packages("Banx"))]
    fn test_path_pay_auto_nets_reverse_draw(chain: psibase::Chain) -> Result<(), psibase::Error> {
        Wrapper::push(&chain).init().get()?;

        let alice = account!("alice");
        let bob = account!("bob");
        chain.new_account(alice).unwrap();
        chain.new_account(bob).unwrap();

        let usd = Asset::get_by_symbol_assert(account!("usd")).id;

        // Mutual revolving lines.
        Wrapper::push_from(&chain, bob)
            .st_crd_lne(alice, usd, Quantity::new(10_000), false)
            .get()?;
        Wrapper::push_from(&chain, alice)
            .st_crd_lne(bob, usd, Quantity::new(10_000), false)
            .get()?;

        // Alice draws 100 on Bob → Bob is creditor, Alice debtor.
        Wrapper::push_from(&chain, alice)
            .path_pay(
                seal(&chain, alice, vec![hop(bob, usd)], Quantity::new(100)),
                Quantity::new(100),
                Quantity::new(100),
                0,
            )
            .get()?;
        assert_eq!(exp(&chain, bob, alice, usd), 100);
        assert_eq!(exp(&chain, alice, bob, usd), 0);

        // Bob draws 100 on Alice → reverse claim auto-nets to zero.
        Wrapper::push_from(&chain, bob)
            .path_pay(
                seal(&chain, bob, vec![hop(alice, usd)], Quantity::new(100)),
                Quantity::new(100),
                Quantity::new(100),
                0,
            )
            .get()?;
        assert_eq!(exp(&chain, bob, alice, usd), 0);
        assert_eq!(exp(&chain, alice, bob, usd), 0);

        // Partial reverse: Alice draws 100, Bob draws 40 → Alice still owes 60.
        Wrapper::push_from(&chain, alice)
            .path_pay(
                seal(&chain, alice, vec![hop(bob, usd)], Quantity::new(100)),
                Quantity::new(100),
                Quantity::new(100),
                0,
            )
            .get()?;
        Wrapper::push_from(&chain, bob)
            .path_pay(
                seal(&chain, bob, vec![hop(alice, usd)], Quantity::new(40)),
                Quantity::new(40),
                Quantity::new(40),
                0,
            )
            .get()?;
        assert_eq!(exp(&chain, bob, alice, usd), 60);
        assert_eq!(exp(&chain, alice, bob, usd), 0);

        Ok(())
    }

    /// Alice holds Bob debt, sells to Peter under Peter's buy-claim offer.
    /// Peter takes Bob face; Alice gets face after fees as claim on Peter.
    #[psibase::test_case(packages("Banx"))]
    fn test_sell_claim_discount(chain: psibase::Chain) -> Result<(), psibase::Error> {
        Wrapper::push(&chain).init().get()?;

        let alice = account!("alice");
        let bob = account!("bob");
        let peter = account!("peter");
        chain.new_account(alice).unwrap();
        chain.new_account(bob).unwrap();
        chain.new_account(peter).unwrap();

        let usd = Asset::get_by_symbol_assert(account!("usd")).id;

        // Alice holds Bob debt via deposit (Bob books liability to Alice...
        // deposit: sender=receiver owes depositor. Alice deposit depositor=bob → Alice owes Bob.
        // We need Bob owes Alice: Bob deposit depositor=alice.
        Wrapper::push_from(&chain, bob)
            .deposit(alice, usd, Quantity::new(10_000), 0)
            .get()?;
        assert_eq!(exp(&chain, alice, bob, usd), 10_000);

        // Peter willing to be owed by Bob up to 10k.
        Wrapper::push_from(&chain, peter)
            .st_crd_lne(bob, usd, Quantity::new(10_000), false)
            .get()?;
        // Global buy-claim: 5% take fee (no forward offer needed).
        Wrapper::push_from(&chain, peter)
            .st_glb_buy(
                usd,
                Quantity::new(0),
                (PPM_SCALE * 5 / 100) as i32,
                Quantity::new(u64::MAX),
                never(),
            )
            .get()?;
        Wrapper::push_from(&chain, bob)
            .st_crd_lne(peter, usd, Quantity::new(0), false)
            .get()?;

        // Alice signs the 5% haircut she was shown. A later worse spread fails.
        Wrapper::push_from(&chain, alice)
            .sell_claim(peter, bob, usd, Quantity::new(10_000), Quantity::new(9_500))
            .get()?;

        // Bob now owes Peter full face; Alice holds 9500 on Peter.
        assert_eq!(exp(&chain, alice, bob, usd), 0);
        assert_eq!(exp(&chain, peter, bob, usd), 10_000);
        assert_eq!(exp(&chain, alice, peter, usd), 9_500);

        Ok(())
    }

    /// Same as buy-claim, but Peter posts a 5% premium: Alice gets 10500 on Peter.
    #[psibase::test_case(packages("Banx"))]
    fn test_sell_claim_premium(chain: psibase::Chain) -> Result<(), psibase::Error> {
        Wrapper::push(&chain).init().get()?;

        let alice = account!("alice");
        let bob = account!("bob");
        let peter = account!("peter");
        chain.new_account(alice).unwrap();
        chain.new_account(bob).unwrap();
        chain.new_account(peter).unwrap();

        let usd = Asset::get_by_symbol_assert(account!("usd")).id;

        Wrapper::push_from(&chain, bob)
            .deposit(alice, usd, Quantity::new(10_000), 0)
            .get()?;

        Wrapper::push_from(&chain, peter)
            .st_crd_lne(bob, usd, Quantity::new(10_000), false)
            .get()?;
        Wrapper::push_from(&chain, peter)
            .st_glb_buy(
                usd,
                Quantity::new(0),
                -(PPM_SCALE as i32) * 5 / 100,
                Quantity::new(u64::MAX),
                never(),
            )
            .get()?;
        Wrapper::push_from(&chain, bob)
            .st_crd_lne(peter, usd, Quantity::new(0), false)
            .get()?;

        // Alice signs the 5% premium she was shown.
        Wrapper::push_from(&chain, alice)
            .sell_claim(
                peter,
                bob,
                usd,
                Quantity::new(10_000),
                Quantity::new(10_500),
            )
            .get()?;

        assert_eq!(exp(&chain, alice, bob, usd), 0);
        assert_eq!(exp(&chain, peter, bob, usd), 10_000);
        assert_eq!(exp(&chain, alice, peter, usd), 10_500);

        Ok(())
    }

    /// Alice signs the 5% haircut she was shown. Peter replaces it with 20%.
    /// The take must not land: she would receive 8_000 for the same face.
    #[psibase::test_case(packages("Banx"))]
    fn test_sell_claim_min_proceeds_rejects_worse_spread(
        chain: psibase::Chain,
    ) -> Result<(), psibase::Error> {
        Wrapper::push(&chain).init().get()?;
        let alice = account!("alice");
        let bob = account!("bob");
        let peter = account!("peter");
        for a in [alice, bob, peter] {
            chain.new_account(a).unwrap();
        }
        let usd = Asset::get_by_symbol_assert(account!("usd")).id;
        Wrapper::push_from(&chain, bob)
            .deposit(alice, usd, Quantity::new(10_000), 0)
            .get()?;
        Wrapper::push_from(&chain, peter)
            .st_crd_lne(bob, usd, Quantity::new(10_000), false)
            .get()?;
        Wrapper::push_from(&chain, bob)
            .st_crd_lne(peter, usd, Quantity::new(0), false)
            .get()?;
        Wrapper::push_from(&chain, peter)
            .st_glb_buy(
                usd,
                Quantity::new(0),
                (PPM_SCALE * 20 / 100) as i32,
                Quantity::new(u64::MAX),
                never(),
            )
            .get()?;

        let taken = Wrapper::push_from(&chain, alice)
            .sell_claim(peter, bob, usd, Quantity::new(10_000), Quantity::new(9_500))
            .get();
        assert!(
            taken.is_err(),
            "worse haircut cleared a signed 9_500 floor, got {taken:?}"
        );
        assert_eq!(exp(&chain, alice, bob, usd), 10_000);
        assert_eq!(exp(&chain, peter, bob, usd), 0);
        assert_eq!(exp(&chain, alice, peter, usd), 0);
        Ok(())
    }

    /// Pippa signs John's 0% ask. He replaces it with a 5% premium. The take
    /// must not land: she would owe 105 for the same 100 face.
    #[psibase::test_case(packages("Banx"))]
    fn test_buy_claim_max_cost_rejects_worse_premium(
        chain: psibase::Chain,
    ) -> Result<(), psibase::Error> {
        Wrapper::push(&chain).init().get()?;
        let alice = account!("alice");
        let bob = account!("bob");
        let peter = account!("peter");
        for a in [alice, bob, peter] {
            chain.new_account(a).unwrap();
        }
        let usd = Asset::get_by_symbol_assert(account!("usd")).id;
        Wrapper::push_from(&chain, bob)
            .deposit(alice, usd, Quantity::new(100), 0)
            .get()?;
        Wrapper::push_from(&chain, peter)
            .st_crd_lne(bob, usd, Quantity::new(100), false)
            .get()?;
        Wrapper::push_from(&chain, bob)
            .st_crd_lne(peter, usd, Quantity::new(0), false)
            .get()?;
        // Positive on a sell post is the seller's profit.
        Wrapper::push_from(&chain, alice)
            .st_glb_sell(
                usd,
                Quantity::new(0),
                (PPM_SCALE * 5 / 100) as i32,
                Quantity::new(u64::MAX),
                never(),
            )
            .get()?;

        let taken = Wrapper::push_from(&chain, peter)
            .buy_claim(alice, bob, usd, Quantity::new(100), Quantity::new(100))
            .get();
        assert!(
            taken.is_err(),
            "worse premium cleared a signed 100 cap, got {taken:?}"
        );
        assert_eq!(exp(&chain, alice, bob, usd), 100);
        assert_eq!(exp(&chain, peter, bob, usd), 0);
        assert_eq!(exp(&chain, alice, peter, usd), 0);
        Ok(())
    }

    #[psibase::test_case(packages("Banx"))]
    fn test_specific_buy_claim_does_not_block_global_forward(
        chain: psibase::Chain,
    ) -> Result<(), psibase::Error> {
        Wrapper::push(&chain).init().get()?;
        let alice = account!("alice");
        let gary = account!("gary");
        let steve = account!("steve");
        for a in [alice, gary, steve] {
            chain.new_account(a).unwrap();
        }
        let usd = Asset::get_by_symbol_assert(account!("usd")).id;
        Wrapper::push_from(&chain, gary)
            .st_crd_lne(alice, usd, Quantity::new(10_000), false)
            .get()?;
        Wrapper::push_from(&chain, steve)
            .st_crd_lne(gary, usd, Quantity::new(10_000), false)
            .get()?;
        // Specific buy-claim must not affect path forward.
        Wrapper::push_from(&chain, gary)
            .st_buy_clm(
                steve,
                usd,
                Quantity::new(0),
                0,
                Quantity::new(u64::MAX),
                never(),
            )
            .get()?;
        Wrapper::push_from(&chain, gary)
            .st_glb_fwd(usd, Quantity::new(0), PPM_SCALE * 2 / 100, never(), true)
            .get()?;

        Wrapper::push_from(&chain, alice)
            .path_pay(
                seal(
                    &chain,
                    alice,
                    vec![hop(gary, usd), hop(steve, usd)],
                    Quantity::new(500),
                ),
                Quantity::new(500),
                Quantity::new(490),
                0,
            )
            .get()?;
        assert_eq!(exp(&chain, steve, gary, usd), 490);
        Ok(())
    }

    #[psibase::test_case(packages("Banx"))]
    fn test_expired_specific_falls_back_to_global(
        chain: psibase::Chain,
    ) -> Result<(), psibase::Error> {
        Wrapper::push(&chain).init().get()?;
        let alice = account!("alice");
        let gary = account!("gary");
        let steve = account!("steve");
        for a in [alice, gary, steve] {
            chain.new_account(a).unwrap();
        }
        let usd = Asset::get_by_symbol_assert(account!("usd")).id;
        Wrapper::push_from(&chain, gary)
            .st_crd_lne(alice, usd, Quantity::new(10_000), false)
            .get()?;
        Wrapper::push_from(&chain, steve)
            .st_crd_lne(gary, usd, Quantity::new(10_000), false)
            .get()?;
        Wrapper::push_from(&chain, gary)
            .st_fwd_ofr(
                steve,
                usd,
                Quantity::new(0),
                0,
                TimePointSec { seconds: 1 },
                true,
            )
            .get()?;
        Wrapper::push_from(&chain, gary)
            .st_glb_fwd(usd, Quantity::new(10), 0, never(), true)
            .get()?;

        Wrapper::push_from(&chain, alice)
            .path_pay(
                seal(
                    &chain,
                    alice,
                    vec![hop(gary, usd), hop(steve, usd)],
                    Quantity::new(100),
                ),
                Quantity::new(100),
                Quantity::new(90),
                0,
            )
            .get()?;
        assert_eq!(exp(&chain, steve, gary, usd), 90);
        Ok(())
    }

    #[psibase::test_case(packages("Banx"))]
    fn test_deplete_on_debit_keeps_limit_cap(chain: psibase::Chain) -> Result<(), psibase::Error> {
        Wrapper::push(&chain).init().get()?;
        let alice = account!("alice");
        let bob = account!("bob");
        chain.new_account(alice).unwrap();
        chain.new_account(bob).unwrap();
        let usd = Asset::get_by_symbol_assert(account!("usd")).id;

        Wrapper::push_from(&chain, bob)
            .st_crd_lne(alice, usd, Quantity::new(100), true)
            .get()?;
        let line = Pair::line(bob, alice, usd).unwrap();
        assert_eq!(line.limit.value, 100);
        assert_eq!(line.remaining.value, 100);

        Wrapper::push_from(&chain, alice)
            .path_pay(
                seal(&chain, alice, vec![hop(bob, usd)], Quantity::new(60)),
                Quantity::new(60),
                Quantity::new(60),
                0,
            )
            .get()?;
        let line = Pair::line(bob, alice, usd).unwrap();
        assert_eq!(line.limit.value, 100);
        assert_eq!(line.remaining.value, 40);
        assert_eq!(exp(&chain, bob, alice, usd), 60);
        assert!(exp(&chain, bob, alice, usd) <= line.limit.value);

        // Remaining is 40, not 40-after-shrunk-cap.
        Wrapper::push_from(&chain, alice)
            .path_pay(
                seal(&chain, alice, vec![hop(bob, usd)], Quantity::new(40)),
                Quantity::new(40),
                Quantity::new(40),
                0,
            )
            .get()?;
        assert_eq!(exp(&chain, bob, alice, usd), 100);
        assert_eq!(Pair::line(bob, alice, usd).unwrap().remaining.value, 0);

        // Repay does not restore remaining.
        Wrapper::push_from(&chain, bob)
            .deposit(alice, usd, Quantity::new(100), 0)
            .get()?;
        assert_eq!(exp(&chain, bob, alice, usd), 0);
        let over = Wrapper::push_from(&chain, alice)
            .path_pay(
                seal(&chain, alice, vec![hop(bob, usd)], Quantity::new(1)),
                Quantity::new(1),
                Quantity::new(1),
                0,
            )
            .get();
        assert!(over.is_err());
        Ok(())
    }

    #[psibase::test_case(packages("Banx"))]
    fn test_sell_claim_consumes_depleting_remaining(
        chain: psibase::Chain,
    ) -> Result<(), psibase::Error> {
        Wrapper::push(&chain).init().get()?;
        let alice = account!("alice");
        let bob = account!("bob");
        let peter = account!("peter");
        for a in [alice, bob, peter] {
            chain.new_account(a).unwrap();
        }
        let usd = Asset::get_by_symbol_assert(account!("usd")).id;
        Wrapper::push_from(&chain, bob)
            .deposit(alice, usd, Quantity::new(50), 0)
            .get()?;
        Wrapper::push_from(&chain, peter)
            .st_crd_lne(bob, usd, Quantity::new(100), true)
            .get()?;
        Wrapper::push_from(&chain, peter)
            .st_glb_buy(usd, Quantity::new(0), 0, Quantity::new(u64::MAX), never())
            .get()?;
        Wrapper::push_from(&chain, bob)
            .st_crd_lne(peter, usd, Quantity::new(0), false)
            .get()?;
        Wrapper::push_from(&chain, alice)
            .sell_claim(peter, bob, usd, Quantity::new(50), Quantity::new(0))
            .get()?;
        let line = Pair::line(peter, bob, usd).unwrap();
        assert_eq!(line.limit.value, 100);
        assert_eq!(line.remaining.value, 50);
        assert_eq!(exp(&chain, peter, bob, usd), 50);
        Ok(())
    }

    /// Claim transfer spends remaining only on `new_draw`,
    /// same as `path_pay` (`new_draw = amount − reverse`).
    ///
    /// Auto-net means a pair is only ever live in one direction, so the
    /// line cap is `capacity` (reverse + headroom). Remaining is the bug if
    /// we `consume_remaining(amount)` for the full face: a standing buy offer
    /// plus a depleting line can be griefed — the seller hits the bid,
    /// the books net to zero against the buyer's existing debt to the
    /// debtor, and remaining still shrinks.
    ///
    /// Books before the take:
    /// - Alice holds 50 on Bob (the claim being sold)
    /// - Peter owes Bob 50 (the reverse claim)
    /// - Peter's depleting line to Bob is 100, remaining still 100
    ///
    /// After a take of 50: pair nets to 0, remaining still 100.
    #[psibase::test_case(packages("Banx"))]
    fn test_sell_claim_remaining_only_new_draw(
        chain: psibase::Chain,
    ) -> Result<(), psibase::Error> {
        Wrapper::push(&chain).init().get()?;
        let alice = account!("alice");
        let bob = account!("bob");
        let peter = account!("peter");
        for a in [alice, bob, peter] {
            chain.new_account(a).unwrap();
        }
        let usd = Asset::get_by_symbol_assert(account!("usd")).id;

        // Alice holds 50 on Bob.
        Wrapper::push_from(&chain, bob)
            .deposit(alice, usd, Quantity::new(50), 0)
            .get()?;
        // Peter owes Bob 50. Same pair, other way: the reverse claim.
        Wrapper::push_from(&chain, peter)
            .deposit(bob, usd, Quantity::new(50), 0)
            .get()?;
        Wrapper::push_from(&chain, peter)
            .st_crd_lne(bob, usd, Quantity::new(100), true)
            .get()?;
        Wrapper::push_from(&chain, peter)
            .st_glb_buy(usd, Quantity::new(0), 0, Quantity::new(u64::MAX), never())
            .get()?;
        // Debtor must know the buyer. Live claims already exist both ways;
        // a 0-limit line is the same consent `path_pay` would use.
        Wrapper::push_from(&chain, bob)
            .st_crd_lne(peter, usd, Quantity::new(0), false)
            .get()?;

        assert_eq!(exp(&chain, alice, bob, usd), 50);
        assert_eq!(exp(&chain, bob, peter, usd), 50);
        assert_eq!(Pair::line(peter, bob, usd).unwrap().remaining.value, 100);

        Wrapper::push_from(&chain, alice)
            .sell_claim(peter, bob, usd, Quantity::new(50), Quantity::new(0))
            .get()?;

        // Wash: Peter's new claim on Bob nets against the 50 he owed.
        assert_eq!(exp(&chain, peter, bob, usd), 0);
        assert_eq!(exp(&chain, bob, peter, usd), 0);
        assert_eq!(exp(&chain, alice, bob, usd), 0);
        // Alice is paid in a claim on Peter (0% spread).
        assert_eq!(exp(&chain, alice, peter, usd), 50);

        let line = Pair::line(peter, bob, usd).unwrap();
        assert_eq!(
            line.remaining.value, 100,
            "face 50 fully unwound the reverse claim, so new_draw is 0 \
             and remaining must stay 100"
        );
        Ok(())
    }

    #[psibase::test_case(packages("Banx"))]
    fn test_sell_claim_requires_debtor_line_to_buyer(
        chain: psibase::Chain,
    ) -> Result<(), psibase::Error> {
        Wrapper::push(&chain).init().get()?;
        let alice = account!("alice");
        let bob = account!("bob");
        let peter = account!("peter");
        for a in [alice, bob, peter] {
            chain.new_account(a).unwrap();
        }
        let usd = Asset::get_by_symbol_assert(account!("usd")).id;
        Wrapper::push_from(&chain, bob)
            .deposit(alice, usd, Quantity::new(1_000), 0)
            .get()?;
        Wrapper::push_from(&chain, peter)
            .st_crd_lne(bob, usd, Quantity::new(10_000), false)
            .get()?;
        Wrapper::push_from(&chain, peter)
            .st_glb_buy(usd, Quantity::new(0), 0, Quantity::new(u64::MAX), never())
            .get()?;

        assert!(Wrapper::push_from(&chain, alice)
            .sell_claim(peter, bob, usd, Quantity::new(1_000), Quantity::new(0))
            .get()
            .is_err());

        Wrapper::push_from(&chain, bob)
            .st_crd_lne(peter, usd, Quantity::new(0), false)
            .get()?;
        Wrapper::push_from(&chain, alice)
            .sell_claim(peter, bob, usd, Quantity::new(1_000), Quantity::new(0))
            .get()?;
        assert_eq!(exp(&chain, peter, bob, usd), 1_000);
        Ok(())
    }

    /// Global buy is the rate. New exposure needs the buyer's line to the
    /// debtor and is capped by that line. Steve cannot dump $2,000 of
    /// Carol onto Peter when Peter's empty line to her is $500.
    #[psibase::test_case(packages("Banx"))]
    fn test_sell_claim_requires_buyer_line_and_caps_size(
        chain: psibase::Chain,
    ) -> Result<(), psibase::Error> {
        Wrapper::push(&chain).init().get()?;
        let peter = account!("peter");
        let steve = account!("steve");
        let carol = account!("carol");
        for a in [peter, steve, carol] {
            chain.new_account(a).unwrap();
        }
        let usd = Asset::get_by_symbol_assert(account!("usd")).id;
        Wrapper::push_from(&chain, carol)
            .deposit(steve, usd, Quantity::new(2_000), 0)
            .get()?;
        Wrapper::push_from(&chain, peter)
            .st_glb_buy(usd, Quantity::new(0), 0, Quantity::new(u64::MAX), never())
            .get()?;
        Wrapper::push_from(&chain, carol)
            .st_crd_lne(peter, usd, Quantity::new(0), false)
            .get()?;

        assert!(
            Wrapper::push_from(&chain, steve)
                .sell_claim(peter, carol, usd, Quantity::new(500), Quantity::new(0))
                .get()
                .is_err(),
            "global buy without a buyer line must not take new exposure"
        );

        Wrapper::push_from(&chain, peter)
            .st_crd_lne(carol, usd, Quantity::new(500), false)
            .get()?;
        assert!(
            Wrapper::push_from(&chain, steve)
                .sell_claim(peter, carol, usd, Quantity::new(2_000), Quantity::new(0))
                .get()
                .is_err(),
            "cannot dump more than the buyer's empty line"
        );
        Wrapper::push_from(&chain, steve)
            .sell_claim(peter, carol, usd, Quantity::new(500), Quantity::new(0))
            .get()?;
        assert_eq!(exp(&chain, peter, carol, usd), 500);
        assert_eq!(exp(&chain, steve, carol, usd), 1_500);
        assert_eq!(exp(&chain, steve, peter, usd), 500);
        Ok(())
    }

    /// Unwind-only take: Peter already owes Carol 500. Steve's 500 claim
    /// nets that away. No new exposure, so no buyer line required.
    #[psibase::test_case(packages("Banx"))]
    fn test_sell_claim_unwind_needs_no_buyer_line(
        chain: psibase::Chain,
    ) -> Result<(), psibase::Error> {
        Wrapper::push(&chain).init().get()?;
        let peter = account!("peter");
        let steve = account!("steve");
        let carol = account!("carol");
        for a in [peter, steve, carol] {
            chain.new_account(a).unwrap();
        }
        let usd = Asset::get_by_symbol_assert(account!("usd")).id;
        Wrapper::push_from(&chain, carol)
            .deposit(steve, usd, Quantity::new(500), 0)
            .get()?;
        Wrapper::push_from(&chain, peter)
            .deposit(carol, usd, Quantity::new(500), 0)
            .get()?;
        Wrapper::push_from(&chain, peter)
            .st_glb_buy(usd, Quantity::new(0), 0, Quantity::new(u64::MAX), never())
            .get()?;

        Wrapper::push_from(&chain, steve)
            .sell_claim(peter, carol, usd, Quantity::new(500), Quantity::new(0))
            .get()?;
        assert_eq!(exp(&chain, peter, carol, usd), 0);
        assert_eq!(exp(&chain, carol, peter, usd), 0);
        assert_eq!(exp(&chain, steve, carol, usd), 0);
        assert_eq!(exp(&chain, steve, peter, usd), 500);
        Ok(())
    }

    /// Mallory cannot become a claim-buyer on Bob by owing Bob dust.
    #[psibase::test_case(packages("Banx"))]
    fn test_sell_claim_dust_deposit_does_not_know_buyer(
        chain: psibase::Chain,
    ) -> Result<(), psibase::Error> {
        Wrapper::push(&chain).init().get()?;
        let alice = account!("alice");
        let bob = account!("bob");
        let mallory = account!("mallory");
        for a in [alice, bob, mallory] {
            chain.new_account(a).unwrap();
        }
        let usd = Asset::get_by_symbol_assert(account!("usd")).id;
        Wrapper::push_from(&chain, bob)
            .deposit(alice, usd, Quantity::new(1_000), 0)
            .get()?;
        Wrapper::push_from(&chain, mallory)
            .st_crd_lne(bob, usd, Quantity::new(10_000), false)
            .get()?;
        Wrapper::push_from(&chain, mallory)
            .st_glb_buy(usd, Quantity::new(0), 0, Quantity::new(u64::MAX), never())
            .get()?;
        Wrapper::push_from(&chain, mallory)
            .deposit(bob, usd, Quantity::new(1), 0)
            .get()?;

        assert!(
            Wrapper::push_from(&chain, alice)
                .sell_claim(mallory, bob, usd, Quantity::new(1_000), Quantity::new(0))
                .get()
                .is_err(),
            "dust deposit must not make bob know mallory as buyer"
        );
        Ok(())
    }

    /// A full-size deposit makes the claim transfer a pure unwind, which
    /// skips the buyer-line check. The proceeds still need Alice's line.
    #[psibase::test_case(packages("Banx"))]
    fn test_buy_claim_full_deposit_needs_seller_line(
        chain: psibase::Chain,
    ) -> Result<(), psibase::Error> {
        Wrapper::push(&chain).init().get()?;
        let alice = account!("alice");
        let bob = account!("bob");
        let mallory = account!("mallory");
        for a in [alice, bob, mallory] {
            chain.new_account(a).unwrap();
        }
        let usd = Asset::get_by_symbol_assert(account!("usd")).id;
        Wrapper::push_from(&chain, bob)
            .deposit(alice, usd, Quantity::new(100), 0)
            .get()?;
        Wrapper::push_from(&chain, alice)
            .st_glb_sell(usd, Quantity::new(0), 0, Quantity::new(u64::MAX), never())
            .get()?;
        Wrapper::push_from(&chain, mallory)
            .deposit(bob, usd, Quantity::new(100), 0)
            .get()?;

        assert!(
            Wrapper::push_from(&chain, mallory)
                .buy_claim(alice, bob, usd, Quantity::new(100), Quantity::new(0))
                .get()
                .is_err(),
            "full unwind must not pay Alice with Mallory's unbacked IOU"
        );
        assert_eq!(exp(&chain, alice, bob, usd), 100);
        assert_eq!(exp(&chain, bob, mallory, usd), 100);
        assert_eq!(exp(&chain, alice, mallory, usd), 0);

        Wrapper::push_from(&chain, alice)
            .st_crd_lne(mallory, usd, Quantity::new(100), false)
            .get()?;
        Wrapper::push_from(&chain, mallory)
            .buy_claim(alice, bob, usd, Quantity::new(100), Quantity::new(0))
            .get()?;
        assert_eq!(exp(&chain, alice, bob, usd), 0);
        assert_eq!(exp(&chain, mallory, bob, usd), 0);
        assert_eq!(exp(&chain, bob, mallory, usd), 0);
        assert_eq!(exp(&chain, alice, mallory, usd), 100);
        Ok(())
    }

    /// The cost is capped by Alice's line to Peter, and what Peter already
    /// owes her counts against it. The debtor side is satisfied throughout,
    /// so only the seller's line can reject.
    #[psibase::test_case(packages("Banx"))]
    fn test_buy_claim_cost_capped_by_seller_line(
        chain: psibase::Chain,
    ) -> Result<(), psibase::Error> {
        Wrapper::push(&chain).init().get()?;
        let alice = account!("alice");
        let bob = account!("bob");
        let peter = account!("peter");
        for a in [alice, bob, peter] {
            chain.new_account(a).unwrap();
        }
        let usd = Asset::get_by_symbol_assert(account!("usd")).id;
        Wrapper::push_from(&chain, bob)
            .deposit(alice, usd, Quantity::new(100), 0)
            .get()?;
        Wrapper::push_from(&chain, peter)
            .st_crd_lne(bob, usd, Quantity::new(100), false)
            .get()?;
        Wrapper::push_from(&chain, bob)
            .st_crd_lne(peter, usd, Quantity::new(0), false)
            .get()?;
        Wrapper::push_from(&chain, alice)
            .st_glb_sell(usd, Quantity::new(0), 0, Quantity::new(u64::MAX), never())
            .get()?;
        Wrapper::push_from(&chain, alice)
            .st_crd_lne(peter, usd, Quantity::new(99), false)
            .get()?;

        assert!(
            Wrapper::push_from(&chain, peter)
                .buy_claim(alice, bob, usd, Quantity::new(100), Quantity::new(0))
                .get()
                .is_err(),
            "a cost of 100 must not clear Alice's 99 line to Peter"
        );
        assert_eq!(exp(&chain, alice, bob, usd), 100);
        assert_eq!(exp(&chain, peter, bob, usd), 0);
        assert_eq!(exp(&chain, alice, peter, usd), 0);

        Wrapper::push_from(&chain, peter)
            .buy_claim(alice, bob, usd, Quantity::new(99), Quantity::new(0))
            .get()?;
        assert_eq!(exp(&chain, alice, bob, usd), 1);
        assert_eq!(exp(&chain, peter, bob, usd), 99);
        assert_eq!(exp(&chain, alice, peter, usd), 99);

        assert!(
            Wrapper::push_from(&chain, peter)
                .buy_claim(alice, bob, usd, Quantity::new(1), Quantity::new(0))
                .get()
                .is_err(),
            "Alice's line to Peter is full"
        );
        assert_eq!(exp(&chain, alice, bob, usd), 1);
        assert_eq!(exp(&chain, alice, peter, usd), 99);
        Ok(())
    }

    /// Alice already owes Peter 100. A cost that only unwinds that debt
    /// needs no line from her. Anything past it does.
    #[psibase::test_case(packages("Banx"))]
    fn test_buy_claim_unwind_needs_no_seller_line(
        chain: psibase::Chain,
    ) -> Result<(), psibase::Error> {
        Wrapper::push(&chain).init().get()?;
        let alice = account!("alice");
        let bob = account!("bob");
        let peter = account!("peter");
        for a in [alice, bob, peter] {
            chain.new_account(a).unwrap();
        }
        let usd = Asset::get_by_symbol_assert(account!("usd")).id;
        Wrapper::push_from(&chain, bob)
            .deposit(alice, usd, Quantity::new(150), 0)
            .get()?;
        Wrapper::push_from(&chain, alice)
            .deposit(peter, usd, Quantity::new(100), 0)
            .get()?;
        Wrapper::push_from(&chain, peter)
            .st_crd_lne(bob, usd, Quantity::new(150), false)
            .get()?;
        Wrapper::push_from(&chain, bob)
            .st_crd_lne(peter, usd, Quantity::new(0), false)
            .get()?;
        Wrapper::push_from(&chain, alice)
            .st_glb_sell(usd, Quantity::new(0), 0, Quantity::new(u64::MAX), never())
            .get()?;

        assert!(
            Wrapper::push_from(&chain, peter)
                .buy_claim(alice, bob, usd, Quantity::new(150), Quantity::new(0))
                .get()
                .is_err(),
            "only 100 of the cost unwinds; the other 50 needs Alice's line"
        );
        assert_eq!(exp(&chain, alice, bob, usd), 150);
        assert_eq!(exp(&chain, peter, bob, usd), 0);
        assert_eq!(exp(&chain, peter, alice, usd), 100);

        Wrapper::push_from(&chain, peter)
            .buy_claim(alice, bob, usd, Quantity::new(100), Quantity::new(0))
            .get()?;
        assert_eq!(exp(&chain, alice, bob, usd), 50);
        assert_eq!(exp(&chain, peter, bob, usd), 100);
        assert_eq!(exp(&chain, peter, alice, usd), 0);
        assert_eq!(exp(&chain, alice, peter, usd), 0);
        Ok(())
    }

    /// Closed global forward: Gary must have lined Steve before Steve can be
    /// introduced as Gary's creditor.
    #[psibase::test_case(packages("Banx"))]
    fn test_closed_forward_requires_line_to_next_hop(
        chain: psibase::Chain,
    ) -> Result<(), psibase::Error> {
        Wrapper::push(&chain).init().get()?;
        let alice = account!("alice");
        let gary = account!("gary");
        let steve = account!("steve");
        for a in [alice, gary, steve] {
            chain.new_account(a).unwrap();
        }
        let usd = Asset::get_by_symbol_assert(account!("usd")).id;
        Wrapper::push_from(&chain, gary)
            .st_crd_lne(alice, usd, Quantity::new(10_000), false)
            .get()?;
        Wrapper::push_from(&chain, steve)
            .st_crd_lne(gary, usd, Quantity::new(10_000), false)
            .get()?;
        Wrapper::push_from(&chain, gary)
            .st_glb_fwd(usd, Quantity::new(0), 0, never(), false)
            .get()?;

        assert!(Wrapper::push_from(&chain, alice)
            .path_pay(
                seal(
                    &chain,
                    alice,
                    vec![hop(gary, usd), hop(steve, usd)],
                    Quantity::new(100)
                ),
                Quantity::new(100),
                Quantity::new(100),
                0,
            )
            .get()
            .is_err());

        Wrapper::push_from(&chain, gary)
            .st_crd_lne(steve, usd, Quantity::new(0), false)
            .get()?;
        Wrapper::push_from(&chain, alice)
            .path_pay(
                seal(
                    &chain,
                    alice,
                    vec![hop(gary, usd), hop(steve, usd)],
                    Quantity::new(100),
                ),
                Quantity::new(100),
                Quantity::new(100),
                0,
            )
            .get()?;
        assert_eq!(exp(&chain, steve, gary, usd), 100);
        Ok(())
    }

    /// Mallory cannot open Alice's closed forward by owing her dust, then
    /// lining her so a path would new_draw.
    #[psibase::test_case(packages("Banx"))]
    fn test_closed_forward_dust_deposit_does_not_know_next_hop(
        chain: psibase::Chain,
    ) -> Result<(), psibase::Error> {
        Wrapper::push(&chain).init().get()?;
        let alice = account!("alice");
        let mallory = account!("mallory");
        let sender = account!("sender");
        for a in [alice, mallory, sender] {
            chain.new_account(a).unwrap();
        }
        let usd = Asset::get_by_symbol_assert(account!("usd")).id;
        Wrapper::push_from(&chain, alice)
            .st_crd_lne(sender, usd, Quantity::new(10_000), false)
            .get()?;
        Wrapper::push_from(&chain, mallory)
            .st_crd_lne(alice, usd, Quantity::new(10_000), false)
            .get()?;
        Wrapper::push_from(&chain, alice)
            .st_glb_fwd(usd, Quantity::new(0), 0, never(), false)
            .get()?;
        Wrapper::push_from(&chain, mallory)
            .deposit(alice, usd, Quantity::new(1), 0)
            .get()?;

        assert!(
            Wrapper::push_from(&chain, sender)
                .path_pay(
                    seal(
                        &chain,
                        sender,
                        vec![hop(alice, usd), hop(mallory, usd)],
                        Quantity::new(100)
                    ),
                    Quantity::new(100),
                    Quantity::new(100),
                    0,
                )
                .get()
                .is_err(),
            "dust + attacker line must not open a closed forward"
        );
        Ok(())
    }

    /// Prepaid reverse claim: cafe owes john, closed forward, hop only
    /// unwinds — no john→cafe line needed.
    #[psibase::test_case(packages("Banx"))]
    fn test_closed_forward_unwind_does_not_need_line(
        chain: psibase::Chain,
    ) -> Result<(), psibase::Error> {
        Wrapper::push(&chain).init().get()?;
        let mitchell = account!("mitchell");
        let john = account!("john");
        let cafe = account!("cafe");
        for a in [mitchell, john, cafe] {
            chain.new_account(a).unwrap();
        }
        let usd = Asset::get_by_symbol_assert(account!("usd")).id;
        Wrapper::push_from(&chain, john)
            .st_crd_lne(mitchell, usd, Quantity::new(1_000_000), false)
            .get()?;
        Wrapper::push_from(&chain, cafe)
            .deposit(john, usd, Quantity::new(100_0000), 0)
            .get()?;
        Wrapper::push_from(&chain, john)
            .st_fwd_ofr(cafe, usd, Quantity::new(0), 0, never(), false)
            .get()?;

        Wrapper::push_from(&chain, mitchell)
            .path_pay(
                seal(
                    &chain,
                    mitchell,
                    vec![hop(john, usd), hop(cafe, usd)],
                    Quantity::new(50_0000),
                ),
                Quantity::new(50_0000),
                Quantity::new(50_0000),
                0,
            )
            .get()?;
        assert_eq!(exp(&chain, john, cafe, usd), 50_0000);
        Ok(())
    }

    /// Specific path-forward can be posted before the next hop knows the
    /// poster; `path_pay` still fails until they line them.
    #[psibase::test_case(packages("Banx"))]
    fn test_specific_forward_may_be_posted_before_next_hop_knows(
        chain: psibase::Chain,
    ) -> Result<(), psibase::Error> {
        Wrapper::push(&chain).init().get()?;
        let alice = account!("alice");
        let gary = account!("gary");
        let steve = account!("steve");
        for a in [alice, gary, steve] {
            chain.new_account(a).unwrap();
        }
        let usd = Asset::get_by_symbol_assert(account!("usd")).id;
        Wrapper::push_from(&chain, gary)
            .st_crd_lne(alice, usd, Quantity::new(10_000), false)
            .get()?;
        Wrapper::push_from(&chain, gary)
            .st_fwd_ofr(steve, usd, Quantity::new(0), 0, never(), true)
            .get()?;

        assert!(Wrapper::push_from(&chain, alice)
            .path_pay(
                seal(
                    &chain,
                    alice,
                    vec![hop(gary, usd), hop(steve, usd)],
                    Quantity::new(100)
                ),
                Quantity::new(100),
                Quantity::new(100),
                0,
            )
            .get()
            .is_err());

        Wrapper::push_from(&chain, steve)
            .st_crd_lne(gary, usd, Quantity::new(10_000), false)
            .get()?;
        Wrapper::push_from(&chain, alice)
            .path_pay(
                seal(
                    &chain,
                    alice,
                    vec![hop(gary, usd), hop(steve, usd)],
                    Quantity::new(100),
                ),
                Quantity::new(100),
                Quantity::new(100),
                0,
            )
            .get()?;
        assert_eq!(exp(&chain, steve, gary, usd), 100);
        Ok(())
    }

    #[psibase::test_case(packages("Banx"))]
    fn test_st_fwd_unk_opens_closed_forward(chain: psibase::Chain) -> Result<(), psibase::Error> {
        Wrapper::push(&chain).init().get()?;
        let alice = account!("alice");
        let gary = account!("gary");
        let steve = account!("steve");
        for a in [alice, gary, steve] {
            chain.new_account(a).unwrap();
        }
        let usd = Asset::get_by_symbol_assert(account!("usd")).id;
        Wrapper::push_from(&chain, gary)
            .st_crd_lne(alice, usd, Quantity::new(10_000), false)
            .get()?;
        Wrapper::push_from(&chain, steve)
            .st_crd_lne(gary, usd, Quantity::new(10_000), false)
            .get()?;
        Wrapper::push_from(&chain, gary)
            .st_glb_fwd(usd, Quantity::new(0), 0, never(), false)
            .get()?;
        assert!(Wrapper::push_from(&chain, alice)
            .path_pay(
                seal(
                    &chain,
                    alice,
                    vec![hop(gary, usd), hop(steve, usd)],
                    Quantity::new(100)
                ),
                Quantity::new(100),
                Quantity::new(100),
                0,
            )
            .get()
            .is_err());

        Wrapper::push_from(&chain, gary)
            .st_fwd_unk(AccountNumber::new(0), usd, true)
            .get()?;
        Wrapper::push_from(&chain, alice)
            .path_pay(
                seal(
                    &chain,
                    alice,
                    vec![hop(gary, usd), hop(steve, usd)],
                    Quantity::new(100),
                ),
                Quantity::new(100),
                Quantity::new(100),
                0,
            )
            .get()?;
        assert_eq!(exp(&chain, steve, gary, usd), 100);
        Ok(())
    }

    /// Re-posting a forward offer applies `allow_unknown` (not insert-only).
    #[psibase::test_case(packages("Banx"))]
    fn test_st_glb_fwd_update_sets_allow_unknown(
        chain: psibase::Chain,
    ) -> Result<(), psibase::Error> {
        Wrapper::push(&chain).init().get()?;
        let alice = account!("alice");
        let gary = account!("gary");
        let steve = account!("steve");
        for a in [alice, gary, steve] {
            chain.new_account(a).unwrap();
        }
        let usd = Asset::get_by_symbol_assert(account!("usd")).id;
        Wrapper::push_from(&chain, gary)
            .st_crd_lne(alice, usd, Quantity::new(10_000), false)
            .get()?;
        Wrapper::push_from(&chain, steve)
            .st_crd_lne(gary, usd, Quantity::new(10_000), false)
            .get()?;
        Wrapper::push_from(&chain, gary)
            .st_glb_fwd(usd, Quantity::new(0), 0, never(), true)
            .get()?;
        Wrapper::push_from(&chain, gary)
            .st_glb_fwd(usd, Quantity::new(0), 0, never(), false)
            .get()?;
        assert!(Wrapper::push_from(&chain, alice)
            .path_pay(
                seal(
                    &chain,
                    alice,
                    vec![hop(gary, usd), hop(steve, usd)],
                    Quantity::new(100)
                ),
                Quantity::new(100),
                Quantity::new(100),
                0,
            )
            .get()
            .is_err());

        Wrapper::push_from(&chain, gary)
            .st_glb_fwd(usd, Quantity::new(0), 0, never(), true)
            .get()?;
        Wrapper::push_from(&chain, alice)
            .path_pay(
                seal(
                    &chain,
                    alice,
                    vec![hop(gary, usd), hop(steve, usd)],
                    Quantity::new(100),
                ),
                Quantity::new(100),
                Quantity::new(100),
                0,
            )
            .get()?;
        assert_eq!(exp(&chain, steve, gary, usd), 100);
        Ok(())
    }

    #[psibase::test_case(packages("Banx"))]
    fn test_rm_crd_lne_blocks_sell_and_erases_row(
        chain: psibase::Chain,
    ) -> Result<(), psibase::Error> {
        Wrapper::push(&chain).init().get()?;
        let alice = account!("alice");
        let bob = account!("bob");
        let peter = account!("peter");
        for a in [alice, bob, peter] {
            chain.new_account(a).unwrap();
        }
        let usd = Asset::get_by_symbol_assert(account!("usd")).id;
        Wrapper::push_from(&chain, bob)
            .deposit(alice, usd, Quantity::new(1_000), 0)
            .get()?;
        Wrapper::push_from(&chain, peter)
            .st_crd_lne(bob, usd, Quantity::new(10_000), false)
            .get()?;
        Wrapper::push_from(&chain, peter)
            .st_glb_buy(usd, Quantity::new(0), 0, Quantity::new(u64::MAX), never())
            .get()?;
        Wrapper::push_from(&chain, bob)
            .st_crd_lne(peter, usd, Quantity::new(0), false)
            .get()?;
        assert!(Pair::line(bob, peter, usd).is_some());

        Wrapper::push_from(&chain, bob)
            .rm_crd_lne(peter, usd)
            .get()?;
        assert!(Pair::line(bob, peter, usd).is_none());
        assert!(Wrapper::push_from(&chain, alice)
            .sell_claim(peter, bob, usd, Quantity::new(1_000), Quantity::new(0))
            .get()
            .is_err());
        assert_eq!(exp(&chain, alice, bob, usd), 1_000);
        Ok(())
    }

    /// John takes 12 weetbix and 80.0g of coffee. Isabelle's later 3 weetbix
    /// net his biscuit claim to 9. The coffee claim stays.
    #[psibase::test_case(packages("Banx"))]
    fn test_pantry_open_biscuits_and_debtor_priced_coffee(
        chain: psibase::Chain,
    ) -> Result<(), psibase::Error> {
        Wrapper::push(&chain).init().get()?;
        let john = account!("john");
        let isabelle = account!("isabelle");
        chain.new_account(john).unwrap();
        chain.new_account(isabelle).unwrap();

        let weetbix = Asset::get_by_symbol_assert(account!("weetbix")).id;
        // Precision 1: 80.0g is 800 raw units.
        let coffee = Wrapper::push_from(&chain, john)
            .add_asset(
                account!("coffee"),
                Precision::new(1).unwrap(),
                "0.1g of beans".into(),
            )
            .get()?;

        Wrapper::push_from(&chain, john)
            .deposit(isabelle, weetbix, Quantity::new(12), 0)
            .get()?;
        Wrapper::push_from(&chain, john)
            .deposit(isabelle, coffee, Quantity::new(800), 0)
            .get()?;
        assert_eq!(exp(&chain, isabelle, john, weetbix), 12);
        assert_eq!(exp(&chain, isabelle, john, coffee), 800);

        Wrapper::push_from(&chain, isabelle)
            .deposit(john, weetbix, Quantity::new(3), 0)
            .get()?;
        assert_eq!(exp(&chain, isabelle, john, weetbix), 9);
        assert_eq!(exp(&chain, john, isabelle, weetbix), 0);
        assert_eq!(exp(&chain, isabelle, john, coffee), 800);
        Ok(())
    }

    /// Michelle left 100.0g of merlo at Isabelle's. John takes it. He has no
    /// line to Michelle, so the draw goes through Isabelle: he owes her the
    /// beans, and her AUD line to her mum carries the $5.00 on.
    #[psibase::test_case(packages("Banx"))]
    fn test_merlo_debt_reaches_michelle_through_isabelle(
        chain: psibase::Chain,
    ) -> Result<(), psibase::Error> {
        Wrapper::push(&chain).init().get()?;
        let john = account!("john");
        let isabelle = account!("isabelle");
        let michelle = account!("michelle");
        for a in [john, isabelle, michelle] {
            chain.new_account(a).unwrap();
        }

        let merlo = Wrapper::push_from(&chain, isabelle)
            .add_asset(
                account!("merlo"),
                Precision::new(1).unwrap(),
                "special beans, 0.1g".into(),
            )
            .get()?;
        let aud = Asset::get_by_symbol_assert(account!("aud")).id;
        let grams = Quantity::new(1_000);
        let dollars = Quantity::new(50_000);

        // Mum will let Isabelle owe AUD. Isabelle will let John owe the beans
        // and will price them onto that AUD line.
        Wrapper::push_from(&chain, michelle)
            .st_crd_lne(isabelle, aud, dollars, false)
            .get()?;
        Wrapper::push_from(&chain, isabelle)
            .st_crd_lne(john, merlo, grams, false)
            .get()?;
        Wrapper::push_from(&chain, isabelle)
            .st_fx_ofr(
                merlo,
                aud,
                true,
                Quantity::new(0),
                RATE_SCALE * 50,
                grams,
                never(),
            )
            .get()?;
        Wrapper::push_from(&chain, isabelle)
            .st_fwd_ofr(michelle, aud, Quantity::new(0), 0, never(), true)
            .get()?;

        let direct = Wrapper::push_from(&chain, john)
            .path_pay(
                seal(&chain, john, vec![hop(michelle, aud)], dollars),
                dollars,
                dollars,
                0,
            )
            .get();
        assert!(
            direct.is_err(),
            "john has no line to michelle; isabelle has to sit in the middle"
        );
        assert_eq!(exp(&chain, michelle, john, aud), 0);
        assert_eq!(exp(&chain, isabelle, john, merlo), 0);

        Wrapper::push_from(&chain, john)
            .path_pay(
                seal(
                    &chain,
                    john,
                    vec![hop(isabelle, merlo), hop(michelle, aud)],
                    grams,
                ),
                grams,
                dollars,
                0,
            )
            .get()?;
        assert_eq!(exp(&chain, isabelle, john, merlo), grams.value);
        assert_eq!(exp(&chain, michelle, isabelle, aud), dollars.value);
        assert_eq!(exp(&chain, michelle, john, aud), 0);
        assert_eq!(exp(&chain, michelle, john, merlo), 0);
        assert_eq!(exp(&chain, isabelle, john, aud), 0);
        assert_eq!(exp(&chain, michelle, isabelle, merlo), 0);
        assert!(FxOffer::get(isabelle, merlo, aud, true).is_none());
        Ok(())
    }

    /// John ate 10 of Michelle's Weet-Bix. He pays her back in biscuits.
    ///
    /// Isabelle lines John, and Michelle lines Isabelle, both in weetbix.
    /// The path stays in weetbix, so Michelle is owed biscuits by Isabelle
    /// and John is owed nothing. Michelle's $0.10 quote is not on that
    /// path. A return to John in AUD would be Isabelle's trade, and she has
    /// not posted one. Isabelle is the debtor of the biscuit claim, so she
    /// is the one who can take Michelle's quote. Ten biscuits become $1.00.
    #[psibase::test_case(packages("Banx"))]
    fn test_john_repays_michelle_weetbix_through_isabelle(
        chain: psibase::Chain,
    ) -> Result<(), psibase::Error> {
        Wrapper::push(&chain).init().get()?;
        let john = account!("john");
        let isabelle = account!("isabelle");
        let michelle = account!("michelle");
        for a in [john, isabelle, michelle] {
            chain.new_account(a).unwrap();
        }
        let weetbix = Asset::get_by_symbol_assert(account!("weetbix")).id;
        let aud = Asset::get_by_symbol_assert(account!("aud")).id;
        assert_eq!(Asset::get_assert(weetbix).precision.value(), 0);
        // Precision 0 biscuit, precision 4 dollars. $0.10 is 1_000 raw.
        const BISCUITS: u64 = 10;
        const DOLLARS: u64 = 10_000;
        let rate = RATE_SCALE * 1_000;

        Wrapper::push_from(&chain, isabelle)
            .st_crd_lne(john, weetbix, Quantity::new(BISCUITS), false)
            .get()?;
        Wrapper::push_from(&chain, michelle)
            .st_crd_lne(isabelle, weetbix, Quantity::new(BISCUITS), false)
            .get()?;
        Wrapper::push_from(&chain, isabelle)
            .st_glb_fwd(weetbix, Quantity::new(0), 0, never(), true)
            .get()?;
        Wrapper::push_from(&chain, michelle)
            .st_fx_ofr(
                weetbix,
                aud,
                true,
                Quantity::new(0),
                rate,
                Quantity::new(BISCUITS),
                never(),
            )
            .get()?;

        let trade = Wrapper::push_from(&chain, john)
            .path_pay(
                seal(
                    &chain,
                    john,
                    vec![hop(isabelle, weetbix), hop(john, aud)],
                    Quantity::new(BISCUITS),
                ),
                Quantity::new(BISCUITS),
                Quantity::new(DOLLARS),
                0,
            )
            .get()
            .expect_err("a return to John would need Isabelle's rate");
        assert!(trade.to_string().contains("FxOffer not found"), "{trade}");
        assert_eq!(exp(&chain, isabelle, john, weetbix), 0);
        assert_eq!(exp(&chain, michelle, isabelle, weetbix), 0);

        Wrapper::push_from(&chain, john)
            .path_pay(
                seal(
                    &chain,
                    john,
                    vec![hop(isabelle, weetbix), hop(michelle, weetbix)],
                    Quantity::new(BISCUITS),
                ),
                Quantity::new(BISCUITS),
                Quantity::new(BISCUITS),
                0,
            )
            .get()?;
        assert_eq!(exp(&chain, isabelle, john, weetbix), BISCUITS);
        assert_eq!(exp(&chain, michelle, isabelle, weetbix), BISCUITS);
        assert_eq!(exp(&chain, michelle, john, weetbix), 0);
        assert_eq!(exp(&chain, michelle, isabelle, aud), 0);
        assert_eq!(exp(&chain, john, isabelle, aud), 0);
        assert_eq!(
            FxOffer::get(michelle, weetbix, aud, true)
                .unwrap()
                .remaining
                .value,
            BISCUITS
        );

        let john_converts = Wrapper::push_from(&chain, john)
            .convert(
                michelle,
                weetbix,
                aud,
                Quantity::new(BISCUITS),
                Quantity::new(DOLLARS),
            )
            .get()
            .expect_err("John does not owe Michelle the biscuits");
        assert!(
            john_converts
                .to_string()
                .contains("nothing to convert in from_asset"),
            "{john_converts}"
        );

        Wrapper::push_from(&chain, isabelle)
            .convert(
                michelle,
                weetbix,
                aud,
                Quantity::new(BISCUITS),
                Quantity::new(DOLLARS),
            )
            .get()?;
        assert_eq!(exp(&chain, isabelle, john, weetbix), BISCUITS);
        assert_eq!(exp(&chain, michelle, isabelle, weetbix), 0);
        assert_eq!(exp(&chain, michelle, isabelle, aud), DOLLARS);
        assert_eq!(exp(&chain, isabelle, michelle, aud), 0);
        assert_eq!(exp(&chain, michelle, john, aud), 0);
        assert!(FxOffer::get(michelle, weetbix, aud, true).is_none());
        Ok(())
    }

    /// John ate 6 Weet-Bix and charged the car 12 kWh at Michelle's.
    /// Both path-pays stay in the consumed asset and stop on Michelle,
    /// so Isabelle is the debtor of both claims. Isabelle then books
    /// the 4 kWh she owes John, which nets his charge down to 8 kWh.
    /// That book does not touch what she still owes her mum.
    ///
    /// Michelle's kWh→AUD buy is a rebook of the from-asset the taker
    /// still owes her. John does not owe her kWh, so he cannot take it.
    /// Isabelle does. 12 kWh at $0.30 become $3.60 of AUD she owes mum.
    /// John still owes Isabelle the leftover 8 kWh. The biscuits stay
    /// where the path left them.
    #[psibase::test_case(packages("Banx"))]
    fn test_isabelle_trades_mums_kwh_john_keeps_his(
        chain: psibase::Chain,
    ) -> Result<(), psibase::Error> {
        Wrapper::push(&chain).init().get()?;
        let john = account!("john");
        let isabelle = account!("isabelle");
        let michelle = account!("michelle");
        for a in [john, isabelle, michelle] {
            chain.new_account(a).unwrap();
        }
        let weetbix = Asset::get_by_symbol_assert(account!("weetbix")).id;
        let kwh = Asset::get_by_symbol_assert(account!("kwh")).id;
        let aud = Asset::get_by_symbol_assert(account!("aud")).id;
        assert_eq!(Asset::get_assert(weetbix).precision.value(), 0);
        assert_eq!(Asset::get_assert(kwh).precision.value(), 3);
        assert_eq!(Asset::get_assert(aud).precision.value(), 4);

        // kWh is precision 3, AUD is precision 4. $0.30 is 3_000 raw per 1_000 raw kWh.
        const BISCUITS: u64 = 6;
        const KWH: u64 = 1_000;
        const CHARGE: u64 = 12 * KWH;
        const ISABELLE_OWES_JOHN: u64 = 4 * KWH;
        const JOHN_KEEPS: u64 = 8 * KWH;
        const AUD_PER_KWH: u64 = 3_000;
        let rate = AUD_PER_KWH * RATE_SCALE / KWH;
        let quoted_aud = AUD_PER_KWH * 12;

        Wrapper::push_from(&chain, isabelle)
            .st_crd_lne(john, weetbix, Quantity::new(BISCUITS), false)
            .get()?;
        Wrapper::push_from(&chain, michelle)
            .st_crd_lne(isabelle, weetbix, Quantity::new(BISCUITS), false)
            .get()?;
        Wrapper::push_from(&chain, isabelle)
            .st_crd_lne(john, kwh, Quantity::new(CHARGE), false)
            .get()?;
        Wrapper::push_from(&chain, michelle)
            .st_crd_lne(isabelle, kwh, Quantity::new(CHARGE), false)
            .get()?;
        Wrapper::push_from(&chain, isabelle)
            .st_glb_fwd(weetbix, Quantity::new(0), 0, never(), true)
            .get()?;
        Wrapper::push_from(&chain, isabelle)
            .st_glb_fwd(kwh, Quantity::new(0), 0, never(), true)
            .get()?;

        Wrapper::push_from(&chain, john)
            .path_pay(
                seal(
                    &chain,
                    john,
                    vec![hop(isabelle, weetbix), hop(michelle, weetbix)],
                    Quantity::new(BISCUITS),
                ),
                Quantity::new(BISCUITS),
                Quantity::new(BISCUITS),
                0,
            )
            .get()?;
        Wrapper::push_from(&chain, john)
            .path_pay(
                seal(
                    &chain,
                    john,
                    vec![hop(isabelle, kwh), hop(michelle, kwh)],
                    Quantity::new(CHARGE),
                ),
                Quantity::new(CHARGE),
                Quantity::new(CHARGE),
                0,
            )
            .get()?;
        assert_eq!(exp(&chain, isabelle, john, weetbix), BISCUITS);
        assert_eq!(exp(&chain, michelle, isabelle, weetbix), BISCUITS);
        assert_eq!(exp(&chain, isabelle, john, kwh), CHARGE);
        assert_eq!(exp(&chain, michelle, isabelle, kwh), CHARGE);
        assert_eq!(exp(&chain, michelle, john, kwh), 0);
        assert_eq!(exp(&chain, michelle, john, weetbix), 0);

        // Isabelle owes John 4 kWh. Debtor-signed, so it nets his claim to 8.
        Wrapper::push_from(&chain, isabelle)
            .deposit(john, kwh, Quantity::new(ISABELLE_OWES_JOHN), 0)
            .get()?;
        assert_eq!(exp(&chain, isabelle, john, kwh), JOHN_KEEPS);
        assert_eq!(exp(&chain, john, isabelle, kwh), 0);
        assert_eq!(exp(&chain, michelle, isabelle, kwh), CHARGE);

        Wrapper::push_from(&chain, michelle)
            .st_fx_ofr(
                kwh,
                aud,
                true,
                Quantity::new(0),
                rate,
                Quantity::new(CHARGE),
                never(),
            )
            .get()?;

        let john_takes = Wrapper::push_from(&chain, john)
            .take_fx(
                michelle,
                kwh,
                aud,
                true,
                Quantity::new(CHARGE),
                quoted_aud as i64,
            )
            .get()
            .expect_err("John does not owe Michelle the kWh");
        // A buy with no existing debt opens both legs. John has no AUD line
        // to Michelle, so the from-leg cannot book.
        assert!(
            john_takes
                .to_string()
                .contains("insufficient path capacity (line + reverse claim)"),
            "{john_takes}"
        );
        let john_converts = Wrapper::push_from(&chain, john)
            .convert(
                michelle,
                kwh,
                aud,
                Quantity::new(CHARGE),
                Quantity::new(quoted_aud),
            )
            .get()
            .expect_err("John does not owe Michelle the kWh");
        assert!(
            john_converts
                .to_string()
                .contains("nothing to convert in from_asset"),
            "{john_converts}"
        );
        assert_eq!(exp(&chain, isabelle, john, kwh), JOHN_KEEPS);
        assert_eq!(exp(&chain, michelle, isabelle, kwh), CHARGE);
        assert_eq!(exp(&chain, michelle, john, aud), 0);
        assert_eq!(exp(&chain, michelle, john, kwh), 0);
        assert_eq!(
            FxOffer::get(michelle, kwh, aud, true)
                .unwrap()
                .remaining
                .value,
            CHARGE
        );

        // The whole click is debt she owes, so the bound is a cap.
        Wrapper::push_from(&chain, isabelle)
            .take_fx(
                michelle,
                kwh,
                aud,
                true,
                Quantity::new(CHARGE),
                -(quoted_aud as i64),
            )
            .get()?;
        assert_eq!(exp(&chain, michelle, isabelle, kwh), 0);
        assert_eq!(exp(&chain, michelle, isabelle, aud), quoted_aud);
        assert_eq!(exp(&chain, isabelle, michelle, aud), 0);
        assert_eq!(exp(&chain, isabelle, john, kwh), JOHN_KEEPS);
        assert_eq!(exp(&chain, john, isabelle, kwh), 0);
        assert_eq!(exp(&chain, michelle, john, kwh), 0);
        assert_eq!(exp(&chain, michelle, john, aud), 0);
        assert_eq!(exp(&chain, isabelle, john, weetbix), BISCUITS);
        assert_eq!(exp(&chain, michelle, isabelle, weetbix), BISCUITS);
        assert!(FxOffer::get(michelle, kwh, aud, true).is_none());
        Ok(())
    }

    /// John likes Michelle's $0.30 and wants the dollars back through Isabelle.
    ///
    /// The kWh lines are 50, not the 12 already drawn by the visit. Michelle
    /// forwards AUD to Isabelle, Isabelle has lined her $100, Isabelle forwards
    /// AUD to John, and John has lined her $100. Isabelle also forwards the
    /// kWh on to mum, which the same-asset hop needs.
    ///
    /// The path draws new claims. It does not rebook anything John already
    /// owes, and it does not make him owe Michelle the kWh. 20 kWh becomes
    /// $6.00 of AUD that lands on him, with Isabelle holding both middle books.
    #[psibase::test_case(packages("Banx"))]
    fn test_john_borrows_mums_kwh_rate_back_through_isabelle(
        chain: psibase::Chain,
    ) -> Result<(), psibase::Error> {
        Wrapper::push(&chain).init().get()?;
        let john = account!("john");
        let isabelle = account!("isabelle");
        let michelle = account!("michelle");
        for a in [john, isabelle, michelle] {
            chain.new_account(a).unwrap();
        }
        let kwh = Asset::get_by_symbol_assert(account!("kwh")).id;
        let aud = Asset::get_by_symbol_assert(account!("aud")).id;

        // kWh precision 3, AUD precision 4. $0.30 is 3_000 raw per 1_000 raw kWh.
        // $100 is 1_000_000 raw.
        const KWH: u64 = 1_000;
        const LINE: u64 = 50 * KWH;
        const TRADE: u64 = 20 * KWH;
        const AUD_LINE: u64 = 1_000_000;
        const AUD_PER_KWH: u64 = 3_000;
        let rate = AUD_PER_KWH * RATE_SCALE / KWH;
        let quoted_aud = AUD_PER_KWH * 20;

        Wrapper::push_from(&chain, isabelle)
            .st_crd_lne(john, kwh, Quantity::new(LINE), false)
            .get()?;
        Wrapper::push_from(&chain, michelle)
            .st_crd_lne(isabelle, kwh, Quantity::new(LINE), false)
            .get()?;
        Wrapper::push_from(&chain, isabelle)
            .st_crd_lne(michelle, aud, Quantity::new(AUD_LINE), false)
            .get()?;
        Wrapper::push_from(&chain, john)
            .st_crd_lne(isabelle, aud, Quantity::new(AUD_LINE), false)
            .get()?;
        Wrapper::push_from(&chain, isabelle)
            .st_fwd_ofr(michelle, kwh, Quantity::new(0), 0, never(), true)
            .get()?;
        Wrapper::push_from(&chain, michelle)
            .st_fwd_ofr(isabelle, aud, Quantity::new(0), 0, never(), true)
            .get()?;
        Wrapper::push_from(&chain, isabelle)
            .st_fwd_ofr(john, aud, Quantity::new(0), 0, never(), true)
            .get()?;
        Wrapper::push_from(&chain, michelle)
            .st_fx_ofr(
                kwh,
                aud,
                true,
                Quantity::new(0),
                rate,
                Quantity::new(LINE),
                never(),
            )
            .get()?;

        // Her rate is not a take he can sign. He does not owe her kWh, and she
        // has not lined him, so opening both legs has no from-asset capacity.
        let john_takes = Wrapper::push_from(&chain, john)
            .take_fx(
                michelle,
                kwh,
                aud,
                true,
                Quantity::new(TRADE),
                quoted_aud as i64,
            )
            .get()
            .expect_err("the buy is a rebook of debt John does not owe");
        assert!(
            john_takes
                .to_string()
                .contains("insufficient path capacity (line + reverse claim)"),
            "{john_takes}"
        );

        Wrapper::push_from(&chain, john)
            .path_pay(
                seal(
                    &chain,
                    john,
                    vec![
                        hop(isabelle, kwh),
                        hop(michelle, kwh),
                        hop(isabelle, aud),
                        hop(john, aud),
                    ],
                    Quantity::new(TRADE),
                ),
                Quantity::new(TRADE),
                Quantity::new(quoted_aud),
                0,
            )
            .get()?;

        assert_eq!(exp(&chain, isabelle, john, kwh), TRADE);
        assert_eq!(exp(&chain, michelle, isabelle, kwh), TRADE);
        assert_eq!(exp(&chain, isabelle, michelle, aud), quoted_aud);
        assert_eq!(exp(&chain, john, isabelle, aud), quoted_aud);
        assert_eq!(exp(&chain, michelle, john, kwh), 0);
        assert_eq!(exp(&chain, michelle, john, aud), 0);
        assert_eq!(exp(&chain, michelle, isabelle, aud), 0);
        assert_eq!(exp(&chain, john, isabelle, kwh), 0);
        assert_eq!(
            FxOffer::get(michelle, kwh, aud, true)
                .unwrap()
                .remaining
                .value,
            LINE - TRADE
        );
        Ok(())
    }

    #[psibase::test_case(packages("Banx"))]
    fn test_path_pay_fx_after_full_reverse_net(
        chain: psibase::Chain,
    ) -> Result<(), psibase::Error> {
        Wrapper::push(&chain).init().get()?;
        let alice = account!("alice");
        let gary = account!("gary");
        let steve = account!("steve");
        for a in [alice, gary, steve] {
            chain.new_account(a).unwrap();
        }
        let aud = Asset::get_by_symbol_assert(account!("aud")).id;
        let usd = Asset::get_by_symbol_assert(account!("usd")).id;
        Wrapper::push_from(&chain, gary)
            .st_crd_lne(alice, aud, Quantity::new(10_000), false)
            .get()?;
        Wrapper::push_from(&chain, steve)
            .st_crd_lne(gary, usd, Quantity::new(10_000), false)
            .get()?;
        Wrapper::push_from(&chain, gary)
            .st_fx_ofr(
                aud,
                usd,
                true,
                Quantity::new(0),
                RATE_SCALE * 70 / 100,
                Quantity::new(u64::MAX),
                never(),
            )
            .get()?;
        Wrapper::push_from(&chain, gary)
            .st_glb_fwd(usd, Quantity::new(0), 0, never(), true)
            .get()?;
        // Reverse AUD book: Gary owes Alice 1000. Hop-0 debit nets it away.
        Wrapper::push_from(&chain, gary)
            .deposit(alice, aud, Quantity::new(1_000), 0)
            .get()?;

        Wrapper::push_from(&chain, alice)
            .path_pay(
                seal(
                    &chain,
                    alice,
                    vec![hop(gary, aud), hop(steve, usd)],
                    Quantity::new(1_000),
                ),
                Quantity::new(1_000),
                Quantity::new(700),
                0,
            )
            .get()?;
        // Full unwind: Alice–Gary AUD clears; hop notional still FX'd to Steve.
        assert_eq!(exp(&chain, alice, gary, aud), 0);
        assert_eq!(exp(&chain, gary, alice, aud), 0);
        assert_eq!(exp(&chain, gary, alice, usd), 0);
        assert_eq!(exp(&chain, steve, gary, usd), 700);
        Ok(())
    }

    /// Alice pays Steve 1_000 AUD through Gary. Gary's fee is 100 and his
    /// rate is 0.70, so he is owed the full 1_000 and owes Steve 630.
    /// A debtor-side row at 0.50 must not be the one that prices the hop.
    #[psibase::test_case(packages("Banx"))]
    fn test_fx_quote_path_fee_comes_off_what_is_owed_onward(
        chain: psibase::Chain,
    ) -> Result<(), psibase::Error> {
        Wrapper::push(&chain).init().get()?;
        let alice = account!("alice");
        let gary = account!("gary");
        let steve = account!("steve");
        for a in [alice, gary, steve] {
            chain.new_account(a).unwrap();
        }
        let aud = Asset::get_by_symbol_assert(account!("aud")).id;
        let usd = Asset::get_by_symbol_assert(account!("usd")).id;
        Wrapper::push_from(&chain, gary)
            .st_crd_lne(alice, aud, Quantity::new(10_000), false)
            .get()?;
        Wrapper::push_from(&chain, steve)
            .st_crd_lne(gary, usd, Quantity::new(10_000), false)
            .get()?;
        Wrapper::push_from(&chain, gary)
            .st_glb_fwd(usd, Quantity::new(0), 0, never(), true)
            .get()?;

        // Fee equal to the send. The hop prices nothing, and the books stay put.
        Wrapper::push_from(&chain, gary)
            .st_fx_ofr(
                aud,
                usd,
                true,
                Quantity::new(1_000),
                RATE_SCALE * 70 / 100,
                Quantity::new(1_000),
                never(),
            )
            .get()?;
        Wrapper::push_from(&chain, gary)
            .st_fx_ofr(
                aud,
                usd,
                false,
                Quantity::new(0),
                RATE_SCALE * 50 / 100,
                Quantity::new(9_000),
                never(),
            )
            .get()?;
        let consumed = Wrapper::push_from(&chain, alice).path_pay(
            seal(
                &chain,
                alice,
                vec![hop(gary, aud), hop(steve, usd)],
                Quantity::new(1_000),
            ),
            Quantity::new(1_000),
            Quantity::new(0),
            0,
        );
        let err = consumed
            .trace
            .error
            .as_deref()
            .unwrap_or("(no error — path_pay succeeded)");
        assert!(err.contains("fixed fee consumes entire amount"), "{err}");
        assert_eq!(exp(&chain, gary, alice, aud), 0);
        assert_eq!(exp(&chain, steve, gary, usd), 0);
        assert_eq!(
            FxOffer::get(gary, aud, usd, true).unwrap().remaining.value,
            1_000
        );

        Wrapper::push_from(&chain, gary)
            .st_fx_ofr(
                aud,
                usd,
                true,
                Quantity::new(100),
                RATE_SCALE * 70 / 100,
                Quantity::new(1_000),
                never(),
            )
            .get()?;

        // (1000 − 100) × 0.70 = 630. Asking for 700 must fail and leave the budget.
        let short = Wrapper::push_from(&chain, alice).path_pay(
            seal(
                &chain,
                alice,
                vec![hop(gary, aud), hop(steve, usd)],
                Quantity::new(1_000),
            ),
            Quantity::new(1_000),
            Quantity::new(700),
            0,
        );
        let err = short
            .trace
            .error
            .as_deref()
            .unwrap_or("(no error — path_pay succeeded)");
        assert!(
            err.contains("path_pay final amount below min_return"),
            "{err}"
        );
        assert_eq!(exp(&chain, gary, alice, aud), 0);
        assert_eq!(exp(&chain, steve, gary, usd), 0);
        assert_eq!(
            FxOffer::get(gary, aud, usd, true).unwrap().remaining.value,
            1_000
        );

        Wrapper::push_from(&chain, alice)
            .path_pay(
                seal(
                    &chain,
                    alice,
                    vec![hop(gary, aud), hop(steve, usd)],
                    Quantity::new(1_000),
                ),
                Quantity::new(1_000),
                Quantity::new(630),
                0,
            )
            .get()?;
        assert_eq!(exp(&chain, gary, alice, aud), 1_000);
        assert_eq!(exp(&chain, steve, gary, usd), 630);
        assert_eq!(exp(&chain, gary, alice, usd), 0);
        assert!(
            FxOffer::get(gary, aud, usd, true).is_none(),
            "the budget falls by the incoming 1_000, not by 1_000 − fee"
        );
        assert_eq!(
            FxOffer::get(gary, aud, usd, false).unwrap().remaining.value,
            9_000,
            "the debtor-side row is not the path rate"
        );
        assert_eq!(
            FxOffer::get(gary, aud, usd, false).unwrap().fx_rate,
            RATE_SCALE * 50 / 100
        );

        Ok(())
    }

    /// A debtor-side quote is not a path rate.
    /// fxOffers still lists it. Removing the creditor row makes
    /// the path fail again while the debtor row remains.
    #[psibase::test_case(packages("Banx"))]
    fn test_fx_quote_path_ignores_debtor_side(chain: psibase::Chain) -> Result<(), psibase::Error> {
        Wrapper::push(&chain).init().get()?;
        let alice = account!("alice");
        let gary = account!("gary");
        let steve = account!("steve");
        for a in [alice, gary, steve] {
            chain.new_account(a).unwrap();
        }
        let aud = Asset::get_by_symbol_assert(account!("aud")).id;
        let usd = Asset::get_by_symbol_assert(account!("usd")).id;
        Wrapper::push_from(&chain, gary)
            .st_crd_lne(alice, aud, Quantity::new(10_000), false)
            .get()?;
        Wrapper::push_from(&chain, steve)
            .st_crd_lne(gary, usd, Quantity::new(10_000), false)
            .get()?;
        Wrapper::push_from(&chain, gary)
            .st_glb_fwd(usd, Quantity::new(0), 0, never(), true)
            .get()?;
        Wrapper::push_from(&chain, gary)
            .st_fx_ofr(
                aud,
                usd,
                false,
                Quantity::new(0),
                RATE_SCALE * 50 / 100,
                Quantity::new(5_000),
                never(),
            )
            .get()?;

        fn gary_sides(raw: &serde_json::Value, key: &str, aud: u16, usd: u16) -> Vec<bool> {
            let list = raw
                .pointer(key)
                .and_then(|v| v.as_array())
                .unwrap_or_else(|| panic!("no {key} in {raw}"));
            let mut sides: Vec<bool> = list
                .iter()
                .filter(|row| {
                    row.get("poster").and_then(|v| v.as_str()) == Some("gary")
                        && row.get("fromAsset").and_then(|v| v.as_u64()) == Some(aud as u64)
                        && row.get("toAsset").and_then(|v| v.as_u64()) == Some(usd as u64)
                })
                .map(|row| {
                    row.get("posterIsCreditor")
                        .and_then(|v| v.as_bool())
                        .unwrap_or_else(|| panic!("posterIsCreditor in {raw}"))
                })
                .collect();
            sides.sort();
            sides
        }
        let policies_q = r#"{ fxOffers(poster: "gary") {
            poster fromAsset toAsset posterIsCreditor
        } }"#;
        let listed = banx_gql(&chain, policies_q)?;
        assert_eq!(
            gary_sides(&listed, "/data/fxOffers", aud, usd),
            vec![false],
            "{listed}"
        );

        let debtor_only = Wrapper::push_from(&chain, alice).path_pay(
            seal(
                &chain,
                alice,
                vec![hop(gary, aud), hop(steve, usd)],
                Quantity::new(1_000),
            ),
            Quantity::new(1_000),
            Quantity::new(0),
            0,
        );
        let err = debtor_only
            .trace
            .error
            .as_deref()
            .unwrap_or("(no error — path_pay succeeded)");
        assert!(err.contains("FxOffer not found"), "{err}");
        assert_eq!(exp(&chain, gary, alice, aud), 0);
        assert_eq!(exp(&chain, steve, gary, usd), 0);
        assert_eq!(
            FxOffer::get(gary, aud, usd, false).unwrap().remaining.value,
            5_000
        );

        // More than the path spends, so Remove is what deletes the creditor row.
        Wrapper::push_from(&chain, gary)
            .st_fx_ofr(
                aud,
                usd,
                true,
                Quantity::new(0),
                RATE_SCALE * 70 / 100,
                Quantity::new(2_000),
                never(),
            )
            .get()?;
        let listed = banx_gql(&chain, policies_q)?;
        assert_eq!(
            gary_sides(&listed, "/data/fxOffers", aud, usd),
            vec![false, true],
            "{listed}"
        );

        Wrapper::push_from(&chain, alice)
            .path_pay(
                seal(
                    &chain,
                    alice,
                    vec![hop(gary, aud), hop(steve, usd)],
                    Quantity::new(1_000),
                ),
                Quantity::new(1_000),
                Quantity::new(700),
                0,
            )
            .get()?;
        assert_eq!(exp(&chain, gary, alice, aud), 1_000);
        assert_eq!(exp(&chain, steve, gary, usd), 700);
        assert_eq!(
            FxOffer::get(gary, aud, usd, true).unwrap().remaining.value,
            1_000
        );
        assert_eq!(
            FxOffer::get(gary, aud, usd, false).unwrap().remaining.value,
            5_000
        );

        Wrapper::push_from(&chain, gary)
            .rm_fx_ofr(aud, usd, true)
            .get()?;
        let again = Wrapper::push_from(&chain, alice).path_pay(
            seal(
                &chain,
                alice,
                vec![hop(gary, aud), hop(steve, usd)],
                Quantity::new(1_000),
            ),
            Quantity::new(1_000),
            Quantity::new(0),
            0,
        );
        let err = again
            .trace
            .error
            .as_deref()
            .unwrap_or("(no error — path_pay succeeded)");
        assert!(err.contains("FxOffer not found"), "{err}");
        assert_eq!(exp(&chain, gary, alice, aud), 1_000);
        assert_eq!(exp(&chain, steve, gary, usd), 700);
        assert!(FxOffer::get(gary, aud, usd, true).is_none());
        assert_eq!(
            FxOffer::get(gary, aud, usd, false).unwrap().remaining.value,
            5_000
        );

        let listed = banx_gql(&chain, policies_q)?;
        assert_eq!(
            gary_sides(&listed, "/data/fxOffers", aud, usd),
            vec![false],
            "{listed}"
        );

        Ok(())
    }

    #[psibase::test_case(packages("Banx"))]
    fn test_path_pay_fx_after_partial_reverse_net(
        chain: psibase::Chain,
    ) -> Result<(), psibase::Error> {
        Wrapper::push(&chain).init().get()?;
        let alice = account!("alice");
        let gary = account!("gary");
        let steve = account!("steve");
        for a in [alice, gary, steve] {
            chain.new_account(a).unwrap();
        }
        let aud = Asset::get_by_symbol_assert(account!("aud")).id;
        let usd = Asset::get_by_symbol_assert(account!("usd")).id;
        Wrapper::push_from(&chain, gary)
            .st_crd_lne(alice, aud, Quantity::new(10_000), false)
            .get()?;
        Wrapper::push_from(&chain, steve)
            .st_crd_lne(gary, usd, Quantity::new(10_000), false)
            .get()?;
        Wrapper::push_from(&chain, gary)
            .st_fx_ofr(
                aud,
                usd,
                true,
                Quantity::new(0),
                RATE_SCALE * 70 / 100,
                Quantity::new(u64::MAX),
                never(),
            )
            .get()?;
        Wrapper::push_from(&chain, gary)
            .st_glb_fwd(usd, Quantity::new(0), 0, never(), true)
            .get()?;
        Wrapper::push_from(&chain, gary)
            .deposit(alice, aud, Quantity::new(400), 0)
            .get()?;

        Wrapper::push_from(&chain, alice)
            .path_pay(
                seal(
                    &chain,
                    alice,
                    vec![hop(gary, aud), hop(steve, usd)],
                    Quantity::new(1_000),
                ),
                Quantity::new(1_000),
                Quantity::new(700),
                0,
            )
            .get()?;
        // 400 unwind + 600 new: Alice owes Gary 600 AUD; Sam gets 1000×0.70 USD.
        assert_eq!(exp(&chain, alice, gary, aud), 0);
        assert_eq!(exp(&chain, gary, alice, aud), 600);
        assert_eq!(exp(&chain, gary, alice, usd), 0);
        assert_eq!(exp(&chain, steve, gary, usd), 700);
        Ok(())
    }

    /// Same unwind as `test_path_pay_fx_after_partial_reverse_net`, then a
    /// second FX hop through Sam in GBP.
    ///
    ///   Alice → Gary AUD (400 reverse) → Steve USD (0.70) → Sam GBP (0.80)
    ///
    /// Hop 0 nets 400; Alice still owes Gary 600 AUD.
    /// Hop 1: Gary's 0.70 → Steve is owed 700 USD (Gary still owed 600 AUD).
    /// Hop 2: Steve's 0.80 → Sam is owed 560 GBP (Gary still owed 700 USD).
    #[psibase::test_case(packages("Banx"))]
    fn test_path_pay_fx_aud_usd_gbp_after_partial_reverse(
        chain: psibase::Chain,
    ) -> Result<(), psibase::Error> {
        Wrapper::push(&chain).init().get()?;
        let alice = account!("alice");
        let gary = account!("gary");
        let steve = account!("steve");
        let sam = account!("sam");
        for a in [alice, gary, steve, sam] {
            chain.new_account(a).unwrap();
        }
        let aud = Asset::get_by_symbol_assert(account!("aud")).id;
        let usd = Asset::get_by_symbol_assert(account!("usd")).id;
        let gbp = Asset::get_by_symbol_assert(account!("gbp")).id;

        Wrapper::push_from(&chain, gary)
            .st_crd_lne(alice, aud, Quantity::new(10_000), false)
            .get()?;
        Wrapper::push_from(&chain, steve)
            .st_crd_lne(gary, usd, Quantity::new(10_000), false)
            .get()?;
        Wrapper::push_from(&chain, sam)
            .st_crd_lne(steve, gbp, Quantity::new(10_000), false)
            .get()?;

        Wrapper::push_from(&chain, gary)
            .st_fx_ofr(
                aud,
                usd,
                true,
                Quantity::new(0),
                RATE_SCALE * 70 / 100,
                Quantity::new(u64::MAX),
                never(),
            )
            .get()?;
        // Steve sits between USD and GBP.
        Wrapper::push_from(&chain, steve)
            .st_fx_ofr(
                usd,
                gbp,
                true,
                Quantity::new(0),
                RATE_SCALE * 80 / 100,
                Quantity::new(u64::MAX),
                never(),
            )
            .get()?;
        Wrapper::push_from(&chain, gary)
            .st_glb_fwd(usd, Quantity::new(0), 0, never(), true)
            .get()?;
        Wrapper::push_from(&chain, steve)
            .st_glb_fwd(gbp, Quantity::new(0), 0, never(), true)
            .get()?;
        Wrapper::push_from(&chain, gary)
            .deposit(alice, aud, Quantity::new(400), 0)
            .get()?;

        Wrapper::push_from(&chain, alice)
            .path_pay(
                seal(
                    &chain,
                    alice,
                    vec![hop(gary, aud), hop(steve, usd), hop(sam, gbp)],
                    Quantity::new(1_000),
                ),
                Quantity::new(1_000),
                Quantity::new(560),
                0,
            )
            .get()?;

        assert_eq!(exp(&chain, alice, gary, aud), 0);
        assert_eq!(
            exp(&chain, gary, alice, aud),
            600,
            "unwind leftover stays AUD"
        );
        assert_eq!(exp(&chain, gary, alice, usd), 0);
        assert_eq!(
            exp(&chain, steve, gary, usd),
            700,
            "Gary keeps USD claim on the hop"
        );
        assert_eq!(
            exp(&chain, steve, gary, gbp),
            0,
            "Steve prices GBP; does not rebook USD"
        );
        assert_eq!(exp(&chain, sam, steve, gbp), 560);
        assert_eq!(exp(&chain, sam, steve, usd), 0);
        Ok(())
    }

    /// Alice's FX quote must not price a hop through Gary.
    #[psibase::test_case(packages("Banx"))]
    fn test_path_pay_fx_uses_middle_man_policy_not_sender(
        chain: psibase::Chain,
    ) -> Result<(), psibase::Error> {
        Wrapper::push(&chain).init().get()?;
        let alice = account!("alice");
        let gary = account!("gary");
        let steve = account!("steve");
        for a in [alice, gary, steve] {
            chain.new_account(a).unwrap();
        }
        let aud = Asset::get_by_symbol_assert(account!("aud")).id;
        let usd = Asset::get_by_symbol_assert(account!("usd")).id;
        Wrapper::push_from(&chain, gary)
            .st_crd_lne(alice, aud, Quantity::new(10_000), false)
            .get()?;
        Wrapper::push_from(&chain, steve)
            .st_crd_lne(gary, usd, Quantity::new(10_000), false)
            .get()?;
        Wrapper::push_from(&chain, gary)
            .st_glb_fwd(usd, Quantity::new(0), 0, never(), true)
            .get()?;
        Wrapper::push_from(&chain, alice)
            .st_fx_ofr(
                aud,
                usd,
                true,
                Quantity::new(0),
                RATE_SCALE * 50 / 100,
                Quantity::new(u64::MAX),
                never(),
            )
            .get()?;

        let no_gary = Wrapper::push_from(&chain, alice)
            .path_pay(
                seal(
                    &chain,
                    alice,
                    vec![hop(gary, aud), hop(steve, usd)],
                    Quantity::new(1_000),
                ),
                Quantity::new(1_000),
                Quantity::new(1),
                0,
            )
            .get();
        assert!(
            no_gary.is_err(),
            "path_pay must fail without Gary's AUD→USD offer"
        );

        Wrapper::push_from(&chain, gary)
            .st_fx_ofr(
                aud,
                usd,
                true,
                Quantity::new(0),
                RATE_SCALE * 70 / 100,
                Quantity::new(u64::MAX),
                never(),
            )
            .get()?;
        Wrapper::push_from(&chain, alice)
            .path_pay(
                seal(
                    &chain,
                    alice,
                    vec![hop(gary, aud), hop(steve, usd)],
                    Quantity::new(1_000),
                ),
                Quantity::new(1_000),
                Quantity::new(700),
                0,
            )
            .get()?;
        assert_eq!(exp(&chain, gary, alice, aud), 1_000);
        assert_eq!(
            exp(&chain, gary, alice, usd),
            0,
            "Alice is not rebooked to USD"
        );
        assert_eq!(
            exp(&chain, steve, gary, usd),
            700,
            "Gary's 0.70, not Alice's 0.50"
        );
        Ok(())
    }

    #[psibase::test_case(packages("Banx"))]
    fn test_credit_line_and_deposit_reject_bad_args(
        chain: psibase::Chain,
    ) -> Result<(), psibase::Error> {
        Wrapper::push(&chain).init().get()?;
        let alice = account!("alice");
        chain.new_account(alice).unwrap();
        let usd = Asset::get_by_symbol_assert(account!("usd")).id;

        assert!(Wrapper::push_from(&chain, alice)
            .st_crd_lne(alice, usd, Quantity::new(100), false)
            .get()
            .is_err());
        let bob = account!("bob");
        chain.new_account(bob).unwrap();
        let missing = crate::iso4217::SEEDED_ASSETS.len() as u16 + 1;
        assert!(Wrapper::push_from(&chain, alice)
            .st_crd_lne(bob, missing, Quantity::new(100), false)
            .get()
            .is_err());
        assert!(Wrapper::push_from(&chain, alice)
            .deposit(alice, usd, Quantity::new(1), 0)
            .get()
            .is_err());
        assert!(Wrapper::push_from(&chain, alice)
            .deposit(bob, usd, Quantity::new(0), 0)
            .get()
            .is_err());
        Ok(())
    }

    #[psibase::test_case(packages("Banx"))]
    fn test_named_counterparties_must_exist(chain: psibase::Chain) -> Result<(), psibase::Error> {
        Wrapper::push(&chain).init().get()?;
        let alice = account!("alice");
        chain.new_account(alice).unwrap();
        let usd = Asset::get_by_symbol_assert(account!("usd")).id;
        let ghost = account!("nobody");

        assert!(Wrapper::push_from(&chain, alice)
            .st_crd_lne(ghost, usd, Quantity::new(100), false)
            .get()
            .is_err());
        assert!(Wrapper::push_from(&chain, alice)
            .st_fwd_ofr(ghost, usd, Quantity::new(0), 0, never(), true)
            .get()
            .is_err());
        assert!(Wrapper::push_from(&chain, alice)
            .st_buy_clm(
                ghost,
                usd,
                Quantity::new(0),
                0,
                Quantity::new(u64::MAX),
                never()
            )
            .get()
            .is_err());
        assert!(Wrapper::push_from(&chain, alice)
            .st_sell_clm(
                ghost,
                usd,
                Quantity::new(0),
                0,
                Quantity::new(u64::MAX),
                never()
            )
            .get()
            .is_err());
        assert!(Wrapper::push_from(&chain, alice)
            .st_req(
                PayRequest::INVOICE,
                ghost,
                usd,
                Quantity::new(1),
                "".into(),
                never(),
            )
            .get()
            .is_err());
        assert!(Wrapper::push_from(&chain, alice)
            .deposit(ghost, usd, Quantity::new(1), 0)
            .get()
            .is_err());
        assert!(Wrapper::push_from(&chain, alice)
            .forgive(ghost, usd, Quantity::new(1))
            .get()
            .is_err());
        Ok(())
    }

    #[psibase::test_case(packages("Banx"))]
    fn test_offer_upserts_require_registered_asset(
        chain: psibase::Chain,
    ) -> Result<(), psibase::Error> {
        Wrapper::push(&chain).init().get()?;
        let alice = account!("alice");
        chain.new_account(alice).unwrap();
        let usd = Asset::get_by_symbol_assert(account!("usd")).id;
        // Ids are 1..=seeded. 99 is a real currency.
        let missing = crate::iso4217::SEEDED_ASSETS.len() as u16 + 1;

        let fx = Wrapper::push_from(&chain, alice)
            .st_fx_ofr(
                usd,
                missing,
                true,
                Quantity::new(0),
                RATE_SCALE,
                Quantity::new(u64::MAX),
                never(),
            )
            .get();
        assert!(fx.is_err());
        let fx_from = Wrapper::push_from(&chain, alice)
            .st_fx_ofr(
                missing,
                usd,
                true,
                Quantity::new(0),
                RATE_SCALE,
                Quantity::new(u64::MAX),
                never(),
            )
            .get();
        assert!(fx_from.is_err());
        let fwd = Wrapper::push_from(&chain, alice)
            .st_glb_fwd(missing, Quantity::new(0), 0, never(), true)
            .get();
        assert!(fwd.is_err());
        let buy = Wrapper::push_from(&chain, alice)
            .st_glb_buy(
                missing,
                Quantity::new(0),
                0,
                Quantity::new(u64::MAX),
                never(),
            )
            .get();
        assert!(buy.is_err());
        let write_off = Wrapper::push_from(&chain, alice)
            .forgive(alice, missing, Quantity::new(1))
            .get();
        assert!(write_off.is_err());
        Ok(())
    }

    #[psibase::test_case(packages("Banx"))]
    fn test_sell_claim_specific_take_overrides_global(
        chain: psibase::Chain,
    ) -> Result<(), psibase::Error> {
        Wrapper::push(&chain).init().get()?;
        let alice = account!("alice");
        let bob = account!("bob");
        let peter = account!("peter");
        for a in [alice, bob, peter] {
            chain.new_account(a).unwrap();
        }
        let usd = Asset::get_by_symbol_assert(account!("usd")).id;
        Wrapper::push_from(&chain, bob)
            .deposit(alice, usd, Quantity::new(1_000), 0)
            .get()?;
        Wrapper::push_from(&chain, peter)
            .st_crd_lne(bob, usd, Quantity::new(10_000), false)
            .get()?;
        Wrapper::push_from(&chain, peter)
            .st_glb_buy(
                usd,
                Quantity::new(0),
                (PPM_SCALE * 5 / 100) as i32,
                Quantity::new(u64::MAX),
                never(),
            )
            .get()?;
        Wrapper::push_from(&chain, peter)
            .st_buy_clm(
                bob,
                usd,
                Quantity::new(0),
                0,
                Quantity::new(u64::MAX),
                never(),
            )
            .get()?;
        Wrapper::push_from(&chain, bob)
            .st_crd_lne(peter, usd, Quantity::new(0), false)
            .get()?;

        Wrapper::push_from(&chain, alice)
            .sell_claim(peter, bob, usd, Quantity::new(1_000), Quantity::new(0))
            .get()?;
        assert_eq!(exp(&chain, alice, peter, usd), 1_000);
        Ok(())
    }

    #[psibase::test_case(packages("Banx"))]
    fn test_forgive_writes_off_claim(chain: psibase::Chain) -> Result<(), psibase::Error> {
        Wrapper::push(&chain).init().get()?;
        let alice = account!("alice");
        let bob = account!("bob");
        chain.new_account(alice).unwrap();
        chain.new_account(bob).unwrap();
        let usd = Asset::get_by_symbol_assert(account!("usd")).id;

        // Bob books a deposit from Alice → Alice holds 1000 on Bob.
        Wrapper::push_from(&chain, bob)
            .deposit(alice, usd, Quantity::new(1_000), 0)
            .get()?;
        assert_eq!(exp(&chain, alice, bob, usd), 1_000);
        assert_eq!(exp(&chain, bob, alice, usd), 0);

        Wrapper::push_from(&chain, alice)
            .forgive(bob, usd, Quantity::new(300))
            .get()?;
        assert_eq!(exp(&chain, alice, bob, usd), 700);
        assert_eq!(
            exp(&chain, bob, alice, usd),
            0,
            "forgive does not book a reverse claim"
        );

        // Over-ask is capped at live exposure (leftover is unused).
        Wrapper::push_from(&chain, alice)
            .forgive(bob, usd, Quantity::new(10_000))
            .get()?;
        assert_eq!(exp(&chain, alice, bob, usd), 0);
        assert_eq!(exp(&chain, bob, alice, usd), 0);

        assert!(Wrapper::push_from(&chain, alice)
            .forgive(alice, usd, Quantity::new(1))
            .get()
            .is_err());
        assert!(Wrapper::push_from(&chain, alice)
            .forgive(bob, usd, Quantity::new(0))
            .get()
            .is_err());
        // Already empty: succeeds and does nothing.
        Wrapper::push_from(&chain, alice)
            .forgive(bob, usd, Quantity::new(1))
            .get()?;
        assert_eq!(exp(&chain, alice, bob, usd), 0);
        Ok(())
    }

    /// A balance at the i64 ceiling can still be forgiven.
    #[psibase::test_case(packages("Banx"))]
    fn test_deposit_max_principal_can_be_forgiven(
        chain: psibase::Chain,
    ) -> Result<(), psibase::Error> {
        Wrapper::push(&chain).init().get()?;
        let alice = account!("alice");
        let bob = account!("bob");
        chain.new_account(alice).unwrap();
        chain.new_account(bob).unwrap();
        let usd = Asset::get_by_symbol_assert(account!("usd")).id;

        Wrapper::push_from(&chain, alice)
            .deposit(bob, usd, Quantity::new(i64::MAX as u64), 0)
            .get()?;
        assert_eq!(exp(&chain, bob, alice, usd), i64::MAX as u64);

        Wrapper::push_from(&chain, bob)
            .forgive(alice, usd, Quantity::new(u64::MAX))
            .get()?;
        assert_eq!(exp(&chain, bob, alice, usd), 0);
        Ok(())
    }

    /// Same poster/asset: 5% path hop, 0% buy-claim. Each action uses its own row.
    #[psibase::test_case(packages("Banx"))]
    fn test_forward_and_buy_claim_fees_independent(
        chain: psibase::Chain,
    ) -> Result<(), psibase::Error> {
        Wrapper::push(&chain).init().get()?;
        let alice = account!("alice");
        let bob = account!("bob");
        let carol = account!("carol");
        let gary = account!("gary");
        let steve = account!("steve");
        for a in [alice, bob, carol, gary, steve] {
            chain.new_account(a).unwrap();
        }
        let usd = Asset::get_by_symbol_assert(account!("usd")).id;

        Wrapper::push_from(&chain, gary)
            .st_crd_lne(alice, usd, Quantity::new(10_000), false)
            .get()?;
        Wrapper::push_from(&chain, steve)
            .st_crd_lne(gary, usd, Quantity::new(10_000), false)
            .get()?;
        Wrapper::push_from(&chain, gary)
            .st_crd_lne(bob, usd, Quantity::new(10_000), false)
            .get()?;
        Wrapper::push_from(&chain, gary)
            .st_glb_fwd(usd, Quantity::new(0), PPM_SCALE * 5 / 100, never(), true)
            .get()?;
        Wrapper::push_from(&chain, gary)
            .st_glb_buy(usd, Quantity::new(0), 0, Quantity::new(u64::MAX), never())
            .get()?;

        Wrapper::push_from(&chain, alice)
            .path_pay(
                seal(
                    &chain,
                    alice,
                    vec![hop(gary, usd), hop(steve, usd)],
                    Quantity::new(1_000),
                ),
                Quantity::new(1_000),
                Quantity::new(950),
                0,
            )
            .get()?;
        assert_eq!(exp(&chain, steve, gary, usd), 950);

        Wrapper::push_from(&chain, bob)
            .deposit(carol, usd, Quantity::new(1_000), 0)
            .get()?;
        Wrapper::push_from(&chain, bob)
            .st_crd_lne(gary, usd, Quantity::new(0), false)
            .get()?;
        Wrapper::push_from(&chain, carol)
            .sell_claim(gary, bob, usd, Quantity::new(1_000), Quantity::new(0))
            .get()?;
        assert_eq!(exp(&chain, carol, gary, usd), 1_000);
        assert_eq!(exp(&chain, gary, bob, usd), 1_000);
        Ok(())
    }

    /// C lined B, B lined A. A pays C via B. C can pay A back by unwinding
    /// those claims — no opposite credit lines required.
    #[psibase::test_case(packages("Banx"))]
    fn test_path_pay_unwinds_reverse_claims(chain: psibase::Chain) -> Result<(), psibase::Error> {
        Wrapper::push(&chain).init().get()?;
        let a = account!("alice");
        let b = account!("bobby");
        let c = account!("carol");
        for acct in [a, b, c] {
            chain.new_account(acct).unwrap();
        }
        let usd = Asset::get_by_symbol_assert(account!("usd")).id;

        Wrapper::push_from(&chain, b)
            .st_crd_lne(a, usd, Quantity::new(10_000), false)
            .get()?;
        Wrapper::push_from(&chain, c)
            .st_crd_lne(b, usd, Quantity::new(10_000), false)
            .get()?;
        Wrapper::push_from(&chain, b)
            .st_glb_fwd(usd, Quantity::new(0), 0, never(), true)
            .get()?;

        Wrapper::push_from(&chain, a)
            .path_pay(
                seal(
                    &chain,
                    a,
                    vec![hop(b, usd), hop(c, usd)],
                    Quantity::new(1_000),
                ),
                Quantity::new(1_000),
                Quantity::new(1_000),
                0,
            )
            .get()?;
        assert_eq!(exp(&chain, b, a, usd), 1_000);
        assert_eq!(exp(&chain, c, b, usd), 1_000);

        Wrapper::push_from(&chain, c)
            .path_pay(
                seal(
                    &chain,
                    c,
                    vec![hop(b, usd), hop(a, usd)],
                    Quantity::new(1_000),
                ),
                Quantity::new(1_000),
                Quantity::new(1_000),
                0,
            )
            .get()?;
        assert_eq!(exp(&chain, b, a, usd), 0);
        assert_eq!(exp(&chain, c, b, usd), 0);
        assert_eq!(exp(&chain, a, b, usd), 0);
        assert_eq!(exp(&chain, b, c, usd), 0);
        Ok(())
    }

    #[psibase::test_case(packages("Banx"))]
    fn test_invoice_path_pay_fulfills(chain: psibase::Chain) -> Result<(), psibase::Error> {
        Wrapper::push(&chain).init().get()?;
        let alice = account!("alice");
        let gary = account!("gary");
        let steve = account!("steve");
        for a in [alice, gary, steve] {
            chain.new_account(a).unwrap();
        }
        let usd = Asset::get_by_symbol_assert(account!("usd")).id;
        Wrapper::push_from(&chain, gary)
            .st_crd_lne(alice, usd, Quantity::new(10_000), false)
            .get()?;
        Wrapper::push_from(&chain, steve)
            .st_crd_lne(gary, usd, Quantity::new(10_000), false)
            .get()?;
        Wrapper::push_from(&chain, gary)
            .st_glb_fwd(usd, Quantity::new(0), 0, never(), true)
            .get()?;

        let id = Wrapper::push_from(&chain, steve)
            .st_req(
                PayRequest::INVOICE,
                alice,
                usd,
                Quantity::new(400),
                "for lunch".into(),
                never(),
            )
            .get()?;
        assert_eq!(PayRequest::get_assert(id).remaining.value, 400);

        Wrapper::push_from(&chain, alice)
            .path_pay(
                seal(
                    &chain,
                    alice,
                    vec![hop(gary, usd), hop(steve, usd)],
                    Quantity::new(400),
                ),
                Quantity::new(400),
                Quantity::new(400),
                id,
            )
            .get()?;
        assert!(PayRequest::get(id).is_none());
        assert_eq!(exp(&chain, steve, gary, usd), 400);
        Ok(())
    }

    /// `pay_inv` walks back: $5 invoice, $20 budget, no hop fee → send $5.
    #[psibase::test_case(packages("Banx"))]
    fn test_pay_inv_walks_back_zero_fee(chain: psibase::Chain) -> Result<(), psibase::Error> {
        Wrapper::push(&chain).init().get()?;
        let mitchell = account!("mitchell");
        let john = account!("john");
        let cafe = account!("cafe");
        for a in [mitchell, john, cafe] {
            chain.new_account(a).unwrap();
        }
        let aud = Asset::get_by_symbol_assert(account!("aud")).id;

        Wrapper::push_from(&chain, john)
            .st_crd_lne(mitchell, aud, 50_0000.into(), false)
            .get()?;
        Wrapper::push_from(&chain, cafe)
            .st_crd_lne(john, aud, 50_0000.into(), false)
            .get()?;
        Wrapper::push_from(&chain, john)
            .st_crd_lne(cafe, aud, 0.into(), false)
            .get()?;
        Wrapper::push_from(&chain, john)
            .st_fwd_ofr(cafe, aud, 0.into(), 0, never(), false)
            .get()?;

        let id = Wrapper::push_from(&chain, cafe)
            .st_req(
                PayRequest::INVOICE,
                mitchell,
                aud,
                5_0000.into(),
                "coffee".into(),
                never(),
            )
            .get()?;

        Wrapper::push_from(&chain, mitchell)
            .pay_inv(
                seal_inv(&chain, mitchell, vec![hop(john, aud), hop(cafe, aud)], id),
                20_0000.into(),
                id,
            )
            .get()?;

        assert!(PayRequest::get(id).is_none());
        assert_eq!(exp(&chain, john, mitchell, aud), 5_0000);
        assert_eq!(exp(&chain, cafe, john, aud), 5_0000);
        assert_eq!(exp(&chain, cafe, mitchell, aud), 0);
        Ok(())
    }

    /// 1% hop fee: $5 invoice needs send 5.0506, not the $20 budget.
    #[psibase::test_case(packages("Banx"))]
    fn test_pay_inv_walks_back_hop_fee(chain: psibase::Chain) -> Result<(), psibase::Error> {
        Wrapper::push(&chain).init().get()?;
        let mitchell = account!("mitchell");
        let john = account!("john");
        let cafe = account!("cafe");
        for a in [mitchell, john, cafe] {
            chain.new_account(a).unwrap();
        }
        let aud = Asset::get_by_symbol_assert(account!("aud")).id;

        Wrapper::push_from(&chain, john)
            .st_crd_lne(mitchell, aud, 50_0000.into(), false)
            .get()?;
        Wrapper::push_from(&chain, cafe)
            .st_crd_lne(john, aud, 50_0000.into(), false)
            .get()?;
        Wrapper::push_from(&chain, john)
            .st_crd_lne(cafe, aud, 0.into(), false)
            .get()?;
        Wrapper::push_from(&chain, john)
            .st_fwd_ofr(cafe, aud, 0.into(), PPM_SCALE / 100, never(), false)
            .get()?;

        let id = Wrapper::push_from(&chain, cafe)
            .st_req(
                PayRequest::INVOICE,
                mitchell,
                aud,
                5_0000.into(),
                "coffee".into(),
                never(),
            )
            .get()?;

        Wrapper::push_from(&chain, mitchell)
            .pay_inv(
                seal_inv(&chain, mitchell, vec![hop(john, aud), hop(cafe, aud)], id),
                20_0000.into(),
                id,
            )
            .get()?;

        assert!(PayRequest::get(id).is_none());
        assert_eq!(exp(&chain, john, mitchell, aud), 5_0506);
        assert_eq!(exp(&chain, cafe, john, aud), 5_0000);
        Ok(())
    }

    #[psibase::test_case(packages("Banx"))]
    fn test_pay_inv_max_spend_too_small(chain: psibase::Chain) -> Result<(), psibase::Error> {
        Wrapper::push(&chain).init().get()?;
        let mitchell = account!("mitchell");
        let john = account!("john");
        let cafe = account!("cafe");
        for a in [mitchell, john, cafe] {
            chain.new_account(a).unwrap();
        }
        let aud = Asset::get_by_symbol_assert(account!("aud")).id;

        Wrapper::push_from(&chain, john)
            .st_crd_lne(mitchell, aud, 50_0000.into(), false)
            .get()?;
        Wrapper::push_from(&chain, cafe)
            .st_crd_lne(john, aud, 50_0000.into(), false)
            .get()?;
        Wrapper::push_from(&chain, john)
            .st_crd_lne(cafe, aud, 0.into(), false)
            .get()?;
        Wrapper::push_from(&chain, john)
            .st_fwd_ofr(cafe, aud, 0.into(), 0, never(), false)
            .get()?;

        let id = Wrapper::push_from(&chain, cafe)
            .st_req(
                PayRequest::INVOICE,
                mitchell,
                aud,
                5_0000.into(),
                "coffee".into(),
                never(),
            )
            .get()?;

        let failed = Wrapper::push_from(&chain, mitchell).pay_inv(
            seal_inv(&chain, mitchell, vec![hop(john, aud), hop(cafe, aud)], id),
            4_0000.into(),
            id,
        );
        let err = failed.trace.error.as_deref().unwrap_or("(no error)");
        assert!(
            err.contains("max_spend below required send"),
            "test_pay_inv_max_spend_too_small: got {err}"
        );
        assert_eq!(PayRequest::get_assert(id).remaining.value, 5_0000);
        assert_eq!(exp(&chain, john, mitchell, aud), 0);
        assert_eq!(exp(&chain, cafe, john, aud), 0);
        Ok(())
    }

    /// Expired FX must fail at invert (`fx offer expired`), not after
    /// sizing a send and hitting `max_spend below required send`.
    #[psibase::test_case(packages("Banx"))]
    fn test_pay_inv_expired_fx_fails_at_invert(
        chain: psibase::Chain,
    ) -> Result<(), psibase::Error> {
        Wrapper::push(&chain).init().get()?;
        let alice = account!("alice");
        let gary = account!("gary");
        let steve = account!("steve");
        for a in [alice, gary, steve] {
            chain.new_account(a).unwrap();
        }
        let aud = Asset::get_by_symbol_assert(account!("aud")).id;
        let usd = Asset::get_by_symbol_assert(account!("usd")).id;

        Wrapper::push_from(&chain, gary)
            .st_crd_lne(alice, aud, Quantity::new(10_000), false)
            .get()?;
        Wrapper::push_from(&chain, steve)
            .st_crd_lne(gary, usd, Quantity::new(10_000), false)
            .get()?;
        Wrapper::push_from(&chain, gary)
            .st_glb_fwd(usd, Quantity::new(0), 0, never(), true)
            .get()?;
        Wrapper::push_from(&chain, gary)
            .st_fx_ofr(
                aud,
                usd,
                true,
                Quantity::new(0),
                RATE_SCALE * 70 / 100,
                Quantity::new(u64::MAX),
                TimePointSec { seconds: 1 },
            )
            .get()?;

        let id = Wrapper::push_from(&chain, steve)
            .st_req(
                PayRequest::INVOICE,
                alice,
                usd,
                Quantity::new(700),
                "x".into(),
                never(),
            )
            .get()?;

        let failed = Wrapper::push_from(&chain, alice).pay_inv(
            seal_inv(&chain, alice, vec![hop(gary, aud), hop(steve, usd)], id),
            Quantity::new(500),
            id,
        );
        let err = failed.trace.error.as_deref().unwrap_or("(no error)");
        assert!(
            err.contains("fx offer expired"),
            "test_pay_inv_expired_fx_fails_at_invert: got {err}"
        );
        assert!(
            !err.contains("max_spend below required send"),
            "expired FX must not be inverted then fail the budget: got {err}"
        );
        assert_eq!(PayRequest::get_assert(id).remaining.value, 700);
        assert_eq!(exp(&chain, gary, alice, aud), 0);
        assert_eq!(exp(&chain, steve, gary, usd), 0);
        Ok(())
    }

    #[psibase::test_case(packages("Banx"))]
    fn test_invoice_rejects_wrong_payer_or_hop(
        chain: psibase::Chain,
    ) -> Result<(), psibase::Error> {
        Wrapper::push(&chain).init().get()?;
        let alice = account!("alice");
        let gary = account!("gary");
        let steve = account!("steve");
        for a in [alice, gary, steve] {
            chain.new_account(a).unwrap();
        }
        let usd = Asset::get_by_symbol_assert(account!("usd")).id;
        Wrapper::push_from(&chain, gary)
            .st_crd_lne(alice, usd, Quantity::new(10_000), false)
            .get()?;
        Wrapper::push_from(&chain, steve)
            .st_crd_lne(gary, usd, Quantity::new(10_000), false)
            .get()?;
        Wrapper::push_from(&chain, gary)
            .st_glb_fwd(usd, Quantity::new(0), 0, never(), true)
            .get()?;
        let id = Wrapper::push_from(&chain, steve)
            .st_req(
                PayRequest::INVOICE,
                alice,
                usd,
                Quantity::new(100),
                "".into(),
                never(),
            )
            .get()?;

        // Ends at Gary, not Steve.
        assert!(Wrapper::push_from(&chain, alice)
            .path_pay(
                seal(&chain, alice, vec![hop(gary, usd)], Quantity::new(100)),
                Quantity::new(100),
                Quantity::new(100),
                id,
            )
            .get()
            .is_err());
        assert_eq!(PayRequest::get_assert(id).remaining.value, 100);

        // Named counterparty is who was billed; anyone with a path may pay.
        Wrapper::push_from(&chain, gary)
            .path_pay(
                seal(&chain, gary, vec![hop(steve, usd)], Quantity::new(100)),
                Quantity::new(100),
                Quantity::new(100),
                id,
            )
            .get()?;
        assert!(PayRequest::get(id).is_none());
        Ok(())
    }

    #[psibase::test_case(packages("Banx"))]
    fn test_invoice_counterparty_zero_anyone_pays(
        chain: psibase::Chain,
    ) -> Result<(), psibase::Error> {
        Wrapper::push(&chain).init().get()?;
        let alice = account!("alice");
        let steve = account!("steve");
        for a in [alice, steve] {
            chain.new_account(a).unwrap();
        }
        let usd = Asset::get_by_symbol_assert(account!("usd")).id;
        Wrapper::push_from(&chain, steve)
            .st_crd_lne(alice, usd, Quantity::new(10_000), false)
            .get()?;
        let id = Wrapper::push_from(&chain, steve)
            .st_req(
                PayRequest::INVOICE,
                AccountNumber::new(0),
                usd,
                Quantity::new(100),
                "".into(),
                never(),
            )
            .get()?;
        Wrapper::push_from(&chain, alice)
            .path_pay(
                seal(&chain, alice, vec![hop(steve, usd)], Quantity::new(100)),
                Quantity::new(100),
                Quantity::new(100),
                id,
            )
            .get()?;
        assert!(PayRequest::get(id).is_none());
        Ok(())
    }

    #[psibase::test_case(packages("Banx"))]
    fn test_st_req_rejects_unknown_kind(chain: psibase::Chain) -> Result<(), psibase::Error> {
        Wrapper::push(&chain).init().get()?;
        let alice = account!("alice");
        let bob = account!("bob");
        chain.new_account(alice).unwrap();
        chain.new_account(bob).unwrap();
        let usd = Asset::get_by_symbol_assert(account!("usd")).id;
        assert!(Wrapper::push_from(&chain, alice)
            .st_req(3, bob, usd, Quantity::new(100), "".into(), never())
            .get()
            .is_err());
        Ok(())
    }

    #[psibase::test_case(packages("Banx"))]
    fn test_please_book_rejects_zero_counterparty(
        chain: psibase::Chain,
    ) -> Result<(), psibase::Error> {
        Wrapper::push(&chain).init().get()?;
        let alice = account!("alice");
        chain.new_account(alice).unwrap();
        let usd = Asset::get_by_symbol_assert(account!("usd")).id;
        assert!(Wrapper::push_from(&chain, alice)
            .st_req(
                PayRequest::PLEASE_BOOK,
                AccountNumber::new(0),
                usd,
                Quantity::new(100),
                "".into(),
                never(),
            )
            .get()
            .is_err());
        Ok(())
    }

    #[psibase::test_case(packages("Banx"))]
    fn test_please_book_deposit_fulfills(chain: psibase::Chain) -> Result<(), psibase::Error> {
        Wrapper::push(&chain).init().get()?;
        let alice = account!("alice");
        let bob = account!("bob");
        chain.new_account(alice).unwrap();
        chain.new_account(bob).unwrap();
        let usd = Asset::get_by_symbol_assert(account!("usd")).id;
        Wrapper::push_from(&chain, bob)
            .st_crd_lne(alice, usd, Quantity::new(10_000), false)
            .get()?;
        Wrapper::push_from(&chain, alice)
            .path_pay(
                seal(&chain, alice, vec![hop(bob, usd)], Quantity::new(1_000)),
                Quantity::new(1_000),
                Quantity::new(1_000),
                0,
            )
            .get()?;
        assert_eq!(exp(&chain, bob, alice, usd), 1_000);

        let id = Wrapper::push_from(&chain, alice)
            .st_req(
                PayRequest::PLEASE_BOOK,
                bob,
                usd,
                Quantity::new(1_000),
                "cash in person".into(),
                never(),
            )
            .get()?;

        // Debtor cannot book their own please-book.
        assert!(Wrapper::push_from(&chain, alice)
            .deposit(alice, usd, Quantity::new(1_000), id)
            .get()
            .is_err());

        Wrapper::push_from(&chain, bob)
            .deposit(alice, usd, Quantity::new(1_000), id)
            .get()?;
        assert_eq!(exp(&chain, bob, alice, usd), 0);
        assert!(PayRequest::get(id).is_none());
        Ok(())
    }

    #[psibase::test_case(packages("Banx"))]
    fn test_request_cancel_blocks_fulfill(chain: psibase::Chain) -> Result<(), psibase::Error> {
        Wrapper::push(&chain).init().get()?;
        let alice = account!("alice");
        let bob = account!("bob");
        chain.new_account(alice).unwrap();
        chain.new_account(bob).unwrap();
        let usd = Asset::get_by_symbol_assert(account!("usd")).id;
        let id = Wrapper::push_from(&chain, alice)
            .st_req(
                PayRequest::PLEASE_BOOK,
                bob,
                usd,
                Quantity::new(50),
                "".into(),
                never(),
            )
            .get()?;
        Wrapper::push_from(&chain, alice).rm_req(id).get()?;
        assert!(PayRequest::get(id).is_none());
        assert!(Wrapper::push_from(&chain, bob)
            .deposit(alice, usd, Quantity::new(50), id)
            .get()
            .is_err());
        Ok(())
    }

    /// Re-posting a depleting line (same or higher limit) must not refill spent remaining.
    #[psibase::test_case(packages("Banx"))]
    fn test_want_deplete_edit_does_not_refill_remaining(
        chain: psibase::Chain,
    ) -> Result<(), psibase::Error> {
        Wrapper::push(&chain).init().get()?;
        let alice = account!("alice");
        let bob = account!("bob");
        chain.new_account(alice).unwrap();
        chain.new_account(bob).unwrap();
        let usd = Asset::get_by_symbol_assert(account!("usd")).id;

        Wrapper::push_from(&chain, bob)
            .st_crd_lne(alice, usd, Quantity::new(100), true)
            .get()?;
        Wrapper::push_from(&chain, alice)
            .path_pay(
                seal(&chain, alice, vec![hop(bob, usd)], Quantity::new(60)),
                Quantity::new(60),
                Quantity::new(60),
                0,
            )
            .get()?;
        assert_eq!(Pair::line(bob, alice, usd).unwrap().remaining.value, 40);

        Wrapper::push_from(&chain, bob)
            .st_crd_lne(alice, usd, Quantity::new(100), true)
            .get()?;
        assert_eq!(
            Pair::line(bob, alice, usd).unwrap().remaining.value,
            40,
            "test_want_deplete_edit_does_not_refill_remaining: re-post reset remaining \
             to the limit; spent remaining must stay 40"
        );

        Wrapper::push_from(&chain, bob)
            .st_crd_lne(alice, usd, Quantity::new(200), true)
            .get()?;
        assert_eq!(
            Pair::line(bob, alice, usd).unwrap().remaining.value,
            40,
            "test_want_deplete_edit_does_not_refill_remaining: raising the limit refilled remaining"
        );
        Ok(())
    }

    /// Toggle deplete off then on must not restore spent remaining.
    #[psibase::test_case(packages("Banx"))]
    fn test_deplete_toggle_does_not_refill_remaining(
        chain: psibase::Chain,
    ) -> Result<(), psibase::Error> {
        Wrapper::push(&chain).init().get()?;
        let alice = account!("alice");
        let bob = account!("bob");
        chain.new_account(alice).unwrap();
        chain.new_account(bob).unwrap();
        let usd = Asset::get_by_symbol_assert(account!("usd")).id;

        Wrapper::push_from(&chain, bob)
            .st_crd_lne(alice, usd, Quantity::new(100), true)
            .get()?;
        Wrapper::push_from(&chain, alice)
            .path_pay(
                seal(&chain, alice, vec![hop(bob, usd)], Quantity::new(60)),
                Quantity::new(60),
                Quantity::new(60),
                0,
            )
            .get()?;
        assert_eq!(Pair::line(bob, alice, usd).unwrap().remaining.value, 40);

        Wrapper::push_from(&chain, bob)
            .st_crd_lne(alice, usd, Quantity::new(100), false)
            .get()?;
        Wrapper::push_from(&chain, bob)
            .st_crd_lne(alice, usd, Quantity::new(100), true)
            .get()?;
        assert_eq!(
            Pair::line(bob, alice, usd).unwrap().remaining.value,
            40,
            "toggling deplete off then on refilled remaining to the limit"
        );
        Ok(())
    }

    /// Fully spent remaining (0) then revolving → depleting must not restore
    /// the budget. The upsert used to treat remaining==0 as first enable.
    #[psibase::test_case(packages("Banx"))]
    fn test_deplete_toggle_does_not_refill_zero_remaining(
        chain: psibase::Chain,
    ) -> Result<(), psibase::Error> {
        Wrapper::push(&chain).init().get()?;
        let alice = account!("alice");
        let bob = account!("bob");
        chain.new_account(alice).unwrap();
        chain.new_account(bob).unwrap();
        let usd = Asset::get_by_symbol_assert(account!("usd")).id;

        Wrapper::push_from(&chain, bob)
            .st_crd_lne(alice, usd, Quantity::new(100), true)
            .get()?;
        Wrapper::push_from(&chain, alice)
            .path_pay(
                seal(&chain, alice, vec![hop(bob, usd)], Quantity::new(100)),
                Quantity::new(100),
                Quantity::new(100),
                0,
            )
            .get()?;
        assert_eq!(Pair::line(bob, alice, usd).unwrap().remaining.value, 0);

        Wrapper::push_from(&chain, bob)
            .st_crd_lne(alice, usd, Quantity::new(100), false)
            .get()?;
        Wrapper::push_from(&chain, bob)
            .st_crd_lne(alice, usd, Quantity::new(100), true)
            .get()?;
        assert_eq!(
            Pair::line(bob, alice, usd).unwrap().remaining.value,
            0,
            "toggling deplete off then on refilled a fully spent remaining"
        );

        Wrapper::push_from(&chain, bob)
            .deposit(alice, usd, Quantity::new(100), 0)
            .get()?;
        let over = Wrapper::push_from(&chain, alice)
            .path_pay(
                seal(&chain, alice, vec![hop(bob, usd)], Quantity::new(1)),
                Quantity::new(1),
                Quantity::new(1),
                0,
            )
            .get();
        assert!(over.is_err());
        Ok(())
    }

    /// A revolving line keeps remaining equal to its limit, including after the
    /// limit changes, so the first switch to depleting can still be drawn.
    /// Spending that budget is permanent: repayment does not restore it.
    #[psibase::test_case(packages("Banx"))]
    fn test_revolving_first_deplete_has_budget(
        chain: psibase::Chain,
    ) -> Result<(), psibase::Error> {
        Wrapper::push(&chain).init().get()?;
        let alice = account!("alice");
        let bob = account!("bob");
        chain.new_account(alice).unwrap();
        chain.new_account(bob).unwrap();
        let usd = Asset::get_by_symbol_assert(account!("usd")).id;

        Wrapper::push_from(&chain, bob)
            .st_crd_lne(alice, usd, Quantity::new(100), false)
            .get()?;
        let line = Pair::line(bob, alice, usd).unwrap();
        assert!(!line.deplete_on_debit);
        assert_eq!(line.remaining.value, 100);

        Wrapper::push_from(&chain, bob)
            .st_crd_lne(alice, usd, Quantity::new(200), false)
            .get()?;
        assert_eq!(Pair::line(bob, alice, usd).unwrap().remaining.value, 200);

        Wrapper::push_from(&chain, bob)
            .st_crd_lne(alice, usd, Quantity::new(200), true)
            .get()?;
        assert_eq!(Pair::line(bob, alice, usd).unwrap().remaining.value, 200);

        Wrapper::push_from(&chain, alice)
            .path_pay(
                seal(&chain, alice, vec![hop(bob, usd)], Quantity::new(200)),
                Quantity::new(200),
                Quantity::new(200),
                0,
            )
            .get()?;
        assert_eq!(exp(&chain, bob, alice, usd), 200);
        assert_eq!(Pair::line(bob, alice, usd).unwrap().remaining.value, 0);

        Wrapper::push_from(&chain, bob)
            .deposit(alice, usd, Quantity::new(200), 0)
            .get()?;
        assert_eq!(exp(&chain, bob, alice, usd), 0);
        let over = Wrapper::push_from(&chain, alice)
            .path_pay(
                seal(&chain, alice, vec![hop(bob, usd)], Quantity::new(1)),
                Quantity::new(1),
                Quantity::new(1),
                0,
            )
            .get();
        assert!(over.is_err());
        Ok(())
    }

    /// Full unwind on hop 0 is not an unfinished path: FX still forwards the
    /// hop notional (min_return 0 must not look like a prefix-only settlement).
    #[psibase::test_case(packages("Banx"))]
    fn test_want_path_pay_full_unwind_still_forwards_fx(
        chain: psibase::Chain,
    ) -> Result<(), psibase::Error> {
        Wrapper::push(&chain).init().get()?;
        let alice = account!("alice");
        let gary = account!("gary");
        let steve = account!("steve");
        for a in [alice, gary, steve] {
            chain.new_account(a).unwrap();
        }
        let aud = Asset::get_by_symbol_assert(account!("aud")).id;
        let usd = Asset::get_by_symbol_assert(account!("usd")).id;
        Wrapper::push_from(&chain, gary)
            .st_crd_lne(alice, aud, Quantity::new(10_000), false)
            .get()?;
        Wrapper::push_from(&chain, steve)
            .st_crd_lne(gary, usd, Quantity::new(10_000), false)
            .get()?;
        Wrapper::push_from(&chain, gary)
            .st_fx_ofr(
                aud,
                usd,
                true,
                Quantity::new(0),
                RATE_SCALE * 70 / 100,
                Quantity::new(u64::MAX),
                never(),
            )
            .get()?;
        Wrapper::push_from(&chain, gary)
            .st_glb_fwd(usd, Quantity::new(0), 0, never(), true)
            .get()?;
        Wrapper::push_from(&chain, gary)
            .deposit(alice, aud, Quantity::new(1_000), 0)
            .get()?;

        Wrapper::push_from(&chain, alice)
            .path_pay(
                seal(
                    &chain,
                    alice,
                    vec![hop(gary, aud), hop(steve, usd)],
                    Quantity::new(1_000),
                ),
                Quantity::new(1_000),
                Quantity::new(0),
                0,
            )
            .get()?;
        assert_eq!(exp(&chain, alice, gary, aud), 0);
        assert_eq!(exp(&chain, gary, alice, aud), 0);
        assert_eq!(exp(&chain, steve, gary, usd), 700);
        Ok(())
    }

    fn enable_auto_debit(chain: &psibase::Chain, who: AccountNumber) {
        psibase::services::tokens::Wrapper::push_from(chain, who)
            .setUserConf(
                psibase::services::tokens::BalanceFlags::AUTO_DEBIT.index(),
                true,
            )
            .get()
            .unwrap();
    }

    fn token_balance(chain: &psibase::Chain, token_id: u32, who: AccountNumber) -> u64 {
        psibase::services::tokens::Wrapper::push(chain)
            .getBalance(token_id, who)
            .get()
            .unwrap()
            .value
    }

    fn shared_from_banx(chain: &psibase::Chain, token_id: u32, who: AccountNumber) -> u64 {
        psibase::services::tokens::Wrapper::push(chain)
            .getSharedBal(token_id, Wrapper::SERVICE, who)
            .get()
            .unwrap()
            .value
    }

    fn take_from_banx(chain: &psibase::Chain, who: AccountNumber, token_id: u32, amount: u64) {
        psibase::services::tokens::Wrapper::push_from(chain, who)
            .debit(
                token_id,
                Wrapper::SERVICE,
                Quantity::new(amount),
                "take".to_string().try_into().unwrap(),
            )
            .get()
            .unwrap();
    }

    /// Alice mints a 4 dp token (same scale as USD) and credits `holder`.
    fn mint_gas(
        chain: &psibase::Chain,
        minter: AccountNumber,
        holder: AccountNumber,
        supply: u64,
    ) -> u32 {
        psibase::services::nft::Wrapper::push_from(chain, minter)
            .setUserConf(
                psibase::services::nft::NftHolderFlags::AUTO_DEBIT.index(),
                true,
            )
            .get()
            .unwrap();
        let tokens = psibase::services::tokens::Wrapper::push_from(chain, minter);
        let token_id = tokens
            .create(Precision::new(4).unwrap(), Quantity::new(supply))
            .get()
            .unwrap();
        tokens
            .mint(
                token_id,
                Quantity::new(supply),
                "gas".to_string().try_into().unwrap(),
            )
            .get()
            .unwrap();
        if holder != minter {
            let holder_pulls = psibase::services::tokens::Wrapper::push(chain)
                .getUserConf(
                    holder,
                    psibase::services::tokens::BalanceFlags::AUTO_DEBIT.index(),
                )
                .get()
                .unwrap();
            psibase::services::tokens::Wrapper::push_from(chain, minter)
                .credit(
                    token_id,
                    holder,
                    Quantity::new(supply),
                    "gas".to_string().try_into().unwrap(),
                )
                .get()
                .unwrap();
            // A holder who auto-debits already took the credit, and that
            // deleted the shared row. Debiting it again cannot find it.
            if !holder_pulls {
                psibase::services::tokens::Wrapper::push_from(chain, holder)
                    .debit(
                        token_id,
                        minter,
                        Quantity::new(supply),
                        "gas".to_string().try_into().unwrap(),
                    )
                    .get()
                    .unwrap();
            }
        }
        token_id
    }

    fn fund_vault(chain: &psibase::Chain, poster: AccountNumber, token_id: u32, amount: u64) {
        psibase::services::tokens::Wrapper::push_from(chain, poster)
            .credit(
                token_id,
                Wrapper::SERVICE,
                Quantity::new(amount),
                "fund".to_string().try_into().unwrap(),
            )
            .get()
            .unwrap();
        Wrapper::push_from(chain, poster)
            .csh_fund(token_id, Quantity::new(amount))
            .get()
            .unwrap();
    }

    fn vault_bal(chain: &psibase::Chain, poster: AccountNumber, token_id: u32) -> u64 {
        psibase::services::tokens::Wrapper::push_from(chain, Wrapper::SERVICE)
            .getSubBal(token_id, crate::tables::cash_sub(poster, token_id))
            .get()
            .unwrap()
            .map(|q| q.value)
            .unwrap_or(0)
    }

    /// Pair sub-account `{owner}/{asset}/{token}`.
    fn pair_bal(chain: &psibase::Chain, owner: AccountNumber, asset_id: u16, token_id: u32) -> u64 {
        psibase::services::tokens::Wrapper::push_from(chain, Wrapper::SERVICE)
            .getSubBal(
                token_id,
                crate::tables::relay_sub(owner, asset_id, token_id),
            )
            .get()
            .unwrap()
            .map(|q| q.value)
            .unwrap_or(0)
    }

    /// Credit Banx with memo "relay", then post. The service debits that credit
    /// into the pair sub. A second post of the same pair is rejected.
    fn post_token_pool(
        chain: &psibase::Chain,
        owner: AccountNumber,
        asset_id: u16,
        token_id: u32,
        reserve_banx: u64,
        reserve_tokens: u64,
    ) {
        psibase::services::tokens::Wrapper::push_from(chain, owner)
            .credit(
                token_id,
                Wrapper::SERVICE,
                Quantity::new(reserve_tokens),
                "relay".to_string().try_into().unwrap(),
            )
            .get()
            .unwrap();
        Wrapper::push_from(chain, owner)
            .st_tok_relay(
                asset_id,
                token_id,
                Quantity::new(reserve_banx),
                Quantity::new(reserve_tokens),
            )
            .get()
            .unwrap();
    }

    #[psibase::test_case(packages("Banx"))]
    fn test_cash_out_and_in_gas_usd(chain: psibase::Chain) -> Result<(), psibase::Error> {
        Wrapper::push(&chain).init().get()?;
        let alice = account!("alice");
        let bob = account!("bob");
        chain.new_account(alice).unwrap();
        chain.new_account(bob).unwrap();
        let usd = Asset::get_by_symbol_assert(account!("usd")).id;
        let gas = mint_gas(&chain, bob, bob, 10_000_000);
        fund_vault(&chain, bob, gas, 5_000_000);

        Wrapper::push_from(&chain, bob)
            .st_crd_lne(alice, usd, Quantity::new(1_000_000), false)
            .get()?;
        Wrapper::push_from(&chain, bob)
            .st_csh_qte(
                usd,
                gas,
                true,
                0.into(),
                RATE_SCALE,
                Quantity::new(u64::MAX),
                never(),
            )
            .get()?;
        Wrapper::push_from(&chain, bob)
            .st_csh_qte(
                usd,
                gas,
                false,
                0.into(),
                RATE_SCALE,
                Quantity::new(u64::MAX),
                never(),
            )
            .get()?;

        Wrapper::push_from(&chain, alice)
            .cash_out(
                bob,
                usd,
                gas,
                Quantity::new(1_000_000),
                Quantity::new(1_000_000),
            )
            .get()?;
        assert_eq!(exp(&chain, bob, alice, usd), 1_000_000);
        assert_eq!(shared_from_banx(&chain, gas, alice), 1_000_000);
        assert_eq!(vault_bal(&chain, bob, gas), 4_000_000);
        take_from_banx(&chain, alice, gas, 1_000_000);

        fund_vault(&chain, alice, gas, 1_000_000);
        Wrapper::push_from(&chain, alice)
            .cash_in(
                bob,
                usd,
                gas,
                Quantity::new(1_000_000),
                Quantity::new(1_000_000),
            )
            .get()?;
        assert_eq!(exp(&chain, bob, alice, usd), 0);
        assert_eq!(token_balance(&chain, gas, alice), 0);
        assert_eq!(vault_bal(&chain, alice, gas), 0);
        assert_eq!(vault_bal(&chain, bob, gas), 5_000_000);
        assert_eq!(token_balance(&chain, gas, bob), 5_000_000);
        Ok(())
    }

    #[psibase::test_case(packages("Banx"))]
    fn test_cash_out_non_one_to_one(chain: psibase::Chain) -> Result<(), psibase::Error> {
        Wrapper::push(&chain).init().get()?;
        let alice = account!("alice");
        let bob = account!("bob");
        chain.new_account(alice).unwrap();
        chain.new_account(bob).unwrap();
        let usd = Asset::get_by_symbol_assert(account!("usd")).id;
        let gas = mint_gas(&chain, bob, bob, 10_000_000);
        fund_vault(&chain, bob, gas, 5_000_000);
        // 1 USD raw → 2 gas raw
        let rate = RATE_SCALE * 2;

        Wrapper::push_from(&chain, bob)
            .st_crd_lne(alice, usd, Quantity::new(100_000), false)
            .get()?;
        Wrapper::push_from(&chain, bob)
            .st_csh_qte(
                usd,
                gas,
                true,
                0.into(),
                rate,
                Quantity::new(u64::MAX),
                never(),
            )
            .get()?;

        Wrapper::push_from(&chain, alice)
            .cash_out(
                bob,
                usd,
                gas,
                Quantity::new(100_000),
                Quantity::new(200_000),
            )
            .get()?;
        assert_eq!(exp(&chain, bob, alice, usd), 100_000);
        assert_eq!(shared_from_banx(&chain, gas, alice), 200_000);
        Ok(())
    }

    #[psibase::test_case(packages("Banx"))]
    fn test_cash_in_buys_usd_claim(chain: psibase::Chain) -> Result<(), psibase::Error> {
        Wrapper::push(&chain).init().get()?;
        let alice = account!("alice");
        let bob = account!("bob");
        chain.new_account(alice).unwrap();
        chain.new_account(bob).unwrap();
        enable_auto_debit(&chain, alice);
        let usd = Asset::get_by_symbol_assert(account!("usd")).id;
        let gas = mint_gas(&chain, bob, alice, 500_000);

        Wrapper::push_from(&chain, bob)
            .st_csh_qte(
                usd,
                gas,
                false,
                0.into(),
                RATE_SCALE,
                Quantity::new(u64::MAX),
                never(),
            )
            .get()?;
        fund_vault(&chain, alice, gas, 500_000);
        Wrapper::push_from(&chain, alice)
            .cash_in(
                bob,
                usd,
                gas,
                Quantity::new(500_000),
                Quantity::new(500_000),
            )
            .get()?;
        // Alice paid gas from her vault; Bob owes Alice USD. Gas stays in Bob's vault.
        assert_eq!(exp(&chain, alice, bob, usd), 500_000);
        assert_eq!(vault_bal(&chain, alice, gas), 0);
        assert_eq!(vault_bal(&chain, bob, gas), 500_000);
        assert_eq!(token_balance(&chain, gas, bob), 0);
        Ok(())
    }

    #[psibase::test_case(packages("Banx"))]
    fn test_cash_out_requires_vault(chain: psibase::Chain) -> Result<(), psibase::Error> {
        Wrapper::push(&chain).init().get()?;
        let alice = account!("alice");
        let bob = account!("bob");
        chain.new_account(alice).unwrap();
        chain.new_account(bob).unwrap();
        enable_auto_debit(&chain, alice);
        let usd = Asset::get_by_symbol_assert(account!("usd")).id;
        let gas = mint_gas(&chain, bob, bob, 1_000_000);

        Wrapper::push_from(&chain, bob)
            .st_crd_lne(alice, usd, Quantity::new(100_000), false)
            .get()?;
        Wrapper::push_from(&chain, bob)
            .st_csh_qte(
                usd,
                gas,
                true,
                0.into(),
                RATE_SCALE,
                Quantity::new(u64::MAX),
                never(),
            )
            .get()?;
        let err = Wrapper::push_from(&chain, alice)
            .cash_out(
                bob,
                usd,
                gas,
                Quantity::new(100_000),
                Quantity::new(100_000),
            )
            .get()
            .unwrap_err();
        assert!(
            err.to_string().contains("Insufficient sub-account balance")
                || err.to_string().contains("has no sub-account"),
            "got {err}"
        );
        Ok(())
    }

    #[psibase::test_case(packages("Banx"))]
    fn test_cash_in_requires_vault(chain: psibase::Chain) -> Result<(), psibase::Error> {
        Wrapper::push(&chain).init().get()?;
        let alice = account!("alice");
        let bob = account!("bob");
        chain.new_account(alice).unwrap();
        chain.new_account(bob).unwrap();
        enable_auto_debit(&chain, alice);
        let usd = Asset::get_by_symbol_assert(account!("usd")).id;
        let gas = mint_gas(&chain, bob, alice, 100_000);

        Wrapper::push_from(&chain, bob)
            .st_csh_qte(
                usd,
                gas,
                false,
                0.into(),
                RATE_SCALE,
                Quantity::new(u64::MAX),
                never(),
            )
            .get()?;
        psibase::services::tokens::Wrapper::push_from(&chain, alice)
            .credit(
                gas,
                Wrapper::SERVICE,
                Quantity::new(100_000),
                "no fund".to_string().try_into().unwrap(),
            )
            .get()?;
        let err = Wrapper::push_from(&chain, alice)
            .cash_in(
                bob,
                usd,
                gas,
                Quantity::new(100_000),
                Quantity::new(100_000),
            )
            .get()
            .unwrap_err();
        assert!(
            err.to_string().contains("Insufficient sub-account balance")
                || err.to_string().contains("has no sub-account"),
            "got {err}"
        );
        Ok(())
    }

    #[psibase::test_case(packages("Banx"))]
    fn test_cash_withdraw_returns_tokens(chain: psibase::Chain) -> Result<(), psibase::Error> {
        Wrapper::push(&chain).init().get()?;
        let bob = account!("bob");
        chain.new_account(bob).unwrap();
        let gas = mint_gas(&chain, bob, bob, 1_000_000);
        fund_vault(&chain, bob, gas, 400_000);
        assert_eq!(vault_bal(&chain, bob, gas), 400_000);
        assert_eq!(token_balance(&chain, gas, bob), 600_000);

        Wrapper::push_from(&chain, bob)
            .csh_wd(gas, Quantity::new(400_000))
            .get()?;
        assert_eq!(vault_bal(&chain, bob, gas), 0);
        assert_eq!(shared_from_banx(&chain, gas, bob), 400_000);
        take_from_banx(&chain, bob, gas, 400_000);
        assert_eq!(token_balance(&chain, gas, bob), 1_000_000);
        Ok(())
    }

    /// A cash-out credits the taker. Debiting that credit is the taker's choice.
    #[psibase::test_case(packages("Banx"))]
    fn test_cash_out_credits_without_debit(chain: psibase::Chain) -> Result<(), psibase::Error> {
        Wrapper::push(&chain).init().get()?;
        let alice = account!("alice");
        let bob = account!("bob");
        chain.new_account(alice).unwrap();
        chain.new_account(bob).unwrap();
        let usd = Asset::get_by_symbol_assert(account!("usd")).id;
        let gas = mint_gas(&chain, bob, bob, 1_000_000);
        fund_vault(&chain, bob, gas, 500_000);
        Wrapper::push_from(&chain, bob)
            .st_crd_lne(alice, usd, Quantity::new(100_000), true)
            .get()?;
        Wrapper::push_from(&chain, bob)
            .st_csh_qte(
                usd,
                gas,
                true,
                0.into(),
                RATE_SCALE,
                Quantity::new(100_000),
                never(),
            )
            .get()?;

        Wrapper::push_from(&chain, alice)
            .cash_out(
                bob,
                usd,
                gas,
                Quantity::new(100_000),
                Quantity::new(100_000),
            )
            .get()?;
        assert_eq!(exp(&chain, bob, alice, usd), 100_000);
        assert_eq!(shared_from_banx(&chain, gas, alice), 100_000);
        assert_eq!(token_balance(&chain, gas, alice), 0);
        assert_eq!(vault_bal(&chain, bob, gas), 400_000);
        assert_eq!(Pair::line(bob, alice, usd).unwrap().remaining.value, 0);
        assert_eq!(
            CashQuote::get_assert(bob, usd, gas, true).remaining.value,
            0
        );
        Ok(())
    }

    /// Withdrawing the vault credits the poster even when auto-debit is off.
    #[psibase::test_case(packages("Banx"))]
    fn test_cash_withdraw_credits_without_debit(
        chain: psibase::Chain,
    ) -> Result<(), psibase::Error> {
        Wrapper::push(&chain).init().get()?;
        let bob = account!("bob");
        chain.new_account(bob).unwrap();
        let gas = mint_gas(&chain, bob, bob, 1_000_000);
        fund_vault(&chain, bob, gas, 400_000);
        psibase::services::tokens::Wrapper::push_from(&chain, bob)
            .setUserConf(
                psibase::services::tokens::BalanceFlags::AUTO_DEBIT.index(),
                false,
            )
            .get()?;

        Wrapper::push_from(&chain, bob)
            .csh_wd(gas, Quantity::new(400_000))
            .get()?;
        assert_eq!(vault_bal(&chain, bob, gas), 0);
        assert_eq!(shared_from_banx(&chain, gas, bob), 400_000);
        assert_eq!(token_balance(&chain, gas, bob), 600_000);
        Ok(())
    }

    #[psibase::test_case(packages("Banx"))]
    fn test_cash_james_friends(chain: psibase::Chain) -> Result<(), psibase::Error> {
        Wrapper::push(&chain).init().get()?;
        let james = account!("james");
        chain.new_account(james).unwrap();
        let gas = mint_gas(&chain, james, james, 1_000_000);
        fund_vault(&chain, james, gas, 400_000);
        assert_eq!(vault_bal(&chain, james, gas), 400_000);
        assert_eq!(token_balance(&chain, gas, james), 600_000);

        // james friend Bob comes along
        let bob = account!("bob");
        chain.new_account(bob).unwrap();

        let usd = Asset::get_by_symbol_assert(account!("usd")).id;
        // Out: 1 USD → 0.1 gas. Fair reverse is 1 gas → 10 USD.
        let out_rate = RATE_SCALE / 10;
        // In: 1 gas → 9 USD (10% worse than the reverse).
        let in_rate = RATE_SCALE * 9;

        // James lists a rate he's willing to sell his gas tokens for USD.
        Wrapper::push_from(&chain, james)
            .st_csh_qte(
                usd,
                gas,
                true,
                0.into(),
                out_rate,
                Quantity::new(u64::MAX),
                never(),
            )
            .get()?;

        // James gives his friend Bob a credit line so he can access funds
        Wrapper::push_from(&chain, james)
            .st_crd_lne(bob, usd, 10_000.into(), false)
            .get()?;

        // Bob can now access the gas token with only his credit line
        Wrapper::push_from(&chain, bob)
            .cash_out(james, usd, gas, 5_000.into(), 500.into())
            .get()?;

        assert_eq!(shared_from_banx(&chain, gas, bob), 500);
        assert_eq!(exp(&chain, james, bob, usd), 5_000);
        assert_eq!(vault_bal(&chain, james, gas), 399_500);
        take_from_banx(&chain, bob, gas, 500);

        // James allows his friend to send it back, but only at a 10% worse rate.
        Wrapper::push_from(&chain, james)
            .st_csh_qte(
                usd,
                gas,
                false,
                0.into(),
                in_rate,
                Quantity::new(u64::MAX),
                never(),
            )
            .get()?;

        fund_vault(&chain, bob, gas, 500);

        Wrapper::push_from(&chain, bob)
            .cash_in(james, usd, gas, 500.into(), 4_500.into())
            .get()?;

        assert_eq!(token_balance(&chain, gas, bob), 0);
        assert_eq!(vault_bal(&chain, bob, gas), 0);
        assert_eq!(vault_bal(&chain, james, gas), 400_000);
        assert_eq!(exp(&chain, james, bob, usd), 500);

        Ok(())
    }

    fn invite_payload(seed: u8) -> Vec<u8> {
        psibase::services::invite::InvPayload {
            fingerprint: vec![seed; 32],
            secret: String::new(),
        }
        .packed()
    }

    #[psibase::test_case(packages("Banx"))]
    fn test_invite_claim_extends_credit_line(chain: psibase::Chain) -> Result<(), psibase::Error> {
        Wrapper::push(&chain).init().get()?;

        let alice = account!("alice");
        let bob = account!("bob");
        let carol = account!("carol");
        chain.new_account(alice).unwrap();
        chain.new_account(bob).unwrap();
        chain.new_account(carol).unwrap();

        let usd = Asset::get_by_symbol_assert(account!("usd")).id;
        let invite_id = 42u32;
        let limit = Quantity::new(10_000);

        Wrapper::push_from(&chain, alice)
            .cr_invite(invite_id, invite_payload(1), 1, usd, limit, false)
            .get()?;

        let stored = BanxInvite::get_assert(invite_id);
        assert_eq!(stored.inviter, alice);
        assert_eq!(stored.asset_id, usd);
        assert_eq!(stored.limit.value, limit.value);
        assert_eq!(BanxInvite::list_by_inviter(alice).len(), 1);
        assert!(Pair::line(alice, bob, usd).is_none());

        Wrapper::push_from(&chain, psibase::services::invite::Wrapper::SERVICE)
            .onInvAccept(invite_id, bob)
            .get()?;

        let line = Pair::line(alice, bob, usd).unwrap();
        assert_eq!(line.limit.value, limit.value);
        assert!(!line.deplete_on_debit);

        // The hook sender is invite. The row still names Alice, who lined Bob.
        let lines = activity_nodes(&chain, alice)
            .into_iter()
            .filter(|row| row.get("kind").and_then(|k| k.as_str()) == Some("credit_line"))
            .collect::<Vec<_>>();
        assert!(
            !lines.is_empty()
                && lines
                    .iter()
                    .all(|row| row.get("actor").and_then(|a| a.as_str()) == Some("alice")),
            "invite hook recorded the submitter, not the inviter: {lines:?}"
        );
        let stored = BanxInvite::get_assert(invite_id);
        assert_eq!(stored.claimed_by, Some(bob));
        assert_eq!(BanxInvite::list_by_inviter(alice).len(), 1);

        Wrapper::push_from(&chain, psibase::services::invite::Wrapper::SERVICE)
            .onInvAccept(invite_id, bob)
            .get()?;
        assert_eq!(
            Pair::line(alice, bob, usd).unwrap().limit.value,
            limit.value
        );
        assert_eq!(BanxInvite::get_assert(invite_id).claimed_by, Some(bob));

        Wrapper::push_from(&chain, psibase::services::invite::Wrapper::SERVICE)
            .onInvAccept(invite_id, carol)
            .get()?;
        assert!(Pair::line(alice, carol, usd).is_none());
        assert_eq!(BanxInvite::get_assert(invite_id).claimed_by, Some(bob));

        Ok(())
    }

    #[psibase::test_case(packages("Banx"))]
    fn test_invite_claim_skips_existing_credit_line(
        chain: psibase::Chain,
    ) -> Result<(), psibase::Error> {
        Wrapper::push(&chain).init().get()?;

        let alice = account!("alice");
        let bob = account!("bob");
        let carol = account!("carol");
        chain.new_account(alice).unwrap();
        chain.new_account(bob).unwrap();
        chain.new_account(carol).unwrap();

        let usd = Asset::get_by_symbol_assert(account!("usd")).id;
        Wrapper::push_from(&chain, alice)
            .st_crd_lne(bob, usd, Quantity::new(1), true)
            .get()?;

        let invite_id = 7u32;
        Wrapper::push_from(&chain, alice)
            .cr_invite(
                invite_id,
                invite_payload(2),
                1,
                usd,
                Quantity::new(99_000),
                false,
            )
            .get()?;

        Wrapper::push_from(&chain, psibase::services::invite::Wrapper::SERVICE)
            .onInvAccept(invite_id, bob)
            .get()?;

        let line = Pair::line(alice, bob, usd).unwrap();
        assert_eq!(line.limit.value, 1);
        assert!(line.deplete_on_debit);

        assert_eq!(BanxInvite::get_assert(invite_id).claimed_by, Some(bob));

        Wrapper::push_from(&chain, psibase::services::invite::Wrapper::SERVICE)
            .onInvAccept(invite_id, carol)
            .get()?;
        assert!(Pair::line(alice, carol, usd).is_none());
        assert_eq!(BanxInvite::get_assert(invite_id).claimed_by, Some(bob));

        Ok(())
    }

    #[psibase::test_case(packages("Banx"))]
    fn test_invite_rejects_num_accounts_other_than_one(
        chain: psibase::Chain,
    ) -> Result<(), psibase::Error> {
        Wrapper::push(&chain).init().get()?;

        let alice = account!("alice");
        chain.new_account(alice).unwrap();

        let usd = Asset::get_by_symbol_assert(account!("usd")).id;
        let result = Wrapper::push_from(&chain, alice)
            .cr_invite(1, invite_payload(5), 2, usd, Quantity::new(5_000), false)
            .get();
        assert!(result.is_err());
        assert!(BanxInvite::list_by_inviter(alice).is_empty());

        Ok(())
    }

    #[psibase::test_case(packages("Banx"))]
    fn test_invite_hook_rejects_non_invite_sender(
        chain: psibase::Chain,
    ) -> Result<(), psibase::Error> {
        Wrapper::push(&chain).init().get()?;

        let alice = account!("alice");
        let bob = account!("bob");
        chain.new_account(alice).unwrap();
        chain.new_account(bob).unwrap();

        let usd = Asset::get_by_symbol_assert(account!("usd")).id;
        let invite_id = 9u32;
        Wrapper::push_from(&chain, alice)
            .cr_invite(
                invite_id,
                invite_payload(3),
                1,
                usd,
                Quantity::new(5_000),
                false,
            )
            .get()?;

        let result = Wrapper::push_from(&chain, alice)
            .onInvAccept(invite_id, bob)
            .get();
        assert!(result.is_err());
        assert!(Pair::line(alice, bob, usd).is_none());

        Ok(())
    }

    #[psibase::test_case(packages("Banx"))]
    fn test_invite_revoke(chain: psibase::Chain) -> Result<(), psibase::Error> {
        Wrapper::push(&chain).init().get()?;

        let alice = account!("alice");
        let bob = account!("bob");
        chain.new_account(alice).unwrap();
        chain.new_account(bob).unwrap();

        let usd = Asset::get_by_symbol_assert(account!("usd")).id;
        let invite_id = 11u32;
        Wrapper::push_from(&chain, alice)
            .cr_invite(
                invite_id,
                invite_payload(4),
                1,
                usd,
                Quantity::new(5_000),
                false,
            )
            .get()?;

        let result = Wrapper::push_from(&chain, bob).rm_invite(invite_id).get();
        assert!(result.is_err());

        Wrapper::push_from(&chain, alice)
            .rm_invite(invite_id)
            .get()?;
        assert!(BanxInviteTable::read()
            .get_index_pk()
            .get(&invite_id)
            .is_none());

        Wrapper::push_from(&chain, psibase::services::invite::Wrapper::SERVICE)
            .onInvAccept(invite_id, bob)
            .get()?;
        assert!(Pair::line(alice, bob, usd).is_none());

        Ok(())
    }

    #[psibase::test_case(packages("Banx"))]
    fn test_invite_rm_after_claim(chain: psibase::Chain) -> Result<(), psibase::Error> {
        Wrapper::push(&chain).init().get()?;

        let alice = account!("alice");
        let bob = account!("bob");
        chain.new_account(alice).unwrap();
        chain.new_account(bob).unwrap();

        let usd = Asset::get_by_symbol_assert(account!("usd")).id;
        let invite_id = 13u32;
        Wrapper::push_from(&chain, alice)
            .cr_invite(
                invite_id,
                invite_payload(6),
                1,
                usd,
                Quantity::new(5_000),
                false,
            )
            .get()?;

        Wrapper::push_from(&chain, psibase::services::invite::Wrapper::SERVICE)
            .onInvAccept(invite_id, bob)
            .get()?;
        assert_eq!(BanxInvite::get_assert(invite_id).claimed_by, Some(bob));

        Wrapper::push_from(&chain, alice)
            .rm_invite(invite_id)
            .get()?;
        assert!(BanxInviteTable::read()
            .get_index_pk()
            .get(&invite_id)
            .is_none());
        assert_eq!(Pair::line(alice, bob, usd).unwrap().limit.value, 5_000);

        Ok(())
    }

    #[psibase::test_case(packages("Banx"))]
    fn test_book_auth_creditor_books_deposit(chain: psibase::Chain) -> Result<(), psibase::Error> {
        Wrapper::push(&chain).init().get()?;
        let alice = account!("alice");
        let bob = account!("bob");
        chain.new_account(alice).unwrap();
        chain.new_account(bob).unwrap();
        let usd = Asset::get_by_symbol_assert(account!("usd")).id;

        Wrapper::push_from(&chain, alice)
            .st_bk_ath(bob, usd, Quantity::new(10_000), never())
            .get()?;
        let auth = BookAuth::get_assert(alice, bob, usd);
        assert_eq!(auth.remaining.value, 10_000);

        Wrapper::push_from(&chain, bob)
            .book(alice, usd, Quantity::new(3_000), "dinner".into())
            .get()?;
        assert_eq!(exp(&chain, bob, alice, usd), 3_000);
        assert_eq!(BookAuth::get_assert(alice, bob, usd).remaining.value, 7_000);

        Ok(())
    }

    #[psibase::test_case(packages("Banx"))]
    fn test_book_auth_revoke_and_expiry(chain: psibase::Chain) -> Result<(), psibase::Error> {
        Wrapper::push(&chain).init().get()?;
        let alice = account!("alice");
        let bob = account!("bob");
        chain.new_account(alice).unwrap();
        chain.new_account(bob).unwrap();
        let usd = Asset::get_by_symbol_assert(account!("usd")).id;

        Wrapper::push_from(&chain, alice)
            .st_bk_ath(bob, usd, Quantity::new(5_000), never())
            .get()?;
        Wrapper::push_from(&chain, bob)
            .book(alice, usd, Quantity::new(100), "".into())
            .get()?;
        assert_eq!(exp(&chain, bob, alice, usd), 100);

        Wrapper::push_from(&chain, alice)
            .rm_bk_ath(bob, usd)
            .get()?;
        assert!(BookAuth::get(alice, bob, usd).is_none());
        assert!(Wrapper::push_from(&chain, bob)
            .book(alice, usd, Quantity::new(100), "".into())
            .get()
            .is_err());

        Wrapper::push_from(&chain, alice)
            .st_bk_ath(bob, usd, Quantity::new(5_000), TimePointSec { seconds: 1 })
            .get()?;
        assert!(Wrapper::push_from(&chain, bob)
            .book(alice, usd, Quantity::new(100), "".into())
            .get()
            .is_err());

        Ok(())
    }

    #[psibase::test_case(packages("Banx"))]
    fn test_book_auth_nets_reverse(chain: psibase::Chain) -> Result<(), psibase::Error> {
        Wrapper::push(&chain).init().get()?;
        let alice = account!("alice");
        let bob = account!("bob");
        chain.new_account(alice).unwrap();
        chain.new_account(bob).unwrap();
        let usd = Asset::get_by_symbol_assert(account!("usd")).id;

        Wrapper::push_from(&chain, bob)
            .deposit(alice, usd, Quantity::new(2_000), 0)
            .get()?;
        assert_eq!(exp(&chain, alice, bob, usd), 2_000);

        Wrapper::push_from(&chain, alice)
            .st_bk_ath(bob, usd, Quantity::new(5_000), never())
            .get()?;
        Wrapper::push_from(&chain, bob)
            .book(alice, usd, Quantity::new(2_000), "tab".into())
            .get()?;
        assert_eq!(exp(&chain, alice, bob, usd), 0);
        assert_eq!(exp(&chain, bob, alice, usd), 0);

        Ok(())
    }

    /// A claim offer's face budget is spent on each take and stays at 0 so it
    /// can be topped up. The line cap is separate.
    #[psibase::test_case(packages("Banx"))]
    fn test_claim_offer_remaining_caps_and_tops_up(
        chain: psibase::Chain,
    ) -> Result<(), psibase::Error> {
        Wrapper::push(&chain).init().get()?;
        let alice = account!("alice");
        let bob = account!("bob");
        let peter = account!("peter");
        chain.new_account(alice).unwrap();
        chain.new_account(bob).unwrap();
        chain.new_account(peter).unwrap();
        let usd = Asset::get_by_symbol_assert(account!("usd")).id;

        Wrapper::push_from(&chain, bob)
            .deposit(alice, usd, Quantity::new(1_000), 0)
            .get()?;
        Wrapper::push_from(&chain, peter)
            .st_crd_lne(bob, usd, Quantity::new(1_000), false)
            .get()?;
        Wrapper::push_from(&chain, bob)
            .st_crd_lne(peter, usd, Quantity::new(0), false)
            .get()?;
        assert!(Wrapper::push_from(&chain, peter)
            .st_glb_buy(usd, Quantity::new(0), 0, Quantity::new(0), never())
            .get()
            .is_err());
        Wrapper::push_from(&chain, peter)
            .st_glb_buy(usd, Quantity::new(0), 0, Quantity::new(400), never())
            .get()?;

        assert!(Wrapper::push_from(&chain, alice)
            .sell_claim(peter, bob, usd, Quantity::new(401), Quantity::new(0))
            .get()
            .is_err());
        Wrapper::push_from(&chain, alice)
            .sell_claim(peter, bob, usd, Quantity::new(400), Quantity::new(0))
            .get()?;
        assert_eq!(
            ClaimOffer::get_assert(peter, ClaimOffer::GLOBAL, usd, ClaimOffer::BUY)
                .remaining
                .value,
            0
        );
        assert!(Wrapper::push_from(&chain, alice)
            .sell_claim(peter, bob, usd, Quantity::new(1), Quantity::new(0))
            .get()
            .is_err());

        Wrapper::push_from(&chain, peter)
            .st_glb_buy(usd, Quantity::new(0), 0, Quantity::new(600), never())
            .get()?;
        Wrapper::push_from(&chain, alice)
            .sell_claim(peter, bob, usd, Quantity::new(600), Quantity::new(0))
            .get()?;
        assert_eq!(exp(&chain, alice, bob, usd), 0);
        assert_eq!(exp(&chain, peter, bob, usd), 1_000);
        assert_eq!(
            ClaimOffer::get_assert(peter, ClaimOffer::GLOBAL, usd, ClaimOffer::BUY)
                .remaining
                .value,
            0
        );
        Ok(())
    }

    /// Cash quotes spend the taker's input and keep a zero row for a top-up.
    #[psibase::test_case(packages("Banx"))]
    fn test_cash_quote_remaining_caps_and_tops_up(
        chain: psibase::Chain,
    ) -> Result<(), psibase::Error> {
        Wrapper::push(&chain).init().get()?;
        let alice = account!("alice");
        let bob = account!("bob");
        chain.new_account(alice).unwrap();
        chain.new_account(bob).unwrap();
        let usd = Asset::get_by_symbol_assert(account!("usd")).id;
        let gas = mint_gas(&chain, bob, bob, 1_000);
        fund_vault(&chain, bob, gas, 1_000);
        Wrapper::push_from(&chain, bob)
            .st_crd_lne(alice, usd, Quantity::new(1_000), false)
            .get()?;
        assert!(Wrapper::push_from(&chain, bob)
            .st_csh_qte(
                usd,
                gas,
                true,
                0.into(),
                RATE_SCALE,
                Quantity::new(0),
                never(),
            )
            .get()
            .is_err());
        Wrapper::push_from(&chain, bob)
            .st_csh_qte(
                usd,
                gas,
                true,
                0.into(),
                RATE_SCALE,
                Quantity::new(100),
                never(),
            )
            .get()?;

        assert!(Wrapper::push_from(&chain, alice)
            .cash_out(bob, usd, gas, Quantity::new(101), Quantity::new(0),)
            .get()
            .is_err());
        Wrapper::push_from(&chain, alice)
            .cash_out(bob, usd, gas, Quantity::new(100), Quantity::new(100))
            .get()?;
        assert_eq!(
            CashQuote::get_assert(bob, usd, gas, true).remaining.value,
            0
        );
        assert!(Wrapper::push_from(&chain, alice)
            .cash_out(bob, usd, gas, Quantity::new(1), Quantity::new(0))
            .get()
            .is_err());

        Wrapper::push_from(&chain, bob)
            .st_csh_qte(
                usd,
                gas,
                true,
                0.into(),
                RATE_SCALE,
                Quantity::new(50),
                never(),
            )
            .get()?;
        Wrapper::push_from(&chain, alice)
            .cash_out(bob, usd, gas, Quantity::new(50), Quantity::new(50))
            .get()?;
        assert_eq!(exp(&chain, bob, alice, usd), 150);
        assert_eq!(
            CashQuote::get_assert(bob, usd, gas, true).remaining.value,
            0
        );
        assert_eq!(shared_from_banx(&chain, gas, alice), 150);
        take_from_banx(&chain, alice, gas, 150);

        fund_vault(&chain, alice, gas, 80);
        Wrapper::push_from(&chain, bob)
            .st_csh_qte(
                usd,
                gas,
                false,
                0.into(),
                RATE_SCALE,
                Quantity::new(80),
                never(),
            )
            .get()?;
        assert!(Wrapper::push_from(&chain, alice)
            .cash_in(bob, usd, gas, Quantity::new(81), Quantity::new(0))
            .get()
            .is_err());
        Wrapper::push_from(&chain, alice)
            .cash_in(bob, usd, gas, Quantity::new(80), Quantity::new(80))
            .get()?;
        assert_eq!(
            CashQuote::get_assert(bob, usd, gas, false).remaining.value,
            0
        );
        Ok(())
    }

    fn pin(chain: &psibase::Chain, seconds: i64) {
        chain.start_block_at(TimePointUSec {
            microseconds: seconds * 1_000_000,
        });
    }

    fn pay_row(id: u32) -> PayAuth {
        PayAuthTab::read().get_index_pk().get(&id).unwrap()
    }

    fn schedule(
        chain: &psibase::Chain,
        payer: AccountNumber,
        payee: AccountNumber,
        asset: u16,
        amount: u64,
        max_spend: u64,
        period: u32,
        next_due: i64,
        ends_at: i64,
    ) -> u32 {
        Wrapper::push_from(chain, payer)
            .st_pay_ath(
                payee,
                asset,
                Quantity::new(amount),
                Quantity::new(max_spend),
                period,
                TimePointSec { seconds: next_due },
                TimePointSec { seconds: ends_at },
            )
            .get()
            .unwrap()
    }

    #[psibase::test_case(packages("Banx"))]
    fn test_pay_auth_create_rejects(chain: psibase::Chain) -> Result<(), psibase::Error> {
        Wrapper::push(&chain).init().get()?;
        assert_eq!(
            InitTable::read()
                .get_index_pk()
                .get(&())
                .unwrap()
                .next_pay_auth_id,
            1
        );
        let alice = account!("alice");
        let bob = account!("bob");
        chain.new_account(alice).unwrap();
        chain.new_account(bob).unwrap();
        let usd = Asset::get_by_symbol_assert(account!("usd")).id;
        let now = TimePointSec {
            seconds: 1_700_000_000,
        };
        pin(&chain, now.seconds);

        let rejected = Wrapper::push_from(&chain, alice).st_pay_ath(
            alice,
            usd,
            Quantity::new(100),
            Quantity::new(100),
            100,
            now,
            never(),
        );
        assert!(rejected.get().is_err());

        let rejected = Wrapper::push_from(&chain, alice).st_pay_ath(
            bob,
            usd,
            Quantity::new(0),
            Quantity::new(100),
            100,
            now,
            never(),
        );
        assert!(rejected.get().is_err());

        let rejected = Wrapper::push_from(&chain, alice).st_pay_ath(
            bob,
            usd,
            Quantity::new(100),
            Quantity::new(50),
            100,
            now,
            never(),
        );
        assert!(rejected.get().is_err());

        let rejected = Wrapper::push_from(&chain, alice).st_pay_ath(
            bob,
            usd,
            Quantity::new(100),
            Quantity::new(100),
            0,
            now,
            never(),
        );
        assert!(rejected.get().is_err());

        Ok(())
    }

    #[psibase::test_case(packages("Banx"))]
    fn test_pay_auth_pays_due_period_without_sliding(
        chain: psibase::Chain,
    ) -> Result<(), psibase::Error> {
        Wrapper::push(&chain).init().get()?;
        let alice = account!("alice");
        let bob = account!("bob");
        chain.new_account(alice).unwrap();
        chain.new_account(bob).unwrap();
        let usd = Asset::get_by_symbol_assert(account!("usd")).id;
        Wrapper::push_from(&chain, bob)
            .st_crd_lne(alice, usd, Quantity::new(10_000), false)
            .get()?;

        const START: i64 = 1_700_000_000;
        pin(&chain, START);
        let id = schedule(&chain, alice, bob, usd, 100, 100, 100, START, 0);
        assert_eq!(id, 1);

        pin(&chain, START + 40);
        Wrapper::push_from(&chain, alice)
            .run_pay_ath(id, seal_auth(&chain, alice, vec![hop(bob, usd)], id))
            .get()?;
        assert_eq!(exp(&chain, bob, alice, usd), 100);
        assert_eq!(pay_row(id).next_due.seconds, START + 100);

        let early = Wrapper::push_from(&chain, alice)
            .run_pay_ath(id, seal_auth(&chain, alice, vec![hop(bob, usd)], id));
        assert!(early.get().is_err());
        assert_eq!(pay_row(id).next_due.seconds, START + 100);
        assert_eq!(exp(&chain, bob, alice, usd), 100);
        Ok(())
    }

    #[psibase::test_case(packages("Banx"))]
    fn test_pay_auth_stacked_periods_pay_one_at_a_time(
        chain: psibase::Chain,
    ) -> Result<(), psibase::Error> {
        Wrapper::push(&chain).init().get()?;
        let alice = account!("alice");
        let bob = account!("bob");
        chain.new_account(alice).unwrap();
        chain.new_account(bob).unwrap();
        let usd = Asset::get_by_symbol_assert(account!("usd")).id;
        Wrapper::push_from(&chain, bob)
            .st_crd_lne(alice, usd, Quantity::new(10_000), false)
            .get()?;

        const START: i64 = 1_700_000_000;
        pin(&chain, START);
        let id = schedule(&chain, alice, bob, usd, 100, 100, 100, START - 250, 0);

        Wrapper::push_from(&chain, alice)
            .run_pay_ath(id, seal_auth(&chain, alice, vec![hop(bob, usd)], id))
            .get()?;
        assert_eq!(exp(&chain, bob, alice, usd), 100);
        assert_eq!(pay_row(id).next_due.seconds, START - 150);

        Wrapper::push_from(&chain, alice)
            .run_pay_ath(id, seal_auth(&chain, alice, vec![hop(bob, usd)], id))
            .get()?;
        assert_eq!(exp(&chain, bob, alice, usd), 200);
        assert_eq!(pay_row(id).next_due.seconds, START - 50);

        Wrapper::push_from(&chain, alice)
            .run_pay_ath(id, seal_auth(&chain, alice, vec![hop(bob, usd)], id))
            .get()?;
        assert_eq!(exp(&chain, bob, alice, usd), 300);
        assert_eq!(pay_row(id).next_due.seconds, START + 50);

        let extra = Wrapper::push_from(&chain, alice)
            .run_pay_ath(id, seal_auth(&chain, alice, vec![hop(bob, usd)], id));
        assert!(extra.get().is_err());
        assert_eq!(exp(&chain, bob, alice, usd), 300);
        assert_eq!(pay_row(id).next_due.seconds, START + 50);
        Ok(())
    }

    #[psibase::test_case(packages("Banx"))]
    fn test_pay_auth_rejects_bad_path(chain: psibase::Chain) -> Result<(), psibase::Error> {
        Wrapper::push(&chain).init().get()?;
        let alice = account!("alice");
        let bob = account!("bob");
        let carol = account!("carol");
        let dave = account!("dave");
        chain.new_account(alice).unwrap();
        chain.new_account(bob).unwrap();
        chain.new_account(carol).unwrap();
        chain.new_account(dave).unwrap();
        let usd = Asset::get_by_symbol_assert(account!("usd")).id;
        let aud = Asset::get_by_symbol_assert(account!("aud")).id;

        Wrapper::push_from(&chain, dave)
            .st_crd_lne(alice, usd, Quantity::new(10_000), false)
            .get()?;
        Wrapper::push_from(&chain, bob)
            .st_crd_lne(dave, usd, Quantity::new(10_000), false)
            .get()?;
        Wrapper::push_from(&chain, dave)
            .st_fwd_ofr(bob, usd, Quantity::new(10), 0, never(), true)
            .get()?;

        const START: i64 = 1_700_000_000;
        pin(&chain, START);
        let id = schedule(&chain, alice, bob, usd, 100, 100, 100, START, 0);

        let wrong_payee = Wrapper::push_from(&chain, alice)
            .run_pay_ath(id, seal_auth(&chain, alice, vec![hop(carol, usd)], id));
        assert!(wrong_payee.get().is_err());
        let wrong_asset = Wrapper::push_from(&chain, alice)
            .run_pay_ath(id, seal_auth(&chain, alice, vec![hop(bob, aud)], id));
        assert!(wrong_asset.get().is_err());
        let over_ceiling = Wrapper::push_from(&chain, alice).run_pay_ath(
            id,
            seal_auth(&chain, alice, vec![hop(dave, usd), hop(bob, usd)], id),
        );
        assert!(over_ceiling.get().is_err());

        assert_eq!(pay_row(id).next_due.seconds, START);
        assert_eq!(exp(&chain, dave, alice, usd), 0);
        assert_eq!(exp(&chain, bob, dave, usd), 0);
        assert_eq!(exp(&chain, bob, alice, usd), 0);
        Ok(())
    }

    #[psibase::test_case(packages("Banx"))]
    fn test_pay_auth_payee_runs_third_party_cannot(
        chain: psibase::Chain,
    ) -> Result<(), psibase::Error> {
        Wrapper::push(&chain).init().get()?;
        let alice = account!("alice");
        let bob = account!("bob");
        let carol = account!("carol");
        chain.new_account(alice).unwrap();
        chain.new_account(bob).unwrap();
        chain.new_account(carol).unwrap();
        let usd = Asset::get_by_symbol_assert(account!("usd")).id;
        Wrapper::push_from(&chain, bob)
            .st_crd_lne(alice, usd, Quantity::new(10_000), false)
            .get()?;

        const START: i64 = 1_700_000_000;
        pin(&chain, START);
        let id = schedule(&chain, alice, bob, usd, 100, 100, 100, START, 0);

        let third = Wrapper::push_from(&chain, carol)
            .run_pay_ath(id, seal_auth(&chain, carol, vec![hop(bob, usd)], id));
        assert!(third.get().is_err());
        let third_cancel = Wrapper::push_from(&chain, carol).rm_pay_ath(id, true);
        assert!(third_cancel.get().is_err());
        assert_eq!(pay_row(id).next_due.seconds, START);

        Wrapper::push_from(&chain, bob)
            .run_pay_ath(id, seal_auth(&chain, alice, vec![hop(bob, usd)], id))
            .get()?;
        assert_eq!(exp(&chain, bob, alice, usd), 100);
        assert_eq!(exp(&chain, alice, bob, usd), 0);
        // Bob submitted. The hop still names Alice, who was drawn.
        let draws = activity_nodes(&chain, alice)
            .into_iter()
            .filter(|row| row.get("kind").and_then(|k| k.as_str()) == Some("path_draw"))
            .collect::<Vec<_>>();
        assert!(!draws.is_empty(), "payee-run emitted no path_draw rows");
        assert!(
            draws
                .iter()
                .all(|row| row.get("actor").and_then(|a| a.as_str()) == Some("alice")),
            "path_draw recorded the submitter, not the payer: {draws:?}"
        );
        Ok(())
    }

    /// Bob runs Alice's payment through Carol. Alice's feed only has hop 0.
    /// Carol's copy is the hop that drew her line, and that row still names Alice.
    #[psibase::test_case(packages("Banx"))]
    fn test_pay_auth_payee_runs_later_hop_names_payer(
        chain: psibase::Chain,
    ) -> Result<(), psibase::Error> {
        Wrapper::push(&chain).init().get()?;
        let alice = account!("alice");
        let bob = account!("bob");
        let carol = account!("carol");
        chain.new_account(alice).unwrap();
        chain.new_account(bob).unwrap();
        chain.new_account(carol).unwrap();
        let usd = Asset::get_by_symbol_assert(account!("usd")).id;

        Wrapper::push_from(&chain, carol)
            .st_crd_lne(alice, usd, Quantity::new(10_000), false)
            .get()?;
        Wrapper::push_from(&chain, bob)
            .st_crd_lne(carol, usd, Quantity::new(10_000), false)
            .get()?;
        Wrapper::push_from(&chain, carol)
            .st_fwd_ofr(bob, usd, Quantity::new(0), 0, never(), true)
            .get()?;

        const START: i64 = 1_700_000_000;
        pin(&chain, START);
        let id = schedule(&chain, alice, bob, usd, 100, 100, 100, START, 0);

        Wrapper::push_from(&chain, bob)
            .run_pay_ath(
                id,
                seal_auth(&chain, alice, vec![hop(carol, usd), hop(bob, usd)], id),
            )
            .get()?;
        assert_eq!(exp(&chain, carol, alice, usd), 100);
        assert_eq!(exp(&chain, bob, carol, usd), 100);
        assert_eq!(exp(&chain, bob, alice, usd), 0);

        let mut draws = Vec::new();
        for who in [alice, carol, bob] {
            draws.extend(
                activity_nodes(&chain, who)
                    .into_iter()
                    .filter(|row| row.get("kind").and_then(|k| k.as_str()) == Some("path_draw")),
            );
        }
        assert!(
            !draws.is_empty(),
            "payee-run through a middle hop emitted no path_draw rows"
        );
        assert!(
            draws
                .iter()
                .all(|row| row.get("actor").and_then(|a| a.as_str()) == Some("alice")),
            "a later hop named the middleman or the submitter, not the payer: {draws:?}"
        );
        let carol_hops = activity_nodes(&chain, carol)
            .into_iter()
            .filter(|row| row.get("kind").and_then(|k| k.as_str()) == Some("path_draw"))
            .collect::<Vec<_>>();
        assert_eq!(
            carol_hops.len(),
            2,
            "Carol should see both hops: {carol_hops:?}"
        );
        assert!(
            carol_hops.iter().any(|row| {
                row.get("counterparty").and_then(|c| c.as_str()) == Some("bob")
                    && row.get("actor").and_then(|a| a.as_str()) == Some("alice")
            }),
            "the hop that drew Carol named someone else: {carol_hops:?}"
        );
        Ok(())
    }

    #[psibase::test_case(packages("Banx"))]
    fn test_pay_auth_cancel_deletes_without_paying(
        chain: psibase::Chain,
    ) -> Result<(), psibase::Error> {
        Wrapper::push(&chain).init().get()?;
        let alice = account!("alice");
        let bob = account!("bob");
        chain.new_account(alice).unwrap();
        chain.new_account(bob).unwrap();
        let usd = Asset::get_by_symbol_assert(account!("usd")).id;
        Wrapper::push_from(&chain, bob)
            .st_crd_lne(alice, usd, Quantity::new(10_000), false)
            .get()?;

        const START: i64 = 1_700_000_000;
        pin(&chain, START);
        let due = schedule(&chain, alice, bob, usd, 100, 100, 100, START, 0);
        let blocked = Wrapper::push_from(&chain, alice).rm_pay_ath(due, false);
        assert!(blocked.get().is_err());
        assert!(pay_row(due).id == due);
        assert_eq!(exp(&chain, bob, alice, usd), 0);

        Wrapper::push_from(&chain, bob)
            .rm_pay_ath(due, true)
            .get()?;
        assert!(PayAuth::get(due).is_none());
        assert_eq!(exp(&chain, bob, alice, usd), 0);
        let gone = Wrapper::push_from(&chain, alice)
            .run_pay_ath(due, seal_auth(&chain, alice, vec![hop(bob, usd)], due));
        assert!(gone.get().is_err());

        let payer_cancels = schedule(&chain, alice, bob, usd, 100, 100, 100, START + 500, 0);
        Wrapper::push_from(&chain, alice)
            .rm_pay_ath(payer_cancels, false)
            .get()?;
        assert!(PayAuth::get(payer_cancels).is_none());

        let payee_cancels = schedule(&chain, alice, bob, usd, 100, 100, 100, START + 500, 0);
        Wrapper::push_from(&chain, bob)
            .rm_pay_ath(payee_cancels, false)
            .get()?;
        assert!(PayAuth::get(payee_cancels).is_none());

        let ending = schedule(&chain, alice, bob, usd, 100, 100, 100, START, START + 50);
        Wrapper::push_from(&chain, alice)
            .run_pay_ath(
                ending,
                seal_auth(&chain, alice, vec![hop(bob, usd)], ending),
            )
            .get()?;
        assert_eq!(pay_row(ending).next_due.seconds, START + 100);
        let after_end = Wrapper::push_from(&chain, alice).run_pay_ath(
            ending,
            seal_auth(&chain, alice, vec![hop(bob, usd)], ending),
        );
        assert!(after_end.get().is_err());
        Wrapper::push_from(&chain, alice)
            .rm_pay_ath(ending, false)
            .get()?;
        assert!(PayAuth::get(ending).is_none());
        assert_eq!(exp(&chain, bob, alice, usd), 100);
        Ok(())
    }

    /// A round trip through the sender must not burn a depleting line.
    ///
    /// Carol's global forward unwinds the draw, so the books would net to
    /// zero while `remaining` stayed spent.
    #[psibase::test_case(packages("Banx"))]
    fn test_path_cannot_round_trip_through_sender(
        chain: psibase::Chain,
    ) -> Result<(), psibase::Error> {
        Wrapper::push(&chain).init().get()?;
        let alice = account!("alice");
        let carol = account!("carol");
        chain.new_account(alice).unwrap();
        chain.new_account(carol).unwrap();
        let usd = Asset::get_by_symbol_assert(account!("usd")).id;

        Wrapper::push_from(&chain, carol)
            .st_crd_lne(alice, usd, Quantity::new(100), true)
            .get()?;
        Wrapper::push_from(&chain, carol)
            .st_glb_fwd(usd, Quantity::new(0), 0, never(), true)
            .get()?;

        let err = Wrapper::push_from(&chain, alice)
            .path_pay(
                seal(
                    &chain,
                    alice,
                    vec![hop(carol, usd), hop(alice, usd)],
                    Quantity::new(100),
                ),
                Quantity::new(100),
                Quantity::new(0),
                0,
            )
            .get()
            .unwrap_err();
        assert!(
            err.to_string()
                .contains("path cannot route back through the sender"),
            "got {err}"
        );
        assert_eq!(exp(&chain, carol, alice, usd), 0);
        assert_eq!(exp(&chain, alice, carol, usd), 0);
        assert_eq!(Pair::line(carol, alice, usd).unwrap().remaining.value, 100);
        Ok(())
    }

    /// Alice can end a path on herself once the asset has changed. Bob's rate
    /// sizes the return. Both claims stay. The same asset, or a hop after
    /// Alice, still fails.
    #[psibase::test_case(packages("Banx"))]
    fn test_path_return_to_sender_in_another_asset(
        chain: psibase::Chain,
    ) -> Result<(), psibase::Error> {
        Wrapper::push(&chain).init().get()?;
        let alice = account!("alice");
        let bob = account!("bob");
        let carol = account!("carol");
        for a in [alice, bob, carol] {
            chain.new_account(a).unwrap();
        }
        let aud = Asset::get_by_symbol_assert(account!("aud")).id;
        let usd = Asset::get_by_symbol_assert(account!("usd")).id;

        Wrapper::push_from(&chain, bob)
            .st_crd_lne(alice, aud, Quantity::new(10_000), false)
            .get()?;
        Wrapper::push_from(&chain, bob)
            .st_crd_lne(alice, usd, Quantity::new(10_000), false)
            .get()?;
        Wrapper::push_from(&chain, alice)
            .st_crd_lne(bob, usd, Quantity::new(10_000), false)
            .get()?;
        Wrapper::push_from(&chain, carol)
            .st_crd_lne(alice, usd, Quantity::new(10_000), false)
            .get()?;
        Wrapper::push_from(&chain, bob)
            .st_fx_ofr(
                aud,
                usd,
                true,
                Quantity::new(0),
                RATE_SCALE,
                Quantity::new(10_000),
                never(),
            )
            .get()?;
        Wrapper::push_from(&chain, bob)
            .st_glb_fwd(usd, Quantity::new(0), 0, never(), true)
            .get()?;
        Wrapper::push_from(&chain, alice)
            .st_glb_fwd(usd, Quantity::new(0), 0, never(), true)
            .get()?;

        let onward = Wrapper::push_from(&chain, alice).path_pay(
            seal(
                &chain,
                alice,
                vec![hop(bob, aud), hop(alice, usd), hop(carol, usd)],
                Quantity::new(1_000),
            ),
            Quantity::new(1_000),
            Quantity::new(0),
            0,
        );
        assert!(onward
            .trace
            .error
            .as_deref()
            .unwrap_or("")
            .contains("path cannot route back through the sender"));
        let same = Wrapper::push_from(&chain, alice).path_pay(
            seal(
                &chain,
                alice,
                vec![hop(bob, usd), hop(alice, usd)],
                Quantity::new(1_000),
            ),
            Quantity::new(1_000),
            Quantity::new(0),
            0,
        );
        assert!(same
            .trace
            .error
            .as_deref()
            .unwrap_or("")
            .contains("path cannot route back through the sender"));
        assert_eq!(exp(&chain, bob, alice, aud), 0);
        assert_eq!(exp(&chain, alice, bob, usd), 0);

        Wrapper::push_from(&chain, alice)
            .path_pay(
                seal(
                    &chain,
                    alice,
                    vec![hop(bob, aud), hop(alice, usd)],
                    Quantity::new(1_000),
                ),
                Quantity::new(1_000),
                Quantity::new(1_000),
                0,
            )
            .get()?;
        assert_eq!(exp(&chain, bob, alice, aud), 1_000);
        assert_eq!(exp(&chain, alice, bob, usd), 1_000);
        assert_eq!(exp(&chain, bob, alice, usd), 0);
        assert_eq!(exp(&chain, carol, alice, usd), 0);
        let pays: Vec<_> = activity_nodes(&chain, alice)
            .into_iter()
            .filter(|n| n.get("kind").and_then(|k| k.as_str()) == Some("path_pay"))
            .collect();
        assert_eq!(
            pays.len(),
            1,
            "a return to the sender is one payment: {pays:?}"
        );
        assert_eq!(
            pays[0].get("amount").and_then(|v| v.as_str()),
            Some("0.1000")
        );
        assert_eq!(
            pays[0].get("netted").and_then(|v| v.as_str()),
            Some("0.1000")
        );
        // Actor stays Alice on both hops. Memo is the hop debtor. The return
        // credits Alice, so that hop's debtor is Bob, not her.
        let draws = activity_nodes(&chain, alice)
            .into_iter()
            .filter(|n| n.get("kind").and_then(|k| k.as_str()) == Some("path_draw"))
            .collect::<Vec<_>>();
        assert_eq!(draws.len(), 2, "return path has two hops: {draws:?}");
        assert!(
            draws
                .iter()
                .all(|n| n.get("actor").and_then(|a| a.as_str()) == Some("alice")),
            "path_draw actor must stay the payer: {draws:?}"
        );
        assert!(
            draws.iter().any(|n| {
                n.get("memo").and_then(|m| m.as_str()) == Some("alice")
                    && n["assetId"].as_u64() == Some(u64::from(aud))
            }),
            "hop 0 should name Alice as the debtor: {draws:?}"
        );
        assert!(
            draws.iter().any(|n| {
                n.get("memo").and_then(|m| m.as_str()) == Some("bob")
                    && n["assetId"].as_u64() == Some(u64::from(usd))
            }),
            "the return hop should name Bob as the debtor, not Alice: {draws:?}"
        );
        let bob_return = activity_nodes(&chain, bob)
            .into_iter()
            .filter(|n| {
                n.get("kind").and_then(|k| k.as_str()) == Some("path_draw")
                    && n.get("memo").and_then(|m| m.as_str()) == Some("bob")
            })
            .collect::<Vec<_>>();
        assert!(
            !bob_return.is_empty()
                && bob_return
                    .iter()
                    .all(|n| n.get("actor").and_then(|a| a.as_str()) == Some("alice")),
            "middleman hop named the hop debtor as actor: {bob_return:?}"
        );
        Ok(())
    }

    /// A cycle that returns to the payer is not one authorized period.
    ///
    /// `max_spend` is the most that period may draw the payer. Repeating
    /// Bob in `[Bob, Carol, Alice, Bob]` would draw Alice twice, so the
    /// run must fail and leave the books untouched.
    #[psibase::test_case(packages("Banx"))]
    fn test_pay_auth_cycle_does_not_draw_payer_twice(
        chain: psibase::Chain,
    ) -> Result<(), psibase::Error> {
        Wrapper::push(&chain).init().get()?;
        let alice = account!("alice");
        let bob = account!("bob");
        let carol = account!("carol");
        chain.new_account(alice).unwrap();
        chain.new_account(bob).unwrap();
        chain.new_account(carol).unwrap();
        let usd = Asset::get_by_symbol_assert(account!("usd")).id;
        const AMOUNT: u64 = 100;

        Wrapper::push_from(&chain, bob)
            .st_crd_lne(alice, usd, Quantity::new(AMOUNT * 2), true)
            .get()?;
        Wrapper::push_from(&chain, carol)
            .st_crd_lne(bob, usd, Quantity::new(AMOUNT), false)
            .get()?;
        Wrapper::push_from(&chain, alice)
            .deposit(carol, usd, Quantity::new(AMOUNT), 0)
            .get()?;
        Wrapper::push_from(&chain, bob)
            .st_fwd_ofr(carol, usd, Quantity::new(0), 0, never(), true)
            .get()?;
        Wrapper::push_from(&chain, carol)
            .st_fwd_ofr(alice, usd, Quantity::new(0), 0, never(), false)
            .get()?;
        Wrapper::push_from(&chain, alice)
            .st_fwd_ofr(bob, usd, Quantity::new(0), 0, never(), false)
            .get()?;

        const START: i64 = 1_700_000_000;
        pin(&chain, START);
        let id = schedule(&chain, alice, bob, usd, AMOUNT, AMOUNT, 100, START, 0);

        let cycled = Wrapper::push_from(&chain, bob).run_pay_ath(
            id,
            seal_auth(
                &chain,
                alice,
                vec![
                    hop(bob, usd),
                    hop(carol, usd),
                    hop(alice, usd),
                    hop(bob, usd),
                ],
                id,
            ),
        );
        assert!(cycled.get().is_err());
        assert_eq!(pay_row(id).next_due.seconds, START);
        assert_eq!(exp(&chain, bob, alice, usd), 0);
        assert_eq!(exp(&chain, carol, alice, usd), AMOUNT);
        assert_eq!(exp(&chain, carol, bob, usd), 0);
        assert_eq!(
            Pair::line(bob, alice, usd).unwrap().remaining.value,
            AMOUNT * 2
        );
        Ok(())
    }

    /// `[Carol, Dave, Alice, Bob]` does not repeat a creditor, but it draws
    /// the payer onto Carol and then draws the payer's line to Dave.
    #[psibase::test_case(packages("Banx"))]
    fn test_pay_auth_return_through_payer_does_not_draw_twice(
        chain: psibase::Chain,
    ) -> Result<(), psibase::Error> {
        Wrapper::push(&chain).init().get()?;
        let alice = account!("alice");
        let bob = account!("bob");
        let carol = account!("carol");
        let dave = account!("dave");
        chain.new_account(alice).unwrap();
        chain.new_account(bob).unwrap();
        chain.new_account(carol).unwrap();
        chain.new_account(dave).unwrap();
        let usd = Asset::get_by_symbol_assert(account!("usd")).id;
        const AMOUNT: u64 = 100;

        Wrapper::push_from(&chain, carol)
            .st_crd_lne(alice, usd, Quantity::new(AMOUNT), true)
            .get()?;
        Wrapper::push_from(&chain, dave)
            .st_crd_lne(carol, usd, Quantity::new(AMOUNT), false)
            .get()?;
        Wrapper::push_from(&chain, alice)
            .st_crd_lne(dave, usd, Quantity::new(AMOUNT), true)
            .get()?;
        Wrapper::push_from(&chain, bob)
            .st_crd_lne(alice, usd, Quantity::new(AMOUNT), true)
            .get()?;
        Wrapper::push_from(&chain, carol)
            .st_fwd_ofr(dave, usd, Quantity::new(0), 0, never(), true)
            .get()?;
        Wrapper::push_from(&chain, dave)
            .st_fwd_ofr(alice, usd, Quantity::new(0), 0, never(), true)
            .get()?;
        Wrapper::push_from(&chain, alice)
            .st_fwd_ofr(bob, usd, Quantity::new(0), 0, never(), true)
            .get()?;

        const START: i64 = 1_700_000_000;
        pin(&chain, START);
        let id = schedule(&chain, alice, bob, usd, AMOUNT, AMOUNT, 100, START, 0);

        let err = Wrapper::push_from(&chain, bob)
            .run_pay_ath(
                id,
                seal_auth(
                    &chain,
                    alice,
                    vec![
                        hop(carol, usd),
                        hop(dave, usd),
                        hop(alice, usd),
                        hop(bob, usd),
                    ],
                    id,
                ),
            )
            .get()
            .unwrap_err();
        assert!(
            err.to_string()
                .contains("path cannot route back through the sender"),
            "got {err}"
        );
        assert_eq!(pay_row(id).next_due.seconds, START);
        assert_eq!(exp(&chain, carol, alice, usd), 0);
        assert_eq!(exp(&chain, dave, carol, usd), 0);
        assert_eq!(exp(&chain, alice, dave, usd), 0);
        assert_eq!(exp(&chain, bob, alice, usd), 0);
        assert_eq!(
            Pair::line(carol, alice, usd).unwrap().remaining.value,
            AMOUNT
        );
        assert_eq!(
            Pair::line(alice, dave, usd).unwrap().remaining.value,
            AMOUNT
        );
        assert_eq!(Pair::line(bob, alice, usd).unwrap().remaining.value, AMOUNT);
        Ok(())
    }

    struct RelayNet {
        bob: AccountNumber,
        brandon: AccountNumber,
        john: AccountNumber,
        alice: AccountNumber,
        usd: u16,
        aud: u16,
    }

    /// Bob draws Brandon, Brandon draws John, in USD. John's AUD line to Alice
    /// is the exit. Reserves are John's 10000 USD / 15000 AUD.
    fn relay_net(chain: &psibase::Chain) -> RelayNet {
        Wrapper::push(chain).init().get().unwrap();
        let bob = account!("bob");
        let brandon = account!("brandon");
        let john = account!("john");
        let alice = account!("alice");
        for a in [bob, brandon, john, alice] {
            chain.new_account(a).unwrap();
        }
        let usd = Asset::get_by_symbol_assert(account!("usd")).id;
        let aud = Asset::get_by_symbol_assert(account!("aud")).id;
        Wrapper::push_from(chain, brandon)
            .st_crd_lne(bob, usd, Quantity::new(100_000), false)
            .get()
            .unwrap();
        Wrapper::push_from(chain, john)
            .st_crd_lne(brandon, usd, Quantity::new(100_000), false)
            .get()
            .unwrap();
        Wrapper::push_from(chain, alice)
            .st_crd_lne(john, aud, Quantity::new(100_000), false)
            .get()
            .unwrap();
        Wrapper::push_from(chain, brandon)
            .st_glb_fwd(usd, Quantity::new(0), 0, never(), true)
            .get()
            .unwrap();
        Wrapper::push_from(chain, john)
            .st_glb_fwd(aud, Quantity::new(0), 0, never(), true)
            .get()
            .unwrap();
        RelayNet {
            bob,
            brandon,
            john,
            alice,
            usd,
            aud,
        }
    }

    fn post_relay(chain: &psibase::Chain, john: AccountNumber, usd: u16, aud: u16) {
        Wrapper::push_from(chain, john)
            .st_relay(usd, Quantity::new(10_000), aud, Quantity::new(15_000))
            .get()
            .unwrap();
    }

    fn relay_sides(john: AccountNumber, usd: u16, aud: u16) -> (u64, u64) {
        let row = BanxRelay::get(john, usd, aud).expect("relay");
        if row.asset_lo == usd {
            (row.reserve_lo.value, row.reserve_hi.value)
        } else {
            (row.reserve_hi.value, row.reserve_lo.value)
        }
    }

    #[psibase::test_case(packages("Banx"))]
    fn test_relay_path_usd_to_aud(chain: psibase::Chain) -> Result<(), psibase::Error> {
        let net = relay_net(&chain);
        post_relay(&chain, net.john, net.usd, net.aud);
        assert_eq!(relay_sides(net.john, net.usd, net.aud), (10_000, 15_000));

        let carol = account!("carol");
        chain.new_account(carol).unwrap();
        let missing = Wrapper::push_from(&chain, net.bob)
            .path_pay(
                seal(
                    &chain,
                    net.bob,
                    vec![
                        hop(net.brandon, net.usd),
                        hop(net.john, net.usd),
                        hop(carol, net.aud),
                    ],
                    Quantity::new(1_000),
                ),
                Quantity::new(1_000),
                Quantity::new(1),
                0,
            )
            .get();
        assert!(missing.is_err(), "a hop with no line must abort");
        assert_eq!(relay_sides(net.john, net.usd, net.aud), (10_000, 15_000));
        assert_eq!(exp(&chain, net.brandon, net.bob, net.usd), 0);

        let short = Wrapper::push_from(&chain, net.bob)
            .path_pay(
                seal(
                    &chain,
                    net.bob,
                    vec![
                        hop(net.brandon, net.usd),
                        hop(net.john, net.usd),
                        hop(net.alice, net.aud),
                    ],
                    Quantity::new(1_000),
                ),
                Quantity::new(1_000),
                Quantity::new(1_364),
                0,
            )
            .get();
        assert!(short.is_err(), "min_return above the curve must abort");
        assert_eq!(relay_sides(net.john, net.usd, net.aud), (10_000, 15_000));
        assert_eq!(exp(&chain, net.alice, net.john, net.aud), 0);

        Wrapper::push_from(&chain, net.bob)
            .path_pay(
                seal(
                    &chain,
                    net.bob,
                    vec![
                        hop(net.brandon, net.usd),
                        hop(net.john, net.usd),
                        hop(net.alice, net.aud),
                    ],
                    Quantity::new(1_000),
                ),
                Quantity::new(1_000),
                Quantity::new(1_363),
                0,
            )
            .get()?;
        assert_eq!(exp(&chain, net.brandon, net.bob, net.usd), 1_000);
        assert_eq!(exp(&chain, net.john, net.brandon, net.usd), 1_000);
        assert_eq!(exp(&chain, net.alice, net.john, net.aud), 1_363);
        assert_eq!(exp(&chain, net.john, net.bob, net.usd), 0);
        assert_eq!(exp(&chain, net.bob, net.john, net.usd), 0);
        assert_eq!(relay_sides(net.john, net.usd, net.aud), (11_000, 13_637));
        Ok(())
    }

    #[psibase::test_case(packages("Banx"))]
    fn test_relay_exact_out_inverts_curve(chain: psibase::Chain) -> Result<(), psibase::Error> {
        let net = relay_net(&chain);
        post_relay(&chain, net.john, net.usd, net.aud);
        let id = Wrapper::push_from(&chain, net.alice)
            .st_req(
                PayRequest::INVOICE,
                net.bob,
                net.aud,
                Quantity::new(1_363),
                "aud".into(),
                never(),
            )
            .get()?;
        let hops = vec![
            hop(net.brandon, net.usd),
            hop(net.john, net.usd),
            hop(net.alice, net.aud),
        ];
        let err = Wrapper::push_from(&chain, net.bob)
            .pay_inv(
                seal_inv(&chain, net.bob, hops.clone(), id),
                Quantity::new(999),
                id,
            )
            .get()
            .expect_err("999 is under the curve's required send");
        assert!(
            err.to_string().contains("max_spend below required send"),
            "{err}"
        );
        assert_eq!(relay_sides(net.john, net.usd, net.aud), (10_000, 15_000));
        assert_eq!(PayRequest::get_assert(id).remaining.value, 1_363);

        Wrapper::push_from(&chain, net.bob)
            .pay_inv(
                seal_inv(&chain, net.bob, hops, id),
                Quantity::new(1_000),
                id,
            )
            .get()?;
        assert!(PayRequest::get(id).is_none());
        assert_eq!(exp(&chain, net.alice, net.john, net.aud), 1_363);
        assert_eq!(exp(&chain, net.brandon, net.bob, net.usd), 1_000);
        assert_eq!(relay_sides(net.john, net.usd, net.aud), (11_000, 13_637));
        Ok(())
    }

    #[psibase::test_case(packages("Banx"))]
    fn test_relay_replaces_fx_offer(chain: psibase::Chain) -> Result<(), psibase::Error> {
        let net = relay_net(&chain);
        post_relay(&chain, net.john, net.usd, net.aud);
        Wrapper::push_from(&chain, net.john)
            .st_fx_ofr(
                net.usd,
                net.aud,
                true,
                Quantity::new(0),
                RATE_SCALE * 2,
                Quantity::new(u64::MAX),
                never(),
            )
            .get()?;

        let listed = banx_gql(
            &chain,
            r#"{ banxRelays(owner: "john") { owner assetLo assetHi } }"#,
        )?;
        let relays = listed
            .pointer("/data/banxRelays")
            .and_then(|v| v.as_array())
            .expect("relays");
        assert_eq!(relays.len(), 1, "{listed}");
        assert_eq!(
            relays[0].get("owner").and_then(|v| v.as_str()),
            Some("john")
        );

        Wrapper::push_from(&chain, net.bob)
            .path_pay(
                seal(
                    &chain,
                    net.bob,
                    vec![
                        hop(net.brandon, net.usd),
                        hop(net.john, net.usd),
                        hop(net.alice, net.aud),
                    ],
                    Quantity::new(1_000),
                ),
                Quantity::new(1_000),
                Quantity::new(1_363),
                0,
            )
            .get()?;
        assert_eq!(exp(&chain, net.alice, net.john, net.aud), 1_363);

        Wrapper::push_from(&chain, net.john)
            .rm_relay(net.usd, net.aud)
            .get()?;
        assert!(BanxRelay::get(net.john, net.usd, net.aud).is_none());
        assert_eq!(exp(&chain, net.alice, net.john, net.aud), 1_363);
        assert_eq!(exp(&chain, net.john, net.brandon, net.usd), 1_000);

        Wrapper::push_from(&chain, net.bob)
            .path_pay(
                seal(
                    &chain,
                    net.bob,
                    vec![
                        hop(net.brandon, net.usd),
                        hop(net.john, net.usd),
                        hop(net.alice, net.aud),
                    ],
                    Quantity::new(1_000),
                ),
                Quantity::new(1_000),
                Quantity::new(2_000),
                0,
            )
            .get()?;
        assert_eq!(exp(&chain, net.alice, net.john, net.aud), 3_363);
        assert_eq!(exp(&chain, net.john, net.brandon, net.usd), 2_000);
        Ok(())
    }

    #[psibase::test_case(packages("Banx"))]
    /// The curve has no fee. John's 10% forward takes it off what Alice is owed.
    /// A same-asset draw on John does not.
    fn test_relay_fee_is_the_forward(chain: psibase::Chain) -> Result<(), psibase::Error> {
        let net = relay_net(&chain);
        post_relay(&chain, net.john, net.usd, net.aud);
        Wrapper::push_from(&chain, net.john)
            .st_glb_fwd(net.aud, Quantity::new(0), PPM_SCALE / 10, never(), true)
            .get()?;
        Wrapper::push_from(&chain, net.bob)
            .path_pay(
                seal(
                    &chain,
                    net.bob,
                    vec![
                        hop(net.brandon, net.usd),
                        hop(net.john, net.usd),
                        hop(net.alice, net.aud),
                    ],
                    Quantity::new(1_000),
                ),
                Quantity::new(1_000),
                Quantity::new(1),
                0,
            )
            .get()?;
        // Curve of 1,000 is 1,363. John's forward keeps 10%.
        assert_eq!(exp(&chain, net.alice, net.john, net.aud), 1_226);
        assert_eq!(exp(&chain, net.john, net.brandon, net.usd), 1_000);
        assert_eq!(relay_sides(net.john, net.usd, net.aud), (11_000, 13_637));

        Wrapper::push_from(&chain, net.john)
            .st_crd_lne(net.bob, net.usd, Quantity::new(100_000), false)
            .get()?;
        Wrapper::push_from(&chain, net.bob)
            .path_pay(
                seal(
                    &chain,
                    net.bob,
                    vec![hop(net.john, net.usd)],
                    Quantity::new(500),
                ),
                Quantity::new(500),
                Quantity::new(500),
                0,
            )
            .get()?;
        assert_eq!(exp(&chain, net.john, net.bob, net.usd), 500);
        Ok(())
    }

    #[psibase::test_case(packages("Banx"))]
    fn test_token_relay_out(chain: psibase::Chain) -> Result<(), psibase::Error> {
        Wrapper::push(&chain).init().get()?;
        let alice = account!("alice");
        let john = account!("john");
        chain.new_account(alice).unwrap();
        chain.new_account(john).unwrap();
        let aud = Asset::get_by_symbol_assert(account!("aud")).id;
        let gas = mint_gas(&chain, john, john, 20_000);
        post_token_pool(&chain, john, aud, gas, 10_000, 15_000);
        Wrapper::push_from(&chain, john)
            .st_crd_lne(alice, aud, Quantity::new(100_000), false)
            .get()?;

        let tokens = Wrapper::push_from(&chain, alice)
            .tok_relay_out(
                john,
                aud,
                gas,
                Quantity::new(1_000),
                Quantity::new(1_363),
                Quantity::new(1_000),
            )
            .get();
        assert!(tokens.is_ok(), "{tokens:?}");
        assert_eq!(exp(&chain, john, alice, aud), 1_000);
        assert_eq!(shared_from_banx(&chain, gas, alice), 1_363);
        assert_eq!(token_balance(&chain, gas, alice), 0);
        assert_eq!(pair_bal(&chain, john, aud, gas), 13_637);
        assert_eq!(vault_bal(&chain, john, gas), 0);
        assert_eq!(
            TokenRelay::get(john, aud, gas).unwrap().reserve_banx.value,
            11_000
        );

        Wrapper::push_from(&chain, john)
            .rm_tok_relay(aud, gas)
            .get()?;
        assert!(TokenRelay::get(john, aud, gas).is_none());
        assert_eq!(pair_bal(&chain, john, aud, gas), 0);
        assert_eq!(shared_from_banx(&chain, gas, john), 13_637);
        assert_eq!(token_balance(&chain, gas, john), 5_000);
        Ok(())
    }

    #[psibase::test_case(packages("Banx"))]
    fn test_relay_path_cash_pays_tokens(chain: psibase::Chain) -> Result<(), psibase::Error> {
        Wrapper::push(&chain).init().get()?;
        let bob = account!("bob");
        let brandon = account!("brandon");
        let john = account!("john");
        let alice = account!("alice");
        for a in [bob, brandon, john, alice] {
            chain.new_account(a).unwrap();
        }
        let aud = Asset::get_by_symbol_assert(account!("aud")).id;
        let gas = mint_gas(&chain, john, john, 20_000);
        post_token_pool(&chain, john, aud, gas, 10_000, 15_000);
        Wrapper::push_from(&chain, brandon)
            .st_crd_lne(bob, aud, Quantity::new(100_000), false)
            .get()?;
        Wrapper::push_from(&chain, john)
            .st_crd_lne(brandon, aud, Quantity::new(100_000), false)
            .get()?;
        Wrapper::push_from(&chain, brandon)
            .st_glb_fwd(aud, Quantity::new(0), 0, never(), true)
            .get()?;

        let ghost = account!("nobody");
        let missing = Wrapper::push_from(&chain, bob)
            .path_cash(
                seal(
                    &chain,
                    bob,
                    vec![hop(brandon, aud), hop(john, aud)],
                    Quantity::new(1_000),
                ),
                Quantity::new(1_000),
                gas,
                ghost,
                Quantity::new(1),
                Quantity::new(1_000),
            )
            .get()
            .expect_err("path_cash must name an existing account");
        assert!(missing.to_string().contains("does not exist"), "{missing}");
        assert_eq!(exp(&chain, brandon, bob, aud), 0);
        assert_eq!(exp(&chain, john, brandon, aud), 0);
        assert_eq!(pair_bal(&chain, john, aud, gas), 15_000);
        assert_eq!(
            TokenRelay::get(john, aud, gas).unwrap().reserve_banx.value,
            10_000
        );

        Wrapper::push_from(&chain, bob)
            .path_cash(
                seal(
                    &chain,
                    bob,
                    vec![hop(brandon, aud), hop(john, aud)],
                    Quantity::new(1_000),
                ),
                Quantity::new(1_000),
                gas,
                alice,
                Quantity::new(1_363),
                Quantity::new(1_000),
            )
            .get()?;
        assert_eq!(exp(&chain, brandon, bob, aud), 1_000);
        assert_eq!(exp(&chain, john, brandon, aud), 1_000);
        assert_eq!(exp(&chain, john, alice, aud), 0);
        assert_eq!(exp(&chain, alice, john, aud), 0);
        assert!(
            activity_nodes(&chain, alice)
                .iter()
                .all(|row| row.get("kind").and_then(|k| k.as_str()) != Some("relay")),
            "token recipient has no Banx claim on the relay owner"
        );
        assert_eq!(shared_from_banx(&chain, gas, alice), 1_363);
        assert_eq!(token_balance(&chain, gas, alice), 0);
        assert_eq!(pair_bal(&chain, john, aud, gas), 13_637);
        assert_eq!(vault_bal(&chain, john, gas), 0);
        assert_eq!(
            TokenRelay::get(john, aud, gas).unwrap().reserve_banx.value,
            11_000
        );
        Ok(())
    }

    #[psibase::test_case(packages("Banx"))]
    fn test_token_relay_in(chain: psibase::Chain) -> Result<(), psibase::Error> {
        Wrapper::push(&chain).init().get()?;
        let alice = account!("alice");
        let john = account!("john");
        chain.new_account(alice).unwrap();
        chain.new_account(john).unwrap();
        let aud = Asset::get_by_symbol_assert(account!("aud")).id;
        let gas = mint_gas(&chain, john, john, 20_000);
        post_token_pool(&chain, john, aud, gas, 10_000, 15_000);
        psibase::services::tokens::Wrapper::push_from(&chain, john)
            .credit(
                gas,
                alice,
                Quantity::new(1_000),
                "sell".to_string().try_into().unwrap(),
            )
            .get()?;
        psibase::services::tokens::Wrapper::push_from(&chain, alice)
            .debit(
                gas,
                john,
                Quantity::new(1_000),
                "take".to_string().try_into().unwrap(),
            )
            .get()?;
        fund_vault(&chain, alice, gas, 1_000);

        Wrapper::push_from(&chain, alice)
            .tok_relay_in(john, aud, gas, Quantity::new(1_000), Quantity::new(625))
            .get()?;
        assert_eq!(exp(&chain, alice, john, aud), 625);
        assert_eq!(pair_bal(&chain, john, aud, gas), 16_000);
        assert_eq!(vault_bal(&chain, john, gas), 0);
        assert_eq!(vault_bal(&chain, alice, gas), 0);
        assert_eq!(
            TokenRelay::get(john, aud, gas).unwrap().reserve_banx.value,
            9_375
        );
        Ok(())
    }

    /// 10% of the tokens is John's. The curve prices the rest, and the Banx
    /// debt is that output, not a second haircut.
    #[psibase::test_case(packages("Banx"))]
    fn test_token_relay_fee_is_the_owners_tokens(
        chain: psibase::Chain,
    ) -> Result<(), psibase::Error> {
        Wrapper::push(&chain).init().get()?;
        let alice = account!("alice");
        let john = account!("john");
        chain.new_account(alice).unwrap();
        chain.new_account(john).unwrap();
        let aud = Asset::get_by_symbol_assert(account!("aud")).id;
        let gas = mint_gas(&chain, john, john, 30_000);
        psibase::services::tokens::Wrapper::push_from(&chain, john)
            .credit(
                gas,
                Wrapper::SERVICE,
                Quantity::new(15_000),
                "relay".to_string().try_into().unwrap(),
            )
            .get()?;
        Wrapper::push_from(&chain, john)
            .st_tok_relay(aud, gas, Quantity::new(10_000), Quantity::new(15_000))
            .get()?;
        Wrapper::push_from(&chain, john)
            .st_glb_fwd(aud, Quantity::new(0), PPM_SCALE / 10, never(), true)
            .get()?;
        Wrapper::push_from(&chain, john)
            .st_crd_lne(alice, aud, Quantity::new(100_000), false)
            .get()?;

        let face_only = Wrapper::push_from(&chain, alice)
            .tok_relay_out(
                john,
                aud,
                gas,
                Quantity::new(1_000),
                Quantity::new(1),
                Quantity::new(1_000),
            )
            .get()
            .expect_err("10% forward grosses the face above the cap");
        assert!(
            face_only.to_string().contains("relay banx above max_owed"),
            "{face_only}"
        );
        assert_eq!(exp(&chain, john, alice, aud), 0);
        assert_eq!(pair_bal(&chain, john, aud, gas), 15_000);

        Wrapper::push_from(&chain, alice)
            .tok_relay_out(
                john,
                aud,
                gas,
                Quantity::new(1_000),
                Quantity::new(1),
                Quantity::new(1_112),
            )
            .get()?;
        // Curve prices 1,000 and pays 1,363 tokens. The forward is extra Banx Alice owes.
        assert_eq!(exp(&chain, john, alice, aud), 1_112);
        assert_eq!(shared_from_banx(&chain, gas, alice), 1_363);
        assert_eq!(shared_from_banx(&chain, gas, john), 0);
        assert_eq!(pair_bal(&chain, john, aud, gas), 15_000 - 1_363);
        assert_eq!(
            TokenRelay::get(john, aud, gas).unwrap().reserve_banx.value,
            11_000
        );

        psibase::services::tokens::Wrapper::push_from(&chain, john)
            .credit(
                gas,
                alice,
                Quantity::new(1_000),
                "sell".to_string().try_into().unwrap(),
            )
            .get()?;
        psibase::services::tokens::Wrapper::push_from(&chain, alice)
            .debit(
                gas,
                john,
                Quantity::new(1_000),
                "take".to_string().try_into().unwrap(),
            )
            .get()?;
        fund_vault(&chain, alice, gas, 1_000);
        Wrapper::push_from(&chain, alice)
            .tok_relay_in(john, aud, gas, Quantity::new(1_000), Quantity::new(1))
            .get()?;
        // Against the moved pool, 1,000 tokens price 751 Banx. Forward keeps 10%.
        // 675 nets the 1,112 draw, so 437 remains.
        assert_eq!(pair_bal(&chain, john, aud, gas), 15_000 - 1_363 + 1_000);
        assert_eq!(shared_from_banx(&chain, gas, john), 0);
        assert_eq!(vault_bal(&chain, alice, gas), 0);
        assert_eq!(exp(&chain, alice, john, aud), 0);
        assert_eq!(exp(&chain, john, alice, aud), 437);
        assert_eq!(
            TokenRelay::get(john, aud, gas).unwrap().reserve_banx.value,
            11_000 - 751
        );

        // A one-hop path_cash is the same swap. The curve prices 1,000 and
        // pays every token. The 1,112 draw is extra Banx, not a token cut.
        let tokens_before = shared_from_banx(&chain, gas, alice);
        let pair_before = pair_bal(&chain, john, aud, gas);
        let weight_before = TokenRelay::get(john, aud, gas).unwrap().reserve_banx.value;
        let face_only = Wrapper::push_from(&chain, alice)
            .path_cash(
                seal(&chain, alice, vec![hop(john, aud)], Quantity::new(1_000)),
                Quantity::new(1_000),
                gas,
                alice,
                Quantity::new(1),
                Quantity::new(1_000),
            )
            .get()
            .expect_err("one-hop forward grosses the face above the cap");
        assert!(
            face_only.to_string().contains("relay banx above max_owed"),
            "{face_only}"
        );
        assert_eq!(exp(&chain, john, alice, aud), 437);
        assert_eq!(shared_from_banx(&chain, gas, alice), tokens_before);

        Wrapper::push_from(&chain, alice)
            .path_cash(
                seal(&chain, alice, vec![hop(john, aud)], Quantity::new(1_000)),
                Quantity::new(1_000),
                gas,
                alice,
                Quantity::new(1),
                Quantity::new(1_112),
            )
            .get()?;
        assert_eq!(exp(&chain, john, alice, aud), 437 + 1_112);
        assert_eq!(shared_from_banx(&chain, gas, alice), tokens_before + 1_301);
        assert_eq!(pair_bal(&chain, john, aud, gas), pair_before - 1_301);
        assert_eq!(
            TokenRelay::get(john, aud, gas).unwrap().reserve_banx.value,
            weight_before + 1_000
        );

        let self_hop = Wrapper::push_from(&chain, john).path_cash(
            seal(&chain, john, vec![hop(john, aud)], Quantity::new(1)),
            Quantity::new(1),
            gas,
            john,
            Quantity::new(1),
            Quantity::new(1),
        );
        assert!(
            self_hop
                .trace
                .error
                .as_deref()
                .unwrap_or("")
                .contains("path cannot draw on self"),
            "{}",
            self_hop.trace.error.as_deref().unwrap_or("")
        );
        Ok(())
    }

    /// A replaced fixed forward can gross a 100 face up to the whole claim.
    /// The signed cap stops that. The curve still prices the face.
    #[psibase::test_case(packages("Banx"))]
    fn test_token_relay_out_caps_forward_against_a_claim(
        chain: psibase::Chain,
    ) -> Result<(), psibase::Error> {
        Wrapper::push(&chain).init().get()?;
        let alice = account!("alice");
        let john = account!("john");
        chain.new_account(alice).unwrap();
        chain.new_account(john).unwrap();
        let aud = Asset::get_by_symbol_assert(account!("aud")).id;
        let gas = mint_gas(&chain, john, john, 20_000);
        post_token_pool(&chain, john, aud, gas, 10_000, 15_000);
        Wrapper::push_from(&chain, john)
            .deposit(alice, aud, Quantity::new(10_000), 0)
            .get()?;
        Wrapper::push_from(&chain, john)
            .st_glb_fwd(aud, Quantity::new(9_900), 0, never(), true)
            .get()?;

        let face = Wrapper::push_from(&chain, alice)
            .tok_relay_out(
                john,
                aud,
                gas,
                Quantity::new(100),
                Quantity::new(1),
                Quantity::new(100),
            )
            .get()
            .expect_err("fee of 9,900 grosses 100 up to the whole claim");
        assert!(
            face.to_string().contains("relay banx above max_owed"),
            "{face}"
        );
        let under = Wrapper::push_from(&chain, alice)
            .tok_relay_out(
                john,
                aud,
                gas,
                Quantity::new(100),
                Quantity::new(1),
                Quantity::new(9_999),
            )
            .get()
            .expect_err("one below the grossed debt still fails");
        assert!(
            under.to_string().contains("relay banx above max_owed"),
            "{under}"
        );
        let path = Wrapper::push_from(&chain, alice)
            .path_cash(
                seal(&chain, alice, vec![hop(john, aud)], Quantity::new(100)),
                Quantity::new(100),
                gas,
                alice,
                Quantity::new(1),
                Quantity::new(100),
            )
            .get()
            .expect_err("one-hop path_cash uses the same cap");
        assert!(
            path.to_string().contains("relay banx above max_owed"),
            "{path}"
        );
        assert_eq!(exp(&chain, alice, john, aud), 10_000);
        assert_eq!(exp(&chain, john, alice, aud), 0);
        assert_eq!(shared_from_banx(&chain, gas, alice), 0);
        assert_eq!(pair_bal(&chain, john, aud, gas), 15_000);
        assert_eq!(
            TokenRelay::get(john, aud, gas).unwrap().reserve_banx.value,
            10_000
        );

        // 15,000 * 100 / 10,100 = 148. The cap equals the grossed debt, so
        // the claim unwinds in full and the curve still prices 100.
        Wrapper::push_from(&chain, alice)
            .tok_relay_out(
                john,
                aud,
                gas,
                Quantity::new(100),
                Quantity::new(148),
                Quantity::new(10_000),
            )
            .get()?;
        assert_eq!(exp(&chain, alice, john, aud), 0);
        assert_eq!(exp(&chain, john, alice, aud), 0);
        assert_eq!(shared_from_banx(&chain, gas, alice), 148);
        assert_eq!(pair_bal(&chain, john, aud, gas), 15_000 - 148);
        assert_eq!(
            TokenRelay::get(john, aud, gas).unwrap().reserve_banx.value,
            10_100
        );
        Ok(())
    }

    /// Selling Banx that John already owes is one relay row, netted in full.
    /// It is not a path hop plus a second row that pretends nothing netted.
    #[psibase::test_case(packages("Banx"))]
    fn test_token_relay_out_records_the_net(chain: psibase::Chain) -> Result<(), psibase::Error> {
        Wrapper::push(&chain).init().get()?;
        let alice = account!("alice");
        let john = account!("john");
        chain.new_account(alice).unwrap();
        chain.new_account(john).unwrap();
        let aud = Asset::get_by_symbol_assert(account!("aud")).id;
        let gas = mint_gas(&chain, john, john, 20_000);
        post_token_pool(&chain, john, aud, gas, 10_000, 15_000);
        Wrapper::push_from(&chain, john)
            .deposit(alice, aud, Quantity::new(1_000), 0)
            .get()?;

        Wrapper::push_from(&chain, alice)
            .tok_relay_out(
                john,
                aud,
                gas,
                Quantity::new(1_000),
                Quantity::new(1_363),
                Quantity::new(1_000),
            )
            .get()?;
        assert_eq!(exp(&chain, alice, john, aud), 0);
        assert_eq!(exp(&chain, john, alice, aud), 0);

        let nodes = activity_nodes(&chain, alice);
        assert!(
            nodes
                .iter()
                .all(|row| row.get("kind").and_then(|k| k.as_str()) != Some("path_draw")),
            "a relay swap is not a path hop: {nodes:?}"
        );
        let relays: Vec<_> = nodes
            .iter()
            .filter(|row| row.get("kind").and_then(|k| k.as_str()) == Some("relay"))
            .collect();
        assert_eq!(relays.len(), 1, "{nodes:?}");
        assert_eq!(
            relays[0].get("amount").and_then(|v| v.as_str()),
            Some("0.1000")
        );
        assert_eq!(
            relays[0].get("netted").and_then(|v| v.as_str()),
            Some("0.1000")
        );
        Ok(())
    }

    /// Buying Banx that cancels a debt Alice already owes is recorded as that net.
    #[psibase::test_case(packages("Banx"))]
    fn test_token_relay_in_records_the_net(chain: psibase::Chain) -> Result<(), psibase::Error> {
        Wrapper::push(&chain).init().get()?;
        let alice = account!("alice");
        let john = account!("john");
        chain.new_account(alice).unwrap();
        chain.new_account(john).unwrap();
        let aud = Asset::get_by_symbol_assert(account!("aud")).id;
        let gas = mint_gas(&chain, john, john, 20_000);
        Wrapper::push_from(&chain, john)
            .st_crd_lne(alice, aud, Quantity::new(100_000), false)
            .get()?;
        Wrapper::push_from(&chain, alice)
            .path_pay(
                seal(&chain, alice, vec![hop(john, aud)], Quantity::new(625)),
                Quantity::new(625),
                Quantity::new(625),
                0,
            )
            .get()?;
        psibase::services::tokens::Wrapper::push_from(&chain, john)
            .credit(
                gas,
                alice,
                Quantity::new(1_000),
                "sell".to_string().try_into().unwrap(),
            )
            .get()?;
        psibase::services::tokens::Wrapper::push_from(&chain, alice)
            .debit(
                gas,
                john,
                Quantity::new(1_000),
                "take".to_string().try_into().unwrap(),
            )
            .get()?;
        fund_vault(&chain, alice, gas, 1_000);
        post_token_pool(&chain, john, aud, gas, 10_000, 15_000);

        Wrapper::push_from(&chain, alice)
            .tok_relay_in(john, aud, gas, Quantity::new(1_000), Quantity::new(625))
            .get()?;
        assert_eq!(exp(&chain, alice, john, aud), 0);
        assert_eq!(exp(&chain, john, alice, aud), 0);

        let nodes = activity_nodes(&chain, alice);
        let relays: Vec<_> = nodes
            .iter()
            .filter(|row| row.get("kind").and_then(|k| k.as_str()) == Some("relay"))
            .collect();
        assert_eq!(relays.len(), 1, "{nodes:?}");
        assert_eq!(
            relays[0].get("amount").and_then(|v| v.as_str()),
            Some("0.0625")
        );
        assert_eq!(
            relays[0].get("netted").and_then(|v| v.as_str()),
            Some("0.0625")
        );
        let draws = nodes
            .iter()
            .filter(|row| row.get("kind").and_then(|k| k.as_str()) == Some("path_draw"))
            .count();
        assert_eq!(
            draws, 1,
            "the setup draw stays; the swap does not add one: {nodes:?}"
        );
        Ok(())
    }

    /// One owner, one pool per Banx asset and token. A second IOU with the
    /// same token is a different pair. Someone else can post the same pair.
    #[psibase::test_case(packages("Banx"))]
    fn test_token_relay_one_pair_per_owner(chain: psibase::Chain) -> Result<(), psibase::Error> {
        Wrapper::push(&chain).init().get()?;
        let alice = account!("alice");
        let john = account!("john");
        chain.new_account(alice).unwrap();
        chain.new_account(john).unwrap();
        let aud = Asset::get_by_symbol_assert(account!("aud")).id;
        let usd = Asset::get_by_symbol_assert(account!("usd")).id;
        let gas = mint_gas(&chain, john, john, 20_000);
        let zero = Wrapper::push_from(&chain, john)
            .st_tok_relay(aud, gas, Quantity::new(1), Quantity::new(0))
            .get()
            .expect_err("token reserve must be positive");
        assert!(
            zero.to_string()
                .contains("relay token reserve must be positive"),
            "{zero}"
        );

        post_token_pool(&chain, john, aud, gas, 10_000, 15_000);
        post_token_pool(&chain, john, usd, gas, 8_000, 1_000);
        assert_eq!(pair_bal(&chain, john, aud, gas), 15_000);
        assert_eq!(pair_bal(&chain, john, usd, gas), 1_000);
        assert_eq!(vault_bal(&chain, john, gas), 0);

        let again = Wrapper::push_from(&chain, john)
            .st_tok_relay(aud, gas, Quantity::new(10_000), Quantity::new(1))
            .get()
            .expect_err("the same owner cannot post the pair twice");
        assert!(
            again
                .to_string()
                .contains("relay already posted for this pair"),
            "{again}"
        );
        assert_eq!(pair_bal(&chain, john, aud, gas), 15_000);

        psibase::services::tokens::Wrapper::push_from(&chain, john)
            .credit(
                gas,
                alice,
                Quantity::new(500),
                "sell".to_string().try_into().unwrap(),
            )
            .get()?;
        psibase::services::tokens::Wrapper::push_from(&chain, alice)
            .debit(
                gas,
                john,
                Quantity::new(500),
                "take".to_string().try_into().unwrap(),
            )
            .get()?;
        post_token_pool(&chain, alice, aud, gas, 100, 500);
        assert_eq!(pair_bal(&chain, alice, aud, gas), 500);
        assert_eq!(pair_bal(&chain, john, aud, gas), 15_000);

        Wrapper::push_from(&chain, john)
            .rm_tok_relay(aud, gas)
            .get()?;
        assert!(TokenRelay::get(john, aud, gas).is_none());
        assert_eq!(pair_bal(&chain, john, aud, gas), 0);
        assert_eq!(shared_from_banx(&chain, gas, john), 15_000);
        assert_eq!(pair_bal(&chain, john, usd, gas), 1_000);
        assert!(TokenRelay::get(john, usd, gas).is_some());
        assert_eq!(token_balance(&chain, gas, john), 3_500);
        Ok(())
    }

    /// The cash vault is a different sub-account. Funding it, withdrawing it,
    /// and filling a cash quote do not move the pool or its weight.
    #[psibase::test_case(packages("Banx"))]
    fn test_token_pool_ignores_cash_vault(chain: psibase::Chain) -> Result<(), psibase::Error> {
        Wrapper::push(&chain).init().get()?;
        let alice = account!("alice");
        let john = account!("john");
        chain.new_account(alice).unwrap();
        chain.new_account(john).unwrap();
        let aud = Asset::get_by_symbol_assert(account!("aud")).id;
        let gas = mint_gas(&chain, john, john, 20_000);
        post_token_pool(&chain, john, aud, gas, 10_000, 15_000);
        fund_vault(&chain, john, gas, 2_000);
        Wrapper::push_from(&chain, john)
            .st_crd_lne(alice, aud, Quantity::new(100_000), false)
            .get()?;
        Wrapper::push_from(&chain, john)
            .st_csh_qte(
                aud,
                gas,
                true,
                0.into(),
                RATE_SCALE,
                Quantity::new(u64::MAX),
                never(),
            )
            .get()?;

        Wrapper::push_from(&chain, alice)
            .cash_out(john, aud, gas, Quantity::new(1_000), Quantity::new(1_000))
            .get()?;
        assert_eq!(vault_bal(&chain, john, gas), 1_000);
        assert_eq!(pair_bal(&chain, john, aud, gas), 15_000);
        assert_eq!(
            TokenRelay::get(john, aud, gas).unwrap().reserve_banx.value,
            10_000
        );
        assert_eq!(shared_from_banx(&chain, gas, alice), 1_000);

        Wrapper::push_from(&chain, john)
            .csh_wd(gas, Quantity::new(1_000))
            .get()?;
        assert_eq!(vault_bal(&chain, john, gas), 0);
        assert_eq!(pair_bal(&chain, john, aud, gas), 15_000);
        assert_eq!(
            TokenRelay::get(john, aud, gas).unwrap().reserve_banx.value,
            10_000
        );

        Wrapper::push_from(&chain, alice)
            .tok_relay_out(
                john,
                aud,
                gas,
                Quantity::new(1_000),
                Quantity::new(1_363),
                Quantity::new(1_000),
            )
            .get()?;
        assert_eq!(pair_bal(&chain, john, aud, gas), 13_637);
        assert_eq!(vault_bal(&chain, john, gas), 0);
        assert_eq!(
            TokenRelay::get(john, aud, gas).unwrap().reserve_banx.value,
            11_000
        );
        Ok(())
    }

    /// A round trip through one relay prices the second swap on the reserves
    /// the first swap saved. 500 exact-out costs 501. 1,000 in delivers 999.
    #[psibase::test_case(packages("Banx"))]
    fn test_relay_round_trip_matches_quote(chain: psibase::Chain) -> Result<(), psibase::Error> {
        let net = relay_net(&chain);
        post_relay(&chain, net.john, net.usd, net.aud);
        let carol = account!("carol");
        chain.new_account(carol).unwrap();
        Wrapper::push_from(&chain, net.alice)
            .st_glb_fwd(net.aud, Quantity::new(0), 0, never(), true)
            .get()?;
        Wrapper::push_from(&chain, net.john)
            .st_glb_fwd(net.usd, Quantity::new(0), 0, never(), true)
            .get()?;
        Wrapper::push_from(&chain, carol)
            .st_crd_lne(net.john, net.usd, Quantity::new(100_000), false)
            .get()?;
        let hops = vec![
            hop(net.brandon, net.usd),
            hop(net.john, net.usd),
            hop(net.alice, net.aud),
            hop(net.john, net.aud),
            hop(carol, net.usd),
        ];

        let id = Wrapper::push_from(&chain, carol)
            .st_req(
                PayRequest::INVOICE,
                net.bob,
                net.usd,
                Quantity::new(500),
                "usd".into(),
                never(),
            )
            .get()?;
        let short = Wrapper::push_from(&chain, net.bob)
            .pay_inv(
                seal_inv(&chain, net.bob, hops.clone(), id),
                Quantity::new(500),
                id,
            )
            .get()
            .expect_err("500 is one short of the sequential curve");
        assert!(
            short.to_string().contains("max_spend below required send"),
            "{short}"
        );
        assert_eq!(relay_sides(net.john, net.usd, net.aud), (10_000, 15_000));

        Wrapper::push_from(&chain, net.bob)
            .pay_inv(
                seal_inv(&chain, net.bob, hops.clone(), id),
                Quantity::new(501),
                id,
            )
            .get()?;
        assert!(PayRequest::get(id).is_none());
        assert_eq!(exp(&chain, carol, net.john, net.usd), 500);
        assert_eq!(exp(&chain, net.brandon, net.bob, net.usd), 501);
        assert_eq!(exp(&chain, net.john, net.brandon, net.usd), 501);
        assert_eq!(relay_sides(net.john, net.usd, net.aud), (10_001, 15_000));

        Wrapper::push_from(&chain, net.bob)
            .path_pay(
                seal(&chain, net.bob, hops, Quantity::new(1_000)),
                Quantity::new(1_000),
                Quantity::new(999),
                0,
            )
            .get()?;
        assert_eq!(exp(&chain, carol, net.john, net.usd), 1_499);
        Ok(())
    }

    /// Exact-out through one relay twice, with a currency cap in front.
    /// 1_024 comes back short of 1_400. 2_048 is over the cap. The payable
    /// send, 1_401, is not a power of two.
    #[psibase::test_case(packages("Banx"))]
    fn test_exact_out_between_short_output_and_policy_cap(
        chain: psibase::Chain,
    ) -> Result<(), psibase::Error> {
        let net = relay_net(&chain);
        post_relay(&chain, net.john, net.usd, net.aud);
        let carol = account!("carol");
        chain.new_account(carol).unwrap();
        let eur = Asset::get_by_symbol_assert(account!("eur")).id;
        Wrapper::push_from(&chain, net.brandon)
            .st_crd_lne(net.bob, eur, Quantity::new(100_000), false)
            .get()?;
        Wrapper::push_from(&chain, net.brandon)
            .st_fx_ofr(
                eur,
                net.usd,
                true,
                Quantity::new(0),
                RATE_SCALE,
                Quantity::new(1_500),
                never(),
            )
            .get()?;
        Wrapper::push_from(&chain, net.alice)
            .st_glb_fwd(net.aud, Quantity::new(0), 0, never(), true)
            .get()?;
        Wrapper::push_from(&chain, net.john)
            .st_glb_fwd(net.usd, Quantity::new(0), 0, never(), true)
            .get()?;
        Wrapper::push_from(&chain, carol)
            .st_crd_lne(net.john, net.usd, Quantity::new(100_000), false)
            .get()?;
        let hops = vec![
            hop(net.brandon, eur),
            hop(net.john, net.usd),
            hop(net.alice, net.aud),
            hop(net.john, net.aud),
            hop(carol, net.usd),
        ];
        let id = Wrapper::push_from(&chain, carol)
            .st_req(
                PayRequest::INVOICE,
                net.bob,
                net.usd,
                Quantity::new(1_400),
                "usd".into(),
                never(),
            )
            .get()?;
        let short = Wrapper::push_from(&chain, net.bob)
            .pay_inv(
                seal_inv(&chain, net.bob, hops.clone(), id),
                Quantity::new(1_024),
                id,
            )
            .get()
            .expect_err("1024 is below the send that delivers 1400");
        assert!(
            short.to_string().contains("max_spend below required send"),
            "{short}"
        );
        assert_eq!(relay_sides(net.john, net.usd, net.aud), (10_000, 15_000));
        assert!(PayRequest::get(id).is_some());

        Wrapper::push_from(&chain, net.bob)
            .pay_inv(
                seal_inv(&chain, net.bob, hops, id),
                Quantity::new(1_500),
                id,
            )
            .get()?;
        assert!(PayRequest::get(id).is_none());
        assert_eq!(exp(&chain, carol, net.john, net.usd), 1_400);
        assert_eq!(exp(&chain, net.brandon, net.bob, eur), 1_401);
        assert_eq!(
            FxOffer::get_assert(net.brandon, eur, net.usd, true)
                .remaining
                .value,
            99
        );
        Ok(())
    }

    struct WowBook {
        john: AccountNumber,
        aud: u16,
        wow: u16,
    }

    /// John's virtual book: 10,000 WoW gold against 15,000 AUD, no fee.
    /// Amounts are raw. WoW is precision 4, same as AUD.
    fn open_wow_book(chain: &psibase::Chain, friends: &[AccountNumber]) -> WowBook {
        Wrapper::push(chain).init().get().unwrap();
        let john = account!("john");
        chain.new_account(john).unwrap();
        for friend in friends {
            chain.new_account(*friend).unwrap();
        }
        let aud = Asset::get_by_symbol_assert(account!("aud")).id;
        let wow = Asset::get_by_symbol_assert(account!("wow")).id;
        Wrapper::push_from(chain, john)
            .st_relay(wow, Quantity::new(10_000), aud, Quantity::new(15_000))
            .get()
            .unwrap();
        WowBook { john, aud, wow }
    }

    fn offer_line(
        chain: &psibase::Chain,
        creditor: AccountNumber,
        debitor: AccountNumber,
        asset: u16,
    ) {
        Wrapper::push_from(chain, creditor)
            .st_crd_lne(debitor, asset, Quantity::new(100_000), false)
            .get()
            .unwrap();
    }

    fn forward_any(chain: &psibase::Chain, poster: AccountNumber, asset: u16) {
        Wrapper::push_from(chain, poster)
            .st_glb_fwd(asset, Quantity::new(0), 0, never(), true)
            .get()
            .unwrap();
    }

    /// (AUD reserve, WoW reserve). WoW is registered after the seed list, so AUD is the low id.
    fn aud_wow(john: AccountNumber, aud: u16, wow: u16) -> (u64, u64) {
        let row = BanxRelay::get(john, aud, wow).expect("relay");
        assert_eq!((row.asset_lo, row.asset_hi), (aud, wow));
        (row.reserve_lo.value, row.reserve_hi.value)
    }

    /// Billy mails John 1,000 WoW gold and sells it on John's relay.
    ///
    /// John lines Anthony, and Anthony lines Billy, both in AUD. Those lines
    /// let Billy pay dollars through his dad. A path may end on Billy in AUD,
    /// but Billy never lined Anthony, so Anthony cannot owe him the dollars.
    /// The gold unwind is the deposit itself. The curve's AUD is a claim
    /// Anthony holds on John, which needs Anthony's line to John. Billy then
    /// spends 500 AUD through that claim.
    #[psibase::test_case(packages("Banx"))]
    fn test_wow_billy_sells_through_anthony(chain: psibase::Chain) -> Result<(), psibase::Error> {
        let anthony = account!("anthony");
        let billy = account!("billy");
        let book = open_wow_book(&chain, &[anthony, billy]);
        let john = book.john;
        let aud = book.aud;
        let wow = book.wow;

        offer_line(&chain, john, anthony, aud);
        offer_line(&chain, anthony, billy, aud);
        // Receive side. John's line to Anthony lets Anthony pay John, not hold John's debt.
        offer_line(&chain, anthony, john, aud);
        forward_any(&chain, john, aud);
        forward_any(&chain, anthony, aud);
        assert!(Pair::line(john, billy, aud).is_none());

        let gold = 1_000u64;
        let id = Wrapper::push_from(&chain, billy)
            .st_req(
                PayRequest::PLEASE_BOOK,
                john,
                wow,
                Quantity::new(gold),
                "mailed gold".into(),
                never(),
            )
            .get()?;

        let sell = vec![hop(john, wow), hop(anthony, aud)];
        let early = Wrapper::push_from(&chain, billy)
            .path_pay(
                seal(&chain, billy, sell.clone(), Quantity::new(gold)),
                Quantity::new(gold),
                Quantity::new(1),
                0,
            )
            .get()
            .expect_err("unvalidated mail is not gold John owes Billy");
        assert!(
            early
                .to_string()
                .contains("insufficient path capacity (line + reverse claim)"),
            "{early}"
        );
        assert_eq!(aud_wow(john, aud, wow), (15_000, 10_000));
        assert_eq!(exp(&chain, billy, john, wow), 0);

        assert!(Wrapper::push_from(&chain, anthony)
            .deposit(billy, wow, Quantity::new(gold), id)
            .get()
            .is_err());
        assert!(Wrapper::push_from(&chain, billy)
            .deposit(billy, wow, Quantity::new(gold), id)
            .get()
            .is_err());
        Wrapper::push_from(&chain, john)
            .deposit(billy, wow, Quantity::new(gold), id)
            .get()?;
        assert!(PayRequest::get(id).is_none());
        assert_eq!(exp(&chain, billy, john, wow), gold);

        let over = Wrapper::push_from(&chain, billy)
            .path_pay(
                seal(&chain, billy, sell.clone(), Quantity::new(gold + 1)),
                Quantity::new(gold + 1),
                Quantity::new(1),
                0,
            )
            .get()
            .expect_err("the sale cannot draw more gold than John owes");
        assert!(
            over.to_string()
                .contains("insufficient path capacity (line + reverse claim)"),
            "{over}"
        );
        assert_eq!(exp(&chain, billy, john, wow), gold);
        assert_eq!(aud_wow(john, aud, wow), (15_000, 10_000));

        let direct = Wrapper::push_from(&chain, billy)
            .path_pay(
                seal(&chain, billy, vec![hop(john, aud)], Quantity::new(gold)),
                Quantity::new(gold),
                Quantity::new(1),
                0,
            )
            .get()
            .expect_err("John did not line Billy in AUD");
        assert!(
            direct
                .to_string()
                .contains("insufficient path capacity (line + reverse claim)"),
            "{direct}"
        );

        let back = Wrapper::push_from(&chain, billy)
            .path_pay(
                seal(
                    &chain,
                    billy,
                    vec![hop(john, wow), hop(anthony, aud), hop(billy, aud)],
                    Quantity::new(gold),
                ),
                Quantity::new(gold),
                Quantity::new(1),
                0,
            )
            .get()
            .expect_err("Anthony has no line from Billy");
        assert!(
            back.to_string()
                .contains("insufficient path capacity (line + reverse claim)"),
            "{back}"
        );
        assert_eq!(exp(&chain, billy, john, wow), gold);
        assert_eq!(aud_wow(john, aud, wow), (15_000, 10_000));

        // 15,000 * 1,000 / 11,000 = 1,363 AUD. Reserves become 13,637 AUD and 11,000 gold.
        Wrapper::push_from(&chain, billy)
            .path_pay(
                seal(&chain, billy, sell, Quantity::new(gold)),
                Quantity::new(gold),
                Quantity::new(1_363),
                0,
            )
            .get()?;
        assert_eq!(exp(&chain, billy, john, wow), 0);
        assert_eq!(exp(&chain, john, billy, wow), 0);
        assert_eq!(exp(&chain, anthony, john, aud), 1_363);
        assert_eq!(exp(&chain, john, anthony, aud), 0);
        assert_eq!(exp(&chain, anthony, billy, aud), 0);
        assert_eq!(exp(&chain, billy, john, aud), 0);
        assert!(Pair::line(john, billy, aud).is_none());
        assert_eq!(aud_wow(john, aud, wow), (13_637, 11_000));

        // Billy spends 500 AUD through Anthony. That unwinds 500 of the sale, so John owes Anthony 863.
        Wrapper::push_from(&chain, billy)
            .path_pay(
                seal(
                    &chain,
                    billy,
                    vec![hop(anthony, aud), hop(john, aud)],
                    Quantity::new(500),
                ),
                Quantity::new(500),
                Quantity::new(500),
                0,
            )
            .get()?;
        assert_eq!(exp(&chain, anthony, billy, aud), 500);
        assert_eq!(exp(&chain, anthony, john, aud), 863);
        assert_eq!(exp(&chain, john, anthony, aud), 0);
        assert_eq!(exp(&chain, john, billy, aud), 0);
        assert_eq!(aud_wow(john, aud, wow), (13_637, 11_000));
        Ok(())
    }

    /// Matt buys WoW gold through Josh.
    ///
    /// John lines Josh, and Josh lines Matt, in AUD and in WOW. Matt pays
    /// 1,000 AUD along the AUD lines. Ending on Matt would need Matt's WOW
    /// line to John, which he never posted, so the 625 gold is John owing
    /// Josh. Josh lines John in WOW to hold that gold. John's WOW line to
    /// Josh is the spend direction and stays unused.
    #[psibase::test_case(packages("Banx"))]
    fn test_wow_matt_buys_through_josh(chain: psibase::Chain) -> Result<(), psibase::Error> {
        let josh = account!("josh");
        let matt = account!("matt");
        let book = open_wow_book(&chain, &[josh, matt]);
        let john = book.john;
        let aud = book.aud;
        let wow = book.wow;

        offer_line(&chain, john, josh, aud);
        offer_line(&chain, josh, matt, aud);
        offer_line(&chain, john, josh, wow);
        offer_line(&chain, josh, matt, wow);
        forward_any(&chain, josh, aud);
        forward_any(&chain, john, wow);
        assert!(Pair::line(john, matt, aud).is_none());
        assert!(Pair::line(john, matt, wow).is_none());

        let skip = Wrapper::push_from(&chain, matt)
            .path_pay(
                seal(
                    &chain,
                    matt,
                    vec![hop(john, aud), hop(josh, wow)],
                    Quantity::new(1_000),
                ),
                Quantity::new(1_000),
                Quantity::new(1),
                0,
            )
            .get()
            .expect_err("Matt cannot skip Josh");
        assert!(
            skip.to_string()
                .contains("insufficient path capacity (line + reverse claim)"),
            "{skip}"
        );

        let back = Wrapper::push_from(&chain, matt)
            .path_pay(
                seal(
                    &chain,
                    matt,
                    vec![hop(josh, aud), hop(john, aud), hop(matt, wow)],
                    Quantity::new(1_000),
                ),
                Quantity::new(1_000),
                Quantity::new(1),
                0,
            )
            .get()
            .expect_err("Matt never lined John in gold");
        assert!(
            back.to_string()
                .contains("insufficient path capacity (line + reverse claim)"),
            "{back}"
        );
        assert_eq!(aud_wow(john, aud, wow), (15_000, 10_000));
        assert_eq!(exp(&chain, josh, matt, aud), 0);

        let buy = vec![hop(josh, aud), hop(john, aud), hop(josh, wow)];
        let no_exit = Wrapper::push_from(&chain, matt)
            .path_pay(
                seal(&chain, matt, buy.clone(), Quantity::new(1_000)),
                Quantity::new(1_000),
                Quantity::new(1),
                0,
            )
            .get()
            .expect_err("Josh has no WOW line to John yet");
        assert!(
            no_exit
                .to_string()
                .contains("insufficient path capacity (line + reverse claim)"),
            "{no_exit}"
        );
        assert_eq!(aud_wow(john, aud, wow), (15_000, 10_000));

        offer_line(&chain, josh, john, wow);
        // 10,000 * 1,000 / 16,000 = 625 gold. Reserves become 16,000 AUD and 9,375 gold.
        Wrapper::push_from(&chain, matt)
            .path_pay(
                seal(&chain, matt, buy, Quantity::new(1_000)),
                Quantity::new(1_000),
                Quantity::new(625),
                0,
            )
            .get()?;
        assert_eq!(exp(&chain, josh, matt, aud), 1_000);
        assert_eq!(exp(&chain, john, josh, aud), 1_000);
        assert_eq!(exp(&chain, josh, john, wow), 625);
        assert_eq!(exp(&chain, john, josh, wow), 0);
        assert_eq!(exp(&chain, josh, matt, wow), 0);
        assert_eq!(exp(&chain, matt, josh, wow), 0);
        assert_eq!(exp(&chain, matt, john, wow), 0);
        assert_eq!(aud_wow(john, aud, wow), (16_000, 9_375));
        Ok(())
    }

    /// Dave buys 90% of John's $5-for-10g quote. The dollars go through Zac.
    ///
    /// John lines Zac, and Zac lines Dave, in AUD. John already owes Dave 10g.
    /// That deposit is not spendable the other way: John still needs Dave's
    /// gold line before the quote can add another 9g. $4.50 at 2g per dollar
    /// is 9g. The quote keeps the last $0.50.
    #[psibase::test_case(packages("Banx"))]
    fn test_dave_buys_ninety_percent_of_johns_gold_quote(
        chain: psibase::Chain,
    ) -> Result<(), psibase::Error> {
        Wrapper::push(&chain).init().get()?;
        let john = account!("john");
        let zac = account!("zac");
        let dave = account!("dave");
        for a in [john, zac, dave] {
            chain.new_account(a).unwrap();
        }
        let aud = Asset::get_by_symbol_assert(account!("aud")).id;
        let wow = Asset::get_by_symbol_assert(account!("wow")).id;
        // Precision 4. $5 is 50_000. 10g is 100_000. 90% is $4.50 and 9g.
        const DEAL_AUD: u64 = 50_000;
        const DEAL_GOLD: u64 = 100_000;
        const PAY_AUD: u64 = 45_000;
        const GOLD_OUT: u64 = 90_000;

        Wrapper::push_from(&chain, john)
            .st_crd_lne(zac, aud, Quantity::new(DEAL_AUD), false)
            .get()?;
        Wrapper::push_from(&chain, zac)
            .st_crd_lne(dave, aud, Quantity::new(DEAL_AUD), false)
            .get()?;
        Wrapper::push_from(&chain, zac)
            .st_glb_fwd(aud, Quantity::new(0), 0, never(), true)
            .get()?;
        Wrapper::push_from(&chain, john)
            .st_glb_fwd(wow, Quantity::new(0), 0, never(), true)
            .get()?;
        Wrapper::push_from(&chain, john)
            .deposit(dave, wow, Quantity::new(DEAL_GOLD), 0)
            .get()?;
        Wrapper::push_from(&chain, john)
            .st_fx_ofr(
                aud,
                wow,
                true,
                Quantity::new(0),
                RATE_SCALE * 2,
                Quantity::new(DEAL_AUD),
                never(),
            )
            .get()?;
        assert_eq!(exp(&chain, dave, john, wow), DEAL_GOLD);

        let buy = vec![hop(zac, aud), hop(john, aud), hop(dave, wow)];
        let no_line = Wrapper::push_from(&chain, dave)
            .path_pay(
                seal(&chain, dave, buy.clone(), Quantity::new(PAY_AUD)),
                Quantity::new(PAY_AUD),
                Quantity::new(GOLD_OUT),
                0,
            )
            .get()
            .expect_err("the deposit is gold John already owes");
        assert!(
            no_line
                .to_string()
                .contains("insufficient path capacity (line + reverse claim)"),
            "{no_line}"
        );
        assert_eq!(exp(&chain, dave, john, wow), DEAL_GOLD);
        assert_eq!(exp(&chain, zac, dave, aud), 0);
        assert_eq!(exp(&chain, john, zac, aud), 0);
        assert_eq!(
            FxOffer::get(john, aud, wow, true).unwrap().remaining.value,
            DEAL_AUD
        );

        // 10g already owed plus 9g from the quote.
        Wrapper::push_from(&chain, dave)
            .st_crd_lne(john, wow, Quantity::new(DEAL_GOLD + GOLD_OUT), false)
            .get()?;
        Wrapper::push_from(&chain, dave)
            .path_pay(
                seal(&chain, dave, buy, Quantity::new(PAY_AUD)),
                Quantity::new(PAY_AUD),
                Quantity::new(GOLD_OUT),
                0,
            )
            .get()?;
        assert_eq!(exp(&chain, zac, dave, aud), PAY_AUD);
        assert_eq!(exp(&chain, john, zac, aud), PAY_AUD);
        assert_eq!(exp(&chain, dave, zac, aud), 0);
        assert_eq!(exp(&chain, zac, john, aud), 0);
        assert_eq!(exp(&chain, dave, john, wow), DEAL_GOLD + GOLD_OUT);
        assert_eq!(exp(&chain, john, dave, wow), 0);
        assert_eq!(
            FxOffer::get(john, aud, wow, true).unwrap().remaining.value,
            DEAL_AUD - PAY_AUD
        );
        Ok(())
    }

    /// Dave buys gold on John's relay. The dollars still go through Zac.
    ///
    /// The weights are the same $5 and 10g as the fixed quote. A constant
    /// product pays 5g for $5, not 10g: 100_000 * 50_000 / 100_000. The
    /// weights are not a debt, so the 10g John already owes Dave does not
    /// fund the return. Dave still has to line John in gold.
    #[psibase::test_case(packages("Banx"))]
    fn test_dave_buys_gold_on_johns_relay(chain: psibase::Chain) -> Result<(), psibase::Error> {
        Wrapper::push(&chain).init().get()?;
        let john = account!("john");
        let zac = account!("zac");
        let dave = account!("dave");
        for a in [john, zac, dave] {
            chain.new_account(a).unwrap();
        }
        let aud = Asset::get_by_symbol_assert(account!("aud")).id;
        let wow = Asset::get_by_symbol_assert(account!("wow")).id;
        // Precision 4. $5 is 50_000. 10g is 100_000. The curve pays 5g.
        const WEIGHT_AUD: u64 = 50_000;
        const WEIGHT_GOLD: u64 = 100_000;
        const PAY_AUD: u64 = 50_000;
        const GOLD_OUT: u64 = 50_000;

        Wrapper::push_from(&chain, john)
            .st_crd_lne(zac, aud, Quantity::new(PAY_AUD), false)
            .get()?;
        Wrapper::push_from(&chain, zac)
            .st_crd_lne(dave, aud, Quantity::new(PAY_AUD), false)
            .get()?;
        Wrapper::push_from(&chain, zac)
            .st_glb_fwd(aud, Quantity::new(0), 0, never(), true)
            .get()?;
        Wrapper::push_from(&chain, john)
            .st_glb_fwd(wow, Quantity::new(0), 0, never(), true)
            .get()?;
        Wrapper::push_from(&chain, john)
            .deposit(dave, wow, Quantity::new(WEIGHT_GOLD), 0)
            .get()?;
        Wrapper::push_from(&chain, john)
            .st_relay(
                aud,
                Quantity::new(WEIGHT_AUD),
                wow,
                Quantity::new(WEIGHT_GOLD),
            )
            .get()?;
        assert_eq!(exp(&chain, dave, john, wow), WEIGHT_GOLD);
        assert_eq!(aud_wow(john, aud, wow), (WEIGHT_AUD, WEIGHT_GOLD));
        assert!(FxOffer::get(john, aud, wow, true).is_none());

        let buy = vec![hop(zac, aud), hop(john, aud), hop(dave, wow)];
        let no_line = Wrapper::push_from(&chain, dave)
            .path_pay(
                seal(&chain, dave, buy.clone(), Quantity::new(PAY_AUD)),
                Quantity::new(PAY_AUD),
                Quantity::new(GOLD_OUT),
                0,
            )
            .get()
            .expect_err("virtual gold is not a line");
        assert!(
            no_line
                .to_string()
                .contains("insufficient path capacity (line + reverse claim)"),
            "{no_line}"
        );
        assert_eq!(exp(&chain, dave, john, wow), WEIGHT_GOLD);
        assert_eq!(exp(&chain, zac, dave, aud), 0);
        assert_eq!(exp(&chain, john, zac, aud), 0);
        assert_eq!(aud_wow(john, aud, wow), (WEIGHT_AUD, WEIGHT_GOLD));

        // 10g already owed plus 5g from the curve.
        Wrapper::push_from(&chain, dave)
            .st_crd_lne(john, wow, Quantity::new(WEIGHT_GOLD + GOLD_OUT), false)
            .get()?;
        Wrapper::push_from(&chain, dave)
            .path_pay(
                seal(&chain, dave, buy, Quantity::new(PAY_AUD)),
                Quantity::new(PAY_AUD),
                Quantity::new(GOLD_OUT),
                0,
            )
            .get()?;
        assert_eq!(exp(&chain, zac, dave, aud), PAY_AUD);
        assert_eq!(exp(&chain, john, zac, aud), PAY_AUD);
        assert_eq!(exp(&chain, dave, zac, aud), 0);
        assert_eq!(exp(&chain, zac, john, aud), 0);
        assert_eq!(exp(&chain, dave, john, wow), WEIGHT_GOLD + GOLD_OUT);
        assert_eq!(exp(&chain, john, dave, wow), 0);
        assert_eq!(
            aud_wow(john, aud, wow),
            (WEIGHT_AUD + PAY_AUD, WEIGHT_GOLD - GOLD_OUT)
        );
        Ok(())
    }

    /// Dave pays Mitchell through John's AUD/WoW relay.
    ///
    /// Dave draws gold on Zac, Zac draws that gold on John, and John's curve
    /// turns it into AUD owed to Mitchell. The weights are $5 and 10g. Sending
    /// 10g returns $2.50: 50_000 * 100_000 / 200_000. Zac's gold forward and
    /// John's dollar forward carry the hops. Mitchell's AUD line is what lets
    /// the dollars land.
    #[psibase::test_case(packages("Banx"))]
    fn test_dave_pays_mitchell_through_johns_aud_wow_relay(
        chain: psibase::Chain,
    ) -> Result<(), psibase::Error> {
        Wrapper::push(&chain).init().get()?;
        let john = account!("john");
        let zac = account!("zac");
        let dave = account!("dave");
        let mitchell = account!("mitchell");
        for a in [john, zac, dave, mitchell] {
            chain.new_account(a).unwrap();
        }
        let aud = Asset::get_by_symbol_assert(account!("aud")).id;
        let wow = Asset::get_by_symbol_assert(account!("wow")).id;
        // Precision 4. $5 is 50_000. 10g is 100_000. 10g in returns $2.50.
        const WEIGHT_AUD: u64 = 50_000;
        const WEIGHT_GOLD: u64 = 100_000;
        const PAY_GOLD: u64 = 100_000;
        const AUD_OUT: u64 = 25_000;

        Wrapper::push_from(&chain, zac)
            .st_crd_lne(dave, wow, Quantity::new(PAY_GOLD), false)
            .get()?;
        Wrapper::push_from(&chain, john)
            .st_crd_lne(zac, wow, Quantity::new(PAY_GOLD), false)
            .get()?;
        Wrapper::push_from(&chain, zac)
            .st_glb_fwd(wow, Quantity::new(0), 0, never(), true)
            .get()?;
        Wrapper::push_from(&chain, john)
            .st_glb_fwd(aud, Quantity::new(0), 0, never(), true)
            .get()?;
        Wrapper::push_from(&chain, john)
            .st_relay(
                aud,
                Quantity::new(WEIGHT_AUD),
                wow,
                Quantity::new(WEIGHT_GOLD),
            )
            .get()?;
        assert_eq!(aud_wow(john, aud, wow), (WEIGHT_AUD, WEIGHT_GOLD));

        let pay = vec![hop(zac, wow), hop(john, wow), hop(mitchell, aud)];
        let no_line = Wrapper::push_from(&chain, dave)
            .path_pay(
                seal(&chain, dave, pay.clone(), Quantity::new(PAY_GOLD)),
                Quantity::new(PAY_GOLD),
                Quantity::new(AUD_OUT),
                0,
            )
            .get()
            .expect_err("Mitchell has not lined John in AUD");
        assert!(
            no_line
                .to_string()
                .contains("insufficient path capacity (line + reverse claim)"),
            "{no_line}"
        );
        assert_eq!(exp(&chain, zac, dave, wow), 0);
        assert_eq!(exp(&chain, john, zac, wow), 0);
        assert_eq!(exp(&chain, mitchell, john, aud), 0);
        assert_eq!(aud_wow(john, aud, wow), (WEIGHT_AUD, WEIGHT_GOLD));

        Wrapper::push_from(&chain, mitchell)
            .st_crd_lne(john, aud, Quantity::new(AUD_OUT), false)
            .get()?;
        Wrapper::push_from(&chain, dave)
            .path_pay(
                seal(&chain, dave, pay, Quantity::new(PAY_GOLD)),
                Quantity::new(PAY_GOLD),
                Quantity::new(AUD_OUT),
                0,
            )
            .get()?;
        assert_eq!(exp(&chain, zac, dave, wow), PAY_GOLD);
        assert_eq!(exp(&chain, john, zac, wow), PAY_GOLD);
        assert_eq!(exp(&chain, mitchell, john, aud), AUD_OUT);
        assert_eq!(exp(&chain, dave, zac, wow), 0);
        assert_eq!(exp(&chain, zac, john, wow), 0);
        assert_eq!(exp(&chain, john, mitchell, aud), 0);
        assert_eq!(
            aud_wow(john, aud, wow),
            (WEIGHT_AUD - AUD_OUT, WEIGHT_GOLD + PAY_GOLD)
        );
        Ok(())
    }

    #[psibase::test_case(packages("Banx"))]
    fn test_fx_offer_convert(chain: psibase::Chain) -> Result<(), psibase::Error> {
        Wrapper::push(&chain).init().get()?;

        let alice = account!("alice");
        let gary = account!("gary");
        chain.new_account(alice).unwrap();
        chain.new_account(gary).unwrap();

        let aud = Asset::get_by_symbol_assert(account!("aud")).id;
        let usd = Asset::get_by_symbol_assert(account!("usd")).id;

        Wrapper::push_from(&chain, gary)
            .st_crd_lne(alice, aud, Quantity::new(10_000), false)
            .get()?;
        Wrapper::push_from(&chain, alice)
            .path_pay(
                seal(&chain, alice, vec![hop(gary, aud)], Quantity::new(100)),
                Quantity::new(100),
                Quantity::new(100),
                0,
            )
            .get()?;

        Wrapper::push_from(&chain, gary)
            .st_fx_ofr(
                aud,
                usd,
                true,
                Quantity::new(0),
                RATE_SCALE * 50 / 100,
                Quantity::new(u64::MAX),
                never(),
            )
            .get()?;

        Wrapper::push_from(&chain, alice)
            .convert(gary, aud, usd, Quantity::new(100), Quantity::new(50))
            .get()?;

        assert_eq!(exp(&chain, gary, alice, aud), 0);
        assert_eq!(exp(&chain, gary, alice, usd), 50);

        Ok(())
    }

    /// No from-asset debt. A buy books both legs at the order rate.
    /// Lines are capacity. No forward offer.
    #[psibase::test_case(packages("Banx"))]
    fn test_take_fx_books_both_legs_at_order_rate(
        chain: psibase::Chain,
    ) -> Result<(), psibase::Error> {
        Wrapper::push(&chain).init().get()?;
        let alice = account!("alice");
        let gary = account!("gary");
        chain.new_account(alice).unwrap();
        chain.new_account(gary).unwrap();
        let aud = Asset::get_by_symbol_assert(account!("aud")).id;
        let usd = Asset::get_by_symbol_assert(account!("usd")).id;

        Wrapper::push_from(&chain, alice)
            .st_crd_lne(gary, aud, Quantity::new(1_000), false)
            .get()?;
        Wrapper::push_from(&chain, alice)
            .st_fx_ofr(
                aud,
                usd,
                true,
                Quantity::new(10),
                RATE_SCALE / 2,
                Quantity::new(200),
                never(),
            )
            .get()?;

        let missing = Wrapper::push_from(&chain, gary)
            .take_fx(alice, aud, usd, true, Quantity::new(100), 45)
            .get()
            .expect_err("Gary has not lined Alice in USD");
        assert!(
            missing
                .to_string()
                .contains("insufficient path capacity (line + reverse claim)"),
            "{missing}"
        );
        assert_eq!(exp(&chain, alice, gary, aud), 0);

        Wrapper::push_from(&chain, gary)
            .st_crd_lne(alice, usd, Quantity::new(1_000), false)
            .get()?;
        let short = Wrapper::push_from(&chain, gary)
            .take_fx(alice, aud, usd, true, Quantity::new(100), 46)
            .get()
            .expect_err("fee leaves 45, below the signed floor");
        assert!(
            short.to_string().contains("trade output below min_to"),
            "{short}"
        );
        // Nothing is owed, so the fill is a receipt. A debt cap is the
        // other side and must not open the position.
        let debt_side = Wrapper::push_from(&chain, gary)
            .take_fx(alice, aud, usd, true, Quantity::new(100), -40)
            .get()
            .expect_err("a fresh buy signed as debt");
        assert!(
            debt_side.to_string().contains("trade output below min_to"),
            "{debt_side}"
        );
        assert_eq!(exp(&chain, alice, gary, aud), 0);
        assert_eq!(exp(&chain, gary, alice, usd), 0);

        Wrapper::push_from(&chain, gary)
            .take_fx(alice, aud, usd, true, Quantity::new(100), 45)
            .get()?;
        // 100 − 10 fee, then half.
        assert_eq!(exp(&chain, alice, gary, aud), 100);
        assert_eq!(exp(&chain, gary, alice, usd), 45);
        assert_eq!(exp(&chain, gary, alice, aud), 0);
        assert_eq!(exp(&chain, alice, gary, usd), 0);
        Ok(())
    }

    /// Leftover debt is a rebook, not a second pair of claims.
    #[psibase::test_case(packages("Banx"))]
    fn test_take_fx_rebooks_existing_debt(chain: psibase::Chain) -> Result<(), psibase::Error> {
        Wrapper::push(&chain).init().get()?;
        let alice = account!("alice");
        let gary = account!("gary");
        chain.new_account(alice).unwrap();
        chain.new_account(gary).unwrap();
        let aud = Asset::get_by_symbol_assert(account!("aud")).id;
        let usd = Asset::get_by_symbol_assert(account!("usd")).id;

        Wrapper::push_from(&chain, alice)
            .st_crd_lne(gary, aud, Quantity::new(1_000), false)
            .get()?;
        Wrapper::push_from(&chain, gary)
            .path_pay(
                seal(&chain, gary, vec![hop(alice, aud)], Quantity::new(100)),
                Quantity::new(100),
                Quantity::new(100),
                0,
            )
            .get()?;
        Wrapper::push_from(&chain, alice)
            .st_fx_ofr(
                aud,
                usd,
                true,
                Quantity::new(0),
                RATE_SCALE / 2,
                Quantity::new(100),
                never(),
            )
            .get()?;

        Wrapper::push_from(&chain, gary)
            .take_fx(alice, aud, usd, true, Quantity::new(100), -50)
            .get()?;
        assert_eq!(exp(&chain, alice, gary, aud), 0);
        assert_eq!(exp(&chain, alice, gary, usd), 50);
        assert_eq!(exp(&chain, gary, alice, usd), 0);
        // Actor is who owes the new asset, so each feed can say which way it faces.
        let gary_row = activity_nodes(&chain, gary)
            .into_iter()
            .find(|n| n.get("kind").and_then(|k| k.as_str()) == Some("convert"))
            .expect("gary convert row");
        assert_eq!(gary_row["actor"], "gary");
        assert_eq!(gary_row["counterparty"], "alice");
        let alice_row = activity_nodes(&chain, alice)
            .into_iter()
            .find(|n| n.get("kind").and_then(|k| k.as_str()) == Some("convert"))
            .expect("alice convert row");
        assert_eq!(alice_row["actor"], "gary");
        assert_eq!(alice_row["counterparty"], "gary");
        Ok(())
    }

    /// A buy larger than the old bill rebooks that bill and opens the rest.
    /// The signed bound is the net of the two to-asset results.
    #[psibase::test_case(packages("Banx"))]
    fn test_take_fx_buy_fills_past_existing_debt(
        chain: psibase::Chain,
    ) -> Result<(), psibase::Error> {
        Wrapper::push(&chain).init().get()?;
        let alice = account!("alice");
        let gary = account!("gary");
        chain.new_account(alice).unwrap();
        chain.new_account(gary).unwrap();
        let aud = Asset::get_by_symbol_assert(account!("aud")).id;
        let usd = Asset::get_by_symbol_assert(account!("usd")).id;

        Wrapper::push_from(&chain, alice)
            .st_crd_lne(gary, aud, Quantity::new(1_000), false)
            .get()?;
        Wrapper::push_from(&chain, gary)
            .path_pay(
                seal(&chain, gary, vec![hop(alice, aud)], Quantity::new(10)),
                Quantity::new(10),
                Quantity::new(10),
                0,
            )
            .get()?;
        Wrapper::push_from(&chain, gary)
            .st_crd_lne(alice, usd, Quantity::new(1_000), false)
            .get()?;
        Wrapper::push_from(&chain, alice)
            .st_fx_ofr(
                aud,
                usd,
                true,
                Quantity::new(0),
                RATE_SCALE / 2,
                Quantity::new(200),
                never(),
            )
            .get()?;

        // 10 rebooks to 5 of debt. 90 opens 45 of receipt. Net 40.
        let short = Wrapper::push_from(&chain, gary)
            .take_fx(alice, aud, usd, true, Quantity::new(100), 41)
            .get()
            .expect_err("net receipt is 40, below the signed floor");
        assert!(
            short.to_string().contains("trade output below min_to"),
            "{short}"
        );
        assert_eq!(exp(&chain, alice, gary, aud), 10);

        Wrapper::push_from(&chain, gary)
            .take_fx(alice, aud, usd, true, Quantity::new(100), 40)
            .get()?;
        assert_eq!(exp(&chain, alice, gary, aud), 90);
        assert_eq!(exp(&chain, gary, alice, usd), 40);
        assert_eq!(exp(&chain, alice, gary, usd), 0);
        assert_eq!(exp(&chain, gary, alice, aud), 0);
        Ok(())
    }

    /// A signed receipt must not fill as a debt of the same size when the
    /// from-asset exposure crosses the preview. A signed wash is not unbounded.
    #[psibase::test_case(packages("Banx"))]
    fn test_take_fx_bound_keeps_signed_side(chain: psibase::Chain) -> Result<(), psibase::Error> {
        Wrapper::push(&chain).init().get()?;
        let alice = account!("alice");
        let gary = account!("gary");
        chain.new_account(alice).unwrap();
        chain.new_account(gary).unwrap();
        let aud = Asset::get_by_symbol_assert(account!("aud")).id;
        let usd = Asset::get_by_symbol_assert(account!("usd")).id;

        Wrapper::push_from(&chain, alice)
            .st_crd_lne(gary, aud, Quantity::new(1_000), false)
            .get()?;
        Wrapper::push_from(&chain, gary)
            .st_crd_lne(alice, usd, Quantity::new(1_000), false)
            .get()?;
        Wrapper::push_from(&chain, gary)
            .path_pay(
                seal(&chain, gary, vec![hop(alice, aud)], Quantity::new(51)),
                Quantity::new(51),
                Quantity::new(51),
                0,
            )
            .get()?;
        Wrapper::push_from(&chain, alice)
            .st_fx_ofr(
                aud,
                usd,
                true,
                Quantity::new(0),
                RATE_SCALE / 2,
                Quantity::new(200),
                never(),
            )
            .get()?;

        // Preview at owed 49 signs a receipt of 1. Execution at owed 51 is a
        // debt of 1. The same absolute bound must not pass.
        let crossed = Wrapper::push_from(&chain, gary)
            .take_fx(alice, aud, usd, true, Quantity::new(100), 1)
            .get()
            .expect_err("a signed receipt cannot fill as a debt");
        assert!(
            crossed.to_string().contains("trade output below min_to"),
            "{crossed}"
        );
        assert_eq!(exp(&chain, alice, gary, aud), 51);

        // A previewed wash signs 0. A later debt is still rejected.
        let wash = Wrapper::push_from(&chain, gary)
            .take_fx(alice, aud, usd, true, Quantity::new(100), 0)
            .get()
            .expect_err("a signed wash cannot fill as a debt");
        assert!(
            wash.to_string().contains("trade output below min_to"),
            "{wash}"
        );
        assert_eq!(exp(&chain, alice, gary, aud), 51);

        // The wash has to hold after the debt covers the whole click. A pure
        // rebook is debt, so 0 is not an open cap.
        Wrapper::push_from(&chain, gary)
            .path_pay(
                seal(&chain, gary, vec![hop(alice, aud)], Quantity::new(49)),
                Quantity::new(49),
                Quantity::new(49),
                0,
            )
            .get()?;
        assert_eq!(exp(&chain, alice, gary, aud), 100);
        let covered = Wrapper::push_from(&chain, gary)
            .take_fx(alice, aud, usd, true, Quantity::new(100), 0)
            .get()
            .expect_err("a signed wash cannot fill as a pure rebook");
        assert!(
            covered.to_string().contains("trade output below min_to"),
            "{covered}"
        );
        // 100 at half becomes 50 of debt. A cap of 49 is the same miss.
        let cap = Wrapper::push_from(&chain, gary)
            .take_fx(alice, aud, usd, true, Quantity::new(100), -49)
            .get()
            .expect_err("pure rebook debt is 50, below a cap of -49");
        assert!(
            cap.to_string().contains("trade output below min_to"),
            "{cap}"
        );
        assert_eq!(exp(&chain, alice, gary, aud), 100);
        assert_eq!(exp(&chain, alice, gary, usd), 0);
        Ok(())
    }

    /// Fee is charged on each slice. A debt cap still rejects a larger debt.
    #[psibase::test_case(packages("Banx"))]
    fn test_take_fx_split_fee_keeps_debt_cap(chain: psibase::Chain) -> Result<(), psibase::Error> {
        Wrapper::push(&chain).init().get()?;
        let alice = account!("alice");
        let gary = account!("gary");
        chain.new_account(alice).unwrap();
        chain.new_account(gary).unwrap();
        let aud = Asset::get_by_symbol_assert(account!("aud")).id;
        let usd = Asset::get_by_symbol_assert(account!("usd")).id;

        Wrapper::push_from(&chain, alice)
            .st_crd_lne(gary, aud, Quantity::new(1_000), false)
            .get()?;
        Wrapper::push_from(&chain, gary)
            .st_crd_lne(alice, usd, Quantity::new(1_000), false)
            .get()?;
        Wrapper::push_from(&chain, gary)
            .path_pay(
                seal(&chain, gary, vec![hop(alice, aud)], Quantity::new(80)),
                Quantity::new(80),
                Quantity::new(80),
                0,
            )
            .get()?;
        Wrapper::push_from(&chain, alice)
            .st_fx_ofr(
                aud,
                usd,
                true,
                Quantity::new(10),
                RATE_SCALE / 2,
                Quantity::new(200),
                never(),
            )
            .get()?;

        // 80 + 10 rebooks to 45 of debt. 20 − 10 opens 5 of receipt. Net is -40.
        let over = Wrapper::push_from(&chain, gary)
            .take_fx(alice, aud, usd, true, Quantity::new(100), -39)
            .get()
            .expect_err("net is -40, below a cap of -39");
        assert!(
            over.to_string().contains("trade output below min_to"),
            "{over}"
        );
        assert_eq!(exp(&chain, alice, gary, aud), 80);

        Wrapper::push_from(&chain, gary)
            .take_fx(alice, aud, usd, true, Quantity::new(100), -40)
            .get()?;
        assert_eq!(exp(&chain, alice, gary, aud), 20);
        assert_eq!(exp(&chain, alice, gary, usd), 40);
        assert_eq!(exp(&chain, gary, alice, usd), 0);
        Ok(())
    }

    /// One unit the poster already owes must not turn a buy into a sell.
    /// No sell row exists. The buy still opens, and that unit nets on the from-leg.
    #[psibase::test_case(packages("Banx"))]
    fn test_take_fx_buy_nets_reverse_claim(chain: psibase::Chain) -> Result<(), psibase::Error> {
        Wrapper::push(&chain).init().get()?;
        let alice = account!("alice");
        let gary = account!("gary");
        chain.new_account(alice).unwrap();
        chain.new_account(gary).unwrap();
        let aud = Asset::get_by_symbol_assert(account!("aud")).id;
        let usd = Asset::get_by_symbol_assert(account!("usd")).id;

        Wrapper::push_from(&chain, alice)
            .st_crd_lne(gary, aud, Quantity::new(1_000), false)
            .get()?;
        Wrapper::push_from(&chain, gary)
            .st_crd_lne(alice, usd, Quantity::new(1_000), false)
            .get()?;
        // Alice owes Gary 1 AUD. That must not select a sell.
        Wrapper::push_from(&chain, alice)
            .deposit(gary, aud, Quantity::new(1), 0)
            .get()?;
        Wrapper::push_from(&chain, alice)
            .st_fx_ofr(
                aud,
                usd,
                true,
                Quantity::new(0),
                RATE_SCALE / 2,
                Quantity::new(200),
                never(),
            )
            .get()?;

        Wrapper::push_from(&chain, gary)
            .take_fx(alice, aud, usd, true, Quantity::new(100), 50)
            .get()?;
        assert_eq!(exp(&chain, alice, gary, aud), 99);
        assert_eq!(exp(&chain, gary, alice, aud), 0);
        assert_eq!(exp(&chain, gary, alice, usd), 50);
        assert_eq!(exp(&chain, alice, gary, usd), 0);
        assert!(FxOffer::get(alice, aud, usd, false).is_none());
        Ok(())
    }

    /// Debtor takes the creditor's rebook quote. `min_to` is a floor on the
    /// new to-asset debt, so a worse rate still clears it. Alice signed for
    /// 50 USD (`test_fx_offer_convert`). Gary then posts 5.0. That
    /// take must not land: she would owe 500 USD for the same 100 AUD.
    #[psibase::test_case(packages("Banx"))]
    fn test_convert_debtor_min_to_rejects_worse_rate(
        chain: psibase::Chain,
    ) -> Result<(), psibase::Error> {
        Wrapper::push(&chain).init().get()?;
        let alice = account!("alice");
        let gary = account!("gary");
        chain.new_account(alice).unwrap();
        chain.new_account(gary).unwrap();
        let aud = Asset::get_by_symbol_assert(account!("aud")).id;
        let usd = Asset::get_by_symbol_assert(account!("usd")).id;

        Wrapper::push_from(&chain, gary)
            .st_crd_lne(alice, aud, Quantity::new(10_000), false)
            .get()?;
        Wrapper::push_from(&chain, alice)
            .path_pay(
                seal(&chain, alice, vec![hop(gary, aud)], Quantity::new(100)),
                Quantity::new(100),
                Quantity::new(100),
                0,
            )
            .get()?;
        Wrapper::push_from(&chain, gary)
            .st_fx_ofr(
                aud,
                usd,
                true,
                Quantity::new(0),
                RATE_SCALE * 50 / 100,
                Quantity::new(u64::MAX),
                never(),
            )
            .get()?;

        // Same action Alice would send for the 0.50 quote. Gary has replaced it.
        Wrapper::push_from(&chain, gary)
            .st_fx_ofr(
                aud,
                usd,
                true,
                Quantity::new(0),
                RATE_SCALE * 5,
                Quantity::new(u64::MAX),
                never(),
            )
            .get()?;
        let taken = Wrapper::push_from(&chain, alice)
            .convert(gary, aud, usd, Quantity::new(100), Quantity::new(50))
            .get();
        assert!(
            taken.is_err(),
            "convert let a debtor-side take clear min_to=50 at 5.0 (new debt 500); \
             the bound has to cap what the taker will owe, got {taken:?}"
        );
        assert_eq!(
            exp(&chain, gary, alice, aud),
            100,
            "worse rate must leave the from-asset debt"
        );
        assert_eq!(
            exp(&chain, gary, alice, usd),
            0,
            "worse rate must not book the unquoted to-asset debt"
        );
        Ok(())
    }

    /// Isabelle owes John 10 kWh. He posts the creditor side: 1 kWh → 0.30 AUD
    /// with a 1 kWh fee. The fee is his charge, so she owes 3.30 AUD
    /// (3.00 for the kWh plus 0.30 for the fee). The kWh debt is gone.
    #[psibase::test_case(packages("Banx"))]
    fn test_posted_fee_favours_john_when_isabelle_converts_kwh(
        chain: psibase::Chain,
    ) -> Result<(), psibase::Error> {
        Wrapper::push(&chain).init().get()?;

        let john = account!("john");
        let isabelle = account!("isabelle");
        chain.new_account(john).unwrap();
        chain.new_account(isabelle).unwrap();

        let kwh = Asset::get_by_symbol_assert(account!("kwh")).id;
        let aud = Asset::get_by_symbol_assert(account!("aud")).id;

        // kWh is 3 decimals (1.000 = 1 kWh). AUD is 4 decimals.
        let one_kwh = 1_000u64;
        let ten_kwh = 10 * one_kwh;
        let fee_kwh = one_kwh;
        let aud_for_one_kwh = 3_000u64;
        let rate = aud_for_one_kwh * RATE_SCALE / one_kwh;
        // 10 × 0.30 AUD, plus the 1 kWh fee priced at the same rate.
        let fair_aud = aud_for_one_kwh * 10 + aud_for_one_kwh;

        // Isabelle books the kWh, so she owes John.
        Wrapper::push_from(&chain, isabelle)
            .deposit(john, kwh, Quantity::new(ten_kwh), 0)
            .get()?;
        assert_eq!(exp(&chain, john, isabelle, kwh), ten_kwh);

        Wrapper::push_from(&chain, john)
            .st_fx_ofr(
                kwh,
                aud,
                true,
                Quantity::new(fee_kwh),
                rate,
                Quantity::new(ten_kwh),
                never(),
            )
            .get()?;

        Wrapper::push_from(&chain, isabelle)
            .convert(john, kwh, aud, Quantity::new(ten_kwh), Quantity::new(0))
            .get()?;

        assert_eq!(exp(&chain, john, isabelle, kwh), 0);
        assert_eq!(
            exp(&chain, john, isabelle, aud),
            fair_aud,
            "fee should favour John: 3.30 AUD, not (10 kWh − 1 kWh fee) × 0.30"
        );

        Ok(())
    }

    /// John owes Isabelle 10 kWh. His creditor-side quote does not apply.
    /// He posts the debtor side at the same 1 kWh → 0.30 AUD with a 1 kWh
    /// fee. She takes it, and the fee comes off what he owes: 2.70 AUD.
    #[psibase::test_case(packages("Banx"))]
    fn test_posted_fee_shrinks_debt_when_john_owes_isabelle_kwh(
        chain: psibase::Chain,
    ) -> Result<(), psibase::Error> {
        Wrapper::push(&chain).init().get()?;

        let john = account!("john");
        let isabelle = account!("isabelle");
        chain.new_account(john).unwrap();
        chain.new_account(isabelle).unwrap();

        let kwh = Asset::get_by_symbol_assert(account!("kwh")).id;
        let aud = Asset::get_by_symbol_assert(account!("aud")).id;

        let one_kwh = 1_000u64;
        let ten_kwh = 10 * one_kwh;
        let fee_kwh = one_kwh;
        let aud_for_one_kwh = 3_000u64;
        let rate = aud_for_one_kwh * RATE_SCALE / one_kwh;
        // (10 kWh − 1 kWh fee) × 0.30 AUD.
        let owing_aud = aud_for_one_kwh * 9;

        // John books the kWh, so he owes Isabelle.
        Wrapper::push_from(&chain, john)
            .deposit(isabelle, kwh, Quantity::new(ten_kwh), 0)
            .get()?;
        assert_eq!(exp(&chain, isabelle, john, kwh), ten_kwh);

        Wrapper::push_from(&chain, john)
            .st_fx_ofr(
                kwh,
                aud,
                true,
                Quantity::new(fee_kwh),
                rate,
                Quantity::new(ten_kwh),
                never(),
            )
            .get()?;

        let wrong_side = Wrapper::push_from(&chain, isabelle).convert(
            john,
            kwh,
            aud,
            Quantity::new(ten_kwh),
            Quantity::new(0),
        );
        let err = wrong_side
            .trace
            .error
            .as_deref()
            .unwrap_or("(no error — convert succeeded)");
        assert!(
            err.contains("FxOffer not found"),
            "creditor-side quote must not rebook debt John owes, got {err}"
        );
        assert_eq!(exp(&chain, isabelle, john, kwh), ten_kwh);
        assert_eq!(exp(&chain, isabelle, john, aud), 0);
        assert_eq!(
            FxOffer::get(john, kwh, aud, true).unwrap().remaining.value,
            ten_kwh
        );

        Wrapper::push_from(&chain, john)
            .st_fx_ofr(
                kwh,
                aud,
                false,
                Quantity::new(fee_kwh),
                rate,
                Quantity::new(ten_kwh),
                never(),
            )
            .get()?;

        Wrapper::push_from(&chain, isabelle)
            .convert(john, kwh, aud, Quantity::new(ten_kwh), Quantity::new(0))
            .get()?;

        assert_eq!(exp(&chain, isabelle, john, kwh), 0);
        assert_eq!(
            exp(&chain, isabelle, john, aud),
            owing_aud,
            "fee should favour John: 2.70 AUD"
        );
        assert!(FxOffer::get(john, kwh, aud, false).is_none());
        assert_eq!(
            FxOffer::get(john, kwh, aud, true).unwrap().remaining.value,
            ten_kwh,
            "the other side's budget stays"
        );

        Ok(())
    }

    /// Isabelle owes John 10 kWh. She converts 5, with a 1 kWh fee.
    /// Creditor side prices 6 kWh (1.80 AUD). Debtor side prices 4 kWh
    /// (1.20 AUD). The budget falls by the 5 kWh she converted.
    #[psibase::test_case(packages("Banx"))]
    fn test_fx_quote_partial_take_prices_the_fee_and_spends_the_take(
        chain: psibase::Chain,
    ) -> Result<(), psibase::Error> {
        Wrapper::push(&chain).init().get()?;

        let john = account!("john");
        let isabelle = account!("isabelle");
        chain.new_account(john).unwrap();
        chain.new_account(isabelle).unwrap();

        let kwh = Asset::get_by_symbol_assert(account!("kwh")).id;
        let aud = Asset::get_by_symbol_assert(account!("aud")).id;

        let one_kwh = 1_000u64;
        let ten_kwh = 10 * one_kwh;
        let five_kwh = 5 * one_kwh;
        let fee_kwh = one_kwh;
        let aud_for_one_kwh = 3_000u64;
        let rate = aud_for_one_kwh * RATE_SCALE / one_kwh;
        // (5 kWh + 1 kWh fee) × 0.30 AUD.
        let creditor_aud = aud_for_one_kwh * 6;
        // (5 kWh − 1 kWh fee) × 0.30 AUD.
        let debtor_aud = aud_for_one_kwh * 4;

        Wrapper::push_from(&chain, isabelle)
            .deposit(john, kwh, Quantity::new(ten_kwh), 0)
            .get()?;
        Wrapper::push_from(&chain, john)
            .st_fx_ofr(
                kwh,
                aud,
                true,
                Quantity::new(fee_kwh),
                rate,
                Quantity::new(ten_kwh),
                never(),
            )
            .get()?;

        Wrapper::push_from(&chain, isabelle)
            .convert(john, kwh, aud, Quantity::new(five_kwh), Quantity::new(0))
            .get()?;

        assert_eq!(exp(&chain, john, isabelle, kwh), five_kwh);
        assert_eq!(exp(&chain, john, isabelle, aud), creditor_aud);
        assert_eq!(
            FxOffer::get(john, kwh, aud, true).unwrap().remaining.value,
            five_kwh,
            "budget falls by the 5 kWh converted, not by take plus fee"
        );

        // Clear that book, then the same numbers the other way.
        Wrapper::push_from(&chain, john)
            .deposit(isabelle, kwh, Quantity::new(five_kwh), 0)
            .get()?;
        Wrapper::push_from(&chain, john)
            .deposit(isabelle, aud, Quantity::new(creditor_aud), 0)
            .get()?;
        assert_eq!(exp(&chain, john, isabelle, kwh), 0);
        assert_eq!(exp(&chain, john, isabelle, aud), 0);

        Wrapper::push_from(&chain, john)
            .deposit(isabelle, kwh, Quantity::new(ten_kwh), 0)
            .get()?;
        Wrapper::push_from(&chain, john)
            .st_fx_ofr(
                kwh,
                aud,
                false,
                Quantity::new(fee_kwh),
                rate,
                Quantity::new(ten_kwh),
                never(),
            )
            .get()?;
        Wrapper::push_from(&chain, isabelle)
            .convert(john, kwh, aud, Quantity::new(five_kwh), Quantity::new(0))
            .get()?;

        assert_eq!(exp(&chain, isabelle, john, kwh), five_kwh);
        assert_eq!(exp(&chain, isabelle, john, aud), debtor_aud);
        assert_eq!(
            FxOffer::get(john, kwh, aud, false).unwrap().remaining.value,
            five_kwh
        );
        assert_eq!(
            FxOffer::get(john, kwh, aud, true).unwrap().remaining.value,
            five_kwh,
            "the creditor-side budget stays at the earlier partial take"
        );

        Ok(())
    }

    /// A debtor-side fee that is the whole take, or more than the take, is
    /// rejected and changes nothing. The same take on the creditor side
    /// prices take + fee, so it goes through.
    #[psibase::test_case(packages("Banx"))]
    fn test_fx_quote_debtor_fee_that_consumes_the_take_fails(
        chain: psibase::Chain,
    ) -> Result<(), psibase::Error> {
        Wrapper::push(&chain).init().get()?;

        let john = account!("john");
        let isabelle = account!("isabelle");
        chain.new_account(john).unwrap();
        chain.new_account(isabelle).unwrap();

        let kwh = Asset::get_by_symbol_assert(account!("kwh")).id;
        let aud = Asset::get_by_symbol_assert(account!("aud")).id;

        let one_kwh = 1_000u64;
        let ten_kwh = 10 * one_kwh;
        let fee_kwh = one_kwh;
        let aud_for_one_kwh = 3_000u64;
        let rate = aud_for_one_kwh * RATE_SCALE / one_kwh;
        // (1 kWh + 1 kWh fee) × 0.30 AUD.
        let creditor_aud = aud_for_one_kwh * 2;

        Wrapper::push_from(&chain, john)
            .deposit(isabelle, kwh, Quantity::new(ten_kwh), 0)
            .get()?;
        Wrapper::push_from(&chain, john)
            .st_fx_ofr(
                kwh,
                aud,
                false,
                Quantity::new(fee_kwh),
                rate,
                Quantity::new(ten_kwh),
                never(),
            )
            .get()?;

        for take in [one_kwh, one_kwh / 2] {
            let rejected = Wrapper::push_from(&chain, isabelle).convert(
                john,
                kwh,
                aud,
                Quantity::new(take),
                Quantity::new(0),
            );
            let err = rejected
                .trace
                .error
                .as_deref()
                .unwrap_or("(no error — convert succeeded)");
            assert!(
                err.contains("fixed fee consumes entire amount"),
                "take {take} with a {fee_kwh} fee: {err}"
            );
        }
        assert_eq!(exp(&chain, isabelle, john, kwh), ten_kwh);
        assert_eq!(exp(&chain, isabelle, john, aud), 0);
        assert_eq!(
            FxOffer::get(john, kwh, aud, false).unwrap().remaining.value,
            ten_kwh
        );

        // Flip the book: Isabelle owes John 1 kWh. Adding the fee prices 2 kWh.
        Wrapper::push_from(&chain, isabelle)
            .deposit(john, kwh, Quantity::new(ten_kwh + one_kwh), 0)
            .get()?;
        assert_eq!(exp(&chain, john, isabelle, kwh), one_kwh);
        assert_eq!(exp(&chain, isabelle, john, kwh), 0);
        Wrapper::push_from(&chain, john)
            .st_fx_ofr(
                kwh,
                aud,
                true,
                Quantity::new(fee_kwh),
                rate,
                Quantity::new(ten_kwh),
                never(),
            )
            .get()?;
        Wrapper::push_from(&chain, isabelle)
            .convert(john, kwh, aud, Quantity::new(one_kwh), Quantity::new(0))
            .get()?;

        assert_eq!(exp(&chain, john, isabelle, kwh), 0);
        assert_eq!(exp(&chain, john, isabelle, aud), creditor_aud);
        assert_eq!(
            FxOffer::get(john, kwh, aud, true).unwrap().remaining.value,
            ten_kwh - one_kwh
        );
        assert_eq!(
            FxOffer::get(john, kwh, aud, false).unwrap().remaining.value,
            ten_kwh
        );

        Ok(())
    }

    /// 1.20 with 5% off each way. Posts the four rows an exchange would:
    /// both directions, both debt sides, no fixed fee. A USD→AUD row does
    /// not quote AUD→USD.
    #[psibase::test_case(packages("Banx"))]
    fn test_fx_quote_exchange_both_directions_and_both_debt_sides(
        chain: psibase::Chain,
    ) -> Result<(), psibase::Error> {
        let spread = PPM_SCALE * 5 / 100;
        let (forward, back) = crate::math::try_exchange_rates(1_200_000, spread).unwrap();
        assert_eq!((forward, back), (1_140_000, 791_666));
        assert_eq!(crate::math::try_exchange_rates(0, 0), None);
        assert_eq!(crate::math::try_exchange_rates(1_200_000, PPM_SCALE), None);
        assert_eq!(crate::math::try_exchange_rates(1, PPM_SCALE - 1), None);
        assert_eq!(crate::math::try_exchange_rates(1_000_000_000_001, 0), None);

        Wrapper::push(&chain).init().get()?;

        let john = account!("john");
        let isabelle = account!("isabelle");
        chain.new_account(john).unwrap();
        chain.new_account(isabelle).unwrap();

        let usd = Asset::get_by_symbol_assert(account!("usd")).id;
        let aud = Asset::get_by_symbol_assert(account!("aud")).id;
        // Precision 4: 10.0000 of either asset.
        let ten = 100_000u64;

        let same = Wrapper::push_from(&chain, john).st_fx_ofr(
            usd,
            usd,
            true,
            Quantity::new(0),
            forward,
            Quantity::new(ten),
            never(),
        );
        let err = same.trace.error.as_deref().unwrap_or("(no error)");
        assert!(
            err.contains("currency convert requires different assets"),
            "{err}"
        );
        assert!(FxOffer::get(john, usd, usd, true).is_none());

        for side in [true, false] {
            Wrapper::push_from(&chain, john)
                .st_fx_ofr(
                    usd,
                    aud,
                    side,
                    Quantity::new(0),
                    forward,
                    Quantity::new(ten),
                    never(),
                )
                .get()?;
        }

        // She owes him 1 raw AUD. USD→AUD rows must not fill in the other way.
        Wrapper::push_from(&chain, isabelle)
            .deposit(john, aud, Quantity::new(1), 0)
            .get()?;
        let missing = Wrapper::push_from(&chain, isabelle).convert(
            john,
            aud,
            usd,
            Quantity::new(1),
            Quantity::new(0),
        );
        let err = missing
            .trace
            .error
            .as_deref()
            .unwrap_or("(no error — convert succeeded)");
        assert!(
            err.contains("FxOffer not found"),
            "USD→AUD must not quote AUD→USD, got {err}"
        );
        assert_eq!(exp(&chain, john, isabelle, aud), 1);
        assert_eq!(exp(&chain, john, isabelle, usd), 0);
        Wrapper::push_from(&chain, john)
            .deposit(isabelle, aud, Quantity::new(1), 0)
            .get()?;
        assert_eq!(exp(&chain, john, isabelle, aud), 0);
        assert_eq!(exp(&chain, isabelle, john, aud), 0);

        // They owe him 10 USD. 10 × 1.14 = 11.4000 AUD.
        Wrapper::push_from(&chain, isabelle)
            .deposit(john, usd, Quantity::new(ten), 0)
            .get()?;
        Wrapper::push_from(&chain, isabelle)
            .convert(john, usd, aud, Quantity::new(ten), Quantity::new(0))
            .get()?;
        assert_eq!(exp(&chain, john, isabelle, usd), 0);
        assert_eq!(exp(&chain, john, isabelle, aud), 114_000);
        assert!(FxOffer::get(john, usd, aud, true).is_none());
        assert_eq!(
            FxOffer::get(john, usd, aud, false).unwrap().remaining.value,
            ten
        );

        Wrapper::push_from(&chain, john)
            .deposit(isabelle, aud, Quantity::new(114_000), 0)
            .get()?;
        assert_eq!(exp(&chain, john, isabelle, aud), 0);

        // He owes her 10 USD. Same rate, the other debt side.
        Wrapper::push_from(&chain, john)
            .deposit(isabelle, usd, Quantity::new(ten), 0)
            .get()?;
        Wrapper::push_from(&chain, isabelle)
            .convert(john, usd, aud, Quantity::new(ten), Quantity::new(0))
            .get()?;
        assert_eq!(exp(&chain, isabelle, john, usd), 0);
        assert_eq!(exp(&chain, isabelle, john, aud), 114_000);
        assert!(FxOffer::get(john, usd, aud, false).is_none());
        Wrapper::push_from(&chain, isabelle)
            .deposit(john, aud, Quantity::new(114_000), 0)
            .get()?;
        assert_eq!(exp(&chain, isabelle, john, aud), 0);

        for side in [true, false] {
            Wrapper::push_from(&chain, john)
                .st_fx_ofr(
                    aud,
                    usd,
                    side,
                    Quantity::new(0),
                    back,
                    Quantity::new(ten),
                    never(),
                )
                .get()?;
        }
        assert!(FxOffer::get(john, usd, aud, true).is_none());
        assert!(FxOffer::get(john, usd, aud, false).is_none());
        for side in [true, false] {
            let row = FxOffer::get(john, aud, usd, side).unwrap();
            assert_eq!(row.fee_fixed.value, 0);
            assert_eq!(row.fx_rate, back);
            assert_eq!(row.remaining.value, ten);
        }

        // 10 AUD × 0.791666, truncated, is 7.9166 USD.
        Wrapper::push_from(&chain, isabelle)
            .deposit(john, aud, Quantity::new(ten), 0)
            .get()?;
        Wrapper::push_from(&chain, isabelle)
            .convert(john, aud, usd, Quantity::new(ten), Quantity::new(0))
            .get()?;
        assert_eq!(exp(&chain, john, isabelle, aud), 0);
        assert_eq!(exp(&chain, john, isabelle, usd), 79_166);
        assert!(FxOffer::get(john, aud, usd, true).is_none());
        assert_eq!(
            FxOffer::get(john, aud, usd, false).unwrap().remaining.value,
            ten
        );

        Wrapper::push_from(&chain, john)
            .deposit(isabelle, usd, Quantity::new(79_166), 0)
            .get()?;
        Wrapper::push_from(&chain, john)
            .deposit(isabelle, aud, Quantity::new(ten), 0)
            .get()?;
        Wrapper::push_from(&chain, isabelle)
            .convert(john, aud, usd, Quantity::new(ten), Quantity::new(0))
            .get()?;
        assert_eq!(exp(&chain, isabelle, john, aud), 0);
        assert_eq!(exp(&chain, isabelle, john, usd), 79_166);
        assert!(FxOffer::get(john, aud, usd, false).is_none());
        assert!(
            FxOffer::get(john, usd, aud, true).is_none(),
            "the other direction stays gone after it was spent"
        );

        Ok(())
    }

    /// From-asset `remaining` caps convert and path FX. A take larger than
    /// what is left is rejected whole. Posting again replaces what is left.
    #[psibase::test_case(packages("Banx"))]
    fn test_fx_offer_remaining_caps_convert_and_path(
        chain: psibase::Chain,
    ) -> Result<(), psibase::Error> {
        Wrapper::push(&chain).init().get()?;
        let alice = account!("alice");
        let gary = account!("gary");
        let steve = account!("steve");
        for a in [alice, gary, steve] {
            chain.new_account(a).unwrap();
        }
        let aud = Asset::get_by_symbol_assert(account!("aud")).id;
        let usd = Asset::get_by_symbol_assert(account!("usd")).id;

        Wrapper::push_from(&chain, gary)
            .st_crd_lne(alice, aud, Quantity::new(10_000), false)
            .get()?;
        Wrapper::push_from(&chain, alice)
            .path_pay(
                seal(&chain, alice, vec![hop(gary, aud)], Quantity::new(100)),
                Quantity::new(100),
                Quantity::new(100),
                0,
            )
            .get()?;

        let zero = Wrapper::push_from(&chain, gary).st_fx_ofr(
            aud,
            usd,
            true,
            Quantity::new(0),
            RATE_SCALE * 50 / 100,
            Quantity::new(0),
            never(),
        );
        let err = zero.trace.error.as_deref().unwrap_or("(no error)");
        assert!(
            err.contains("fx offer remaining must be positive"),
            "zero remaining: {err}"
        );
        assert!(FxOffer::get(gary, aud, usd, true).is_none());

        Wrapper::push_from(&chain, gary)
            .st_fx_ofr(
                aud,
                usd,
                true,
                Quantity::new(0),
                RATE_SCALE * 50 / 100,
                Quantity::new(40),
                never(),
            )
            .get()?;

        let over = Wrapper::push_from(&chain, alice).convert(
            gary,
            aud,
            usd,
            Quantity::new(100),
            Quantity::new(0),
        );
        let err = over.trace.error.as_deref().unwrap_or("(no error)");
        assert!(
            err.contains("fx offer amount exceeds remaining"),
            "convert over remaining: {err}"
        );
        assert_eq!(exp(&chain, gary, alice, aud), 100);
        assert_eq!(exp(&chain, gary, alice, usd), 0);
        assert_eq!(
            FxOffer::get_assert(gary, aud, usd, true).remaining.value,
            40
        );

        Wrapper::push_from(&chain, alice)
            .convert(gary, aud, usd, Quantity::new(40), Quantity::new(20))
            .get()?;
        assert_eq!(exp(&chain, gary, alice, aud), 60);
        assert_eq!(exp(&chain, gary, alice, usd), 20);
        assert!(FxOffer::get(gary, aud, usd, true).is_none());
        assert!(Wrapper::push_from(&chain, alice)
            .convert(gary, aud, usd, Quantity::new(1), Quantity::new(0))
            .get()
            .is_err());
        assert_eq!(exp(&chain, gary, alice, aud), 60);

        // 60 of exposure against a budget of 50 must not fill 50 and leave 10.
        Wrapper::push_from(&chain, gary)
            .st_fx_ofr(
                aud,
                usd,
                true,
                Quantity::new(0),
                RATE_SCALE * 50 / 100,
                Quantity::new(50),
                never(),
            )
            .get()?;
        let partial = Wrapper::push_from(&chain, alice).convert(
            gary,
            aud,
            usd,
            Quantity::new(100),
            Quantity::new(0),
        );
        let err = partial.trace.error.as_deref().unwrap_or("(no error)");
        assert!(
            err.contains("fx offer amount exceeds remaining"),
            "no partial fill: {err}"
        );
        assert_eq!(exp(&chain, gary, alice, aud), 60);
        assert_eq!(exp(&chain, gary, alice, usd), 20);
        assert_eq!(
            FxOffer::get_assert(gary, aud, usd, true).remaining.value,
            50
        );

        Wrapper::push_from(&chain, gary)
            .st_fx_ofr(
                aud,
                usd,
                true,
                Quantity::new(0),
                RATE_SCALE * 50 / 100,
                Quantity::new(60),
                never(),
            )
            .get()?;
        Wrapper::push_from(&chain, alice)
            .convert(gary, aud, usd, Quantity::new(60), Quantity::new(30))
            .get()?;
        assert_eq!(exp(&chain, gary, alice, aud), 0);
        assert_eq!(exp(&chain, gary, alice, usd), 50);
        assert!(FxOffer::get(gary, aud, usd, true).is_none());

        // 1000 AUD at 0.70 needs 1000 of budget. 500 delivers 350 USD.
        Wrapper::push_from(&chain, steve)
            .st_crd_lne(gary, usd, Quantity::new(10_000), false)
            .get()?;
        Wrapper::push_from(&chain, gary)
            .st_glb_fwd(usd, Quantity::new(0), 0, never(), true)
            .get()?;
        Wrapper::push_from(&chain, gary)
            .st_fx_ofr(
                aud,
                usd,
                true,
                Quantity::new(0),
                RATE_SCALE * 70 / 100,
                Quantity::new(500),
                never(),
            )
            .get()?;

        let too_big = Wrapper::push_from(&chain, alice).path_pay(
            seal(
                &chain,
                alice,
                vec![hop(gary, aud), hop(steve, usd)],
                Quantity::new(1_000),
            ),
            Quantity::new(1_000),
            Quantity::new(700),
            0,
        );
        let err = too_big.trace.error.as_deref().unwrap_or("(no error)");
        assert!(
            err.contains("fx offer amount exceeds remaining"),
            "path over remaining: {err}"
        );
        assert_eq!(exp(&chain, gary, alice, aud), 0);
        assert_eq!(exp(&chain, steve, gary, usd), 0);
        assert_eq!(
            FxOffer::get_assert(gary, aud, usd, true).remaining.value,
            500
        );

        let id = Wrapper::push_from(&chain, steve)
            .st_req(
                PayRequest::INVOICE,
                alice,
                usd,
                Quantity::new(700),
                "x".into(),
                never(),
            )
            .get()?;
        let inv = Wrapper::push_from(&chain, alice).pay_inv(
            seal_inv(&chain, alice, vec![hop(gary, aud), hop(steve, usd)], id),
            Quantity::new(2_000),
            id,
        );
        let err = inv.trace.error.as_deref().unwrap_or("(no error)");
        assert!(
            err.contains("fx offer amount exceeds remaining"),
            "invoice over remaining: {err}"
        );
        assert_eq!(PayRequest::get_assert(id).remaining.value, 700);
        assert_eq!(exp(&chain, steve, gary, usd), 0);

        Wrapper::push_from(&chain, alice)
            .path_pay(
                seal(
                    &chain,
                    alice,
                    vec![hop(gary, aud), hop(steve, usd)],
                    Quantity::new(500),
                ),
                Quantity::new(500),
                Quantity::new(350),
                0,
            )
            .get()?;
        assert_eq!(exp(&chain, gary, alice, aud), 500);
        assert_eq!(exp(&chain, steve, gary, usd), 350);
        assert!(FxOffer::get(gary, aud, usd, true).is_none());
        assert!(Wrapper::push_from(&chain, alice)
            .path_pay(
                seal(
                    &chain,
                    alice,
                    vec![hop(gary, aud), hop(steve, usd)],
                    Quantity::new(1)
                ),
                Quantity::new(1),
                Quantity::new(0),
                0,
            )
            .get()
            .is_err());
        assert_eq!(exp(&chain, gary, alice, aud), 500);
        assert_eq!(exp(&chain, steve, gary, usd), 350);

        Ok(())
    }

    /// Convert nets `from_asset` before the rebook. A reverse claim of 40 against
    /// a 100 claim leaves 60 to convert — no separate `net` first.
    #[psibase::test_case(packages("Banx"))]
    fn test_convert_nets_from_asset_first(chain: psibase::Chain) -> Result<(), psibase::Error> {
        Wrapper::push(&chain).init().get()?;
        let alice = account!("alice");
        let gary = account!("gary");
        chain.new_account(alice).unwrap();
        chain.new_account(gary).unwrap();
        let aud = Asset::get_by_symbol_assert(account!("aud")).id;
        let usd = Asset::get_by_symbol_assert(account!("usd")).id;

        Wrapper::push_from(&chain, gary)
            .st_crd_lne(alice, aud, Quantity::new(10_000), false)
            .get()?;
        Wrapper::push_from(&chain, alice)
            .path_pay(
                seal(&chain, alice, vec![hop(gary, aud)], Quantity::new(100)),
                Quantity::new(100),
                Quantity::new(100),
                0,
            )
            .get()?;
        // Reverse 40 AUD (Gary books value from Alice). Deposit auto-nets
        // to 60; convert also nets, so a live two-way book is the same.
        Wrapper::push_from(&chain, gary)
            .deposit(alice, aud, Quantity::new(40), 0)
            .get()?;
        assert_eq!(exp(&chain, gary, alice, aud), 60);
        assert_eq!(exp(&chain, alice, gary, aud), 0);

        Wrapper::push_from(&chain, gary)
            .st_fx_ofr(
                aud,
                usd,
                true,
                Quantity::new(0),
                RATE_SCALE,
                Quantity::new(u64::MAX),
                never(),
            )
            .get()?;
        Wrapper::push_from(&chain, alice)
            .convert(gary, aud, usd, Quantity::new(100), Quantity::new(60))
            .get()?;

        assert_eq!(exp(&chain, gary, alice, aud), 0);
        assert_eq!(exp(&chain, alice, gary, aud), 0);
        assert_eq!(exp(&chain, gary, alice, usd), 60);
        Ok(())
    }

    /// Reverse claim in the destination asset is cancelled by convert.
    #[psibase::test_case(packages("Banx"))]
    fn test_convert_autonets_reverse_to_asset(chain: psibase::Chain) -> Result<(), psibase::Error> {
        Wrapper::push(&chain).init().get()?;
        let alice = account!("alice");
        let gary = account!("gary");
        chain.new_account(alice).unwrap();
        chain.new_account(gary).unwrap();
        let aud = Asset::get_by_symbol_assert(account!("aud")).id;
        let usd = Asset::get_by_symbol_assert(account!("usd")).id;

        Wrapper::push_from(&chain, gary)
            .st_crd_lne(alice, aud, Quantity::new(10_000), false)
            .get()?;
        Wrapper::push_from(&chain, alice)
            .path_pay(
                seal(&chain, alice, vec![hop(gary, aud)], Quantity::new(100)),
                Quantity::new(100),
                Quantity::new(100),
                0,
            )
            .get()?;
        // Gary already owes Alice 80 USD.
        Wrapper::push_from(&chain, gary)
            .deposit(alice, usd, Quantity::new(80), 0)
            .get()?;
        assert_eq!(exp(&chain, alice, gary, usd), 80);

        Wrapper::push_from(&chain, gary)
            .st_fx_ofr(
                aud,
                usd,
                true,
                Quantity::new(0),
                RATE_SCALE,
                Quantity::new(u64::MAX),
                never(),
            )
            .get()?;
        Wrapper::push_from(&chain, alice)
            .convert(gary, aud, usd, Quantity::new(100), Quantity::new(100))
            .get()?;

        assert_eq!(exp(&chain, gary, alice, aud), 0);
        assert_eq!(exp(&chain, gary, alice, usd), 20);
        assert_eq!(exp(&chain, alice, gary, usd), 0);
        Ok(())
    }

    #[psibase::test_case(packages("Banx"))]
    fn test_convert_uses_claim_debtor_when_both_quote(
        chain: psibase::Chain,
    ) -> Result<(), psibase::Error> {
        Wrapper::push(&chain).init().get()?;
        let alice = account!("alice");
        let gary = account!("gary");
        chain.new_account(alice).unwrap();
        chain.new_account(gary).unwrap();
        let aud = Asset::get_by_symbol_assert(account!("aud")).id;
        let usd = Asset::get_by_symbol_assert(account!("usd")).id;

        Wrapper::push_from(&chain, gary)
            .st_crd_lne(alice, aud, Quantity::new(10_000), false)
            .get()?;
        Wrapper::push_from(&chain, alice)
            .path_pay(
                seal(&chain, alice, vec![hop(gary, aud)], Quantity::new(100)),
                Quantity::new(100),
                Quantity::new(100),
                0,
            )
            .get()?;

        // Alice owes Gary the AUD, so she posts that side of the quote.
        Wrapper::push_from(&chain, alice)
            .st_fx_ofr(
                aud,
                usd,
                false,
                Quantity::new(0),
                RATE_SCALE * 50 / 100,
                Quantity::new(u64::MAX),
                never(),
            )
            .get()?;
        Wrapper::push_from(&chain, gary)
            .st_fx_ofr(
                aud,
                usd,
                true,
                Quantity::new(0),
                RATE_SCALE * 80 / 100,
                Quantity::new(u64::MAX),
                never(),
            )
            .get()?;

        // Taker uses the maker's quote: Gary takes Alice's 0.50, not his 0.80.
        Wrapper::push_from(&chain, gary)
            .convert(alice, aud, usd, Quantity::new(100), Quantity::new(50))
            .get()?;
        assert_eq!(exp(&chain, gary, alice, aud), 0);
        assert_eq!(exp(&chain, gary, alice, usd), 50);
        Ok(())
    }

    /// Convert uses the counterparty's quote, not the sender's. Alice cannot
    /// rebook at her own 1:1; she can take Gary's 0.50.
    #[psibase::test_case(packages("Banx"))]
    fn test_convert_uses_counterparty_offer(chain: psibase::Chain) -> Result<(), psibase::Error> {
        Wrapper::push(&chain).init().get()?;
        let alice = account!("alice");
        let gary = account!("gary");
        chain.new_account(alice).unwrap();
        chain.new_account(gary).unwrap();
        let aud = Asset::get_by_symbol_assert(account!("aud")).id;
        let usd = Asset::get_by_symbol_assert(account!("usd")).id;

        Wrapper::push_from(&chain, gary)
            .st_crd_lne(alice, aud, Quantity::new(10000), false)
            .get()?;
        Wrapper::push_from(&chain, alice)
            .path_pay(
                seal(&chain, alice, vec![hop(gary, aud)], 100.into()),
                100.into(),
                100.into(),
                0,
            )
            .get()?;
        Wrapper::push_from(&chain, alice)
            .st_fx_ofr(
                aud,
                usd,
                true,
                0.into(),
                RATE_SCALE,
                Quantity::new(u64::MAX),
                never(),
            )
            .get()?;

        let no_offer =
            Wrapper::push_from(&chain, alice).convert(gary, aud, usd, 100.into(), 100.into());
        let err = no_offer
            .trace
            .error
            .as_deref()
            .unwrap_or("(no error — convert succeeded)");
        assert!(
            err.contains("FxOffer not found"),
            "test_convert_uses_counterparty_offer: want offer missing, got {err}"
        );
        assert_eq!(exp(&chain, gary, alice, aud), 100);
        assert_eq!(exp(&chain, gary, alice, usd), 0);

        Wrapper::push_from(&chain, gary)
            .st_fx_ofr(
                aud,
                usd,
                true,
                Quantity::new(0),
                RATE_SCALE * 50 / 100,
                Quantity::new(u64::MAX),
                never(),
            )
            .get()?;
        Wrapper::push_from(&chain, alice)
            .convert(gary, aud, usd, Quantity::new(100), Quantity::new(50))
            .get()?;
        assert_eq!(exp(&chain, gary, alice, aud), 0);
        assert_eq!(exp(&chain, gary, alice, usd), 50);
        Ok(())
    }

    // ---- Pair model: one signed balance per (low, high, asset) -----------

    /// The stored row between `a` and `b`, whichever order they sort in.
    fn pair_row(a: AccountNumber, b: AccountNumber, asset: u16) -> Option<Pair> {
        let (low, high) = if a.value < b.value { (a, b) } else { (b, a) };
        PairTable::read().get_index_pk().get(&(low, high, asset))
    }

    /// Signed balance as `x` sees it: positive when `y` owes `x`.
    fn signed_for(x: AccountNumber, y: AccountNumber, asset: u16) -> i64 {
        match pair_row(x, y, asset) {
            None => 0,
            Some(row) if row.low == x => row.balance,
            Some(row) => -row.balance,
        }
    }

    /// Both directions at once: `(what y owes x, what x owes y)`.
    fn both(chain: &psibase::Chain, x: AccountNumber, y: AccountNumber, asset: u16) -> (u64, u64) {
        (exp(chain, x, y, asset), exp(chain, y, x, asset))
    }

    /// Deposit, draw and net between `x` and `y`. The script only names the
    /// roles, so running it with the two accounts swapped runs it with the
    /// other account on the `low` side of the row.
    fn net_scenario(chain: &psibase::Chain, x: AccountNumber, y: AccountNumber) {
        let usd = Asset::get_by_symbol_assert(account!("usd")).id;
        // `deposit` is signed by the debtor: the depositor becomes the creditor.
        // y owes x 100.
        Wrapper::push_from(chain, y)
            .deposit(x, usd, Quantity::new(100), 0)
            .get()
            .unwrap();
        assert_eq!(both(chain, x, y, usd), (100, 0));
        assert_eq!(signed_for(x, y, usd), 100);
        assert_eq!(signed_for(y, x, usd), -100);

        // x owes y 30: cancels against the 100. y owes x 70.
        Wrapper::push_from(chain, x)
            .deposit(y, usd, Quantity::new(30), 0)
            .get()
            .unwrap();
        assert_eq!(both(chain, x, y, usd), (70, 0));
        assert_eq!(signed_for(x, y, usd), 70);

        // x owes y 100: cancels the 70 and flips. x owes y 30.
        Wrapper::push_from(chain, x)
            .deposit(y, usd, Quantity::new(100), 0)
            .get()
            .unwrap();
        assert_eq!(both(chain, x, y, usd), (0, 30));
        assert_eq!(signed_for(x, y, usd), -30);

        // y owes x 30: exactly cancels. The row is gone.
        Wrapper::push_from(chain, y)
            .deposit(x, usd, Quantity::new(30), 0)
            .get()
            .unwrap();
        assert_eq!(both(chain, x, y, usd), (0, 0));
        assert!(pair_row(x, y, usd).is_none());

        // Draws net the same way. y lines x, x draws 50 on y: x owes y 50.
        Wrapper::push_from(chain, y)
            .st_crd_lne(x, usd, Quantity::new(1_000), false)
            .get()
            .unwrap();
        Wrapper::push_from(chain, x)
            .path_pay(
                seal(&chain, x, vec![hop(y, usd)], Quantity::new(50)),
                Quantity::new(50),
                Quantity::new(50),
                0,
            )
            .get()
            .unwrap();
        assert_eq!(both(chain, x, y, usd), (0, 50));
        assert_eq!(signed_for(x, y, usd), -50);

        // x lines y, y draws 80 on x: the 50 cancels first, then 30 is new.
        // x lent y 30 on net.
        Wrapper::push_from(chain, x)
            .st_crd_lne(y, usd, Quantity::new(1_000), true)
            .get()
            .unwrap();
        Wrapper::push_from(chain, y)
            .path_pay(
                seal(&chain, y, vec![hop(x, usd)], Quantity::new(80)),
                Quantity::new(80),
                Quantity::new(80),
                0,
            )
            .get()
            .unwrap();
        assert_eq!(both(chain, x, y, usd), (30, 0));
        assert_eq!(signed_for(x, y, usd), 30);
        // Only the 30 of new use spends x's depleting budget.
        assert_eq!(Pair::line(x, y, usd).unwrap().remaining.value, 970);
        assert_eq!(Pair::line(y, x, usd).unwrap().remaining.value, 1_000);

        // Lines survive the row going through zero.
        Wrapper::push_from(chain, x)
            .forgive(y, usd, Quantity::new(30))
            .get()
            .unwrap();
        assert_eq!(both(chain, x, y, usd), (0, 0));
        assert_eq!(signed_for(x, y, usd), 0);
        let row = pair_row(x, y, usd).expect("both lines keep the row");
        assert!(row.low_line.is_some() && row.high_line.is_some());
    }

    #[psibase::test_case(packages("Banx"))]
    fn test_pair_net_when_first_account_is_low(
        chain: psibase::Chain,
    ) -> Result<(), psibase::Error> {
        Wrapper::push(&chain).init().get()?;
        let a = account!("alice");
        let b = account!("bob");
        chain.new_account(a).unwrap();
        chain.new_account(b).unwrap();
        let (low, high) = if a.value < b.value { (a, b) } else { (b, a) };
        assert!(low.value < high.value);

        net_scenario(&chain, low, high);
        let usd = Asset::get_by_symbol_assert(account!("usd")).id;
        let row = pair_row(low, high, usd).unwrap();
        assert_eq!((row.low, row.high), (low, high));
        Ok(())
    }

    #[psibase::test_case(packages("Banx"))]
    fn test_pair_net_when_first_account_is_high(
        chain: psibase::Chain,
    ) -> Result<(), psibase::Error> {
        Wrapper::push(&chain).init().get()?;
        let a = account!("alice");
        let b = account!("bob");
        chain.new_account(a).unwrap();
        chain.new_account(b).unwrap();
        let (low, high) = if a.value < b.value { (a, b) } else { (b, a) };
        assert!(low.value < high.value);

        net_scenario(&chain, high, low);
        let usd = Asset::get_by_symbol_assert(account!("usd")).id;
        let row = pair_row(low, high, usd).unwrap();
        assert_eq!((row.low, row.high), (low, high));
        Ok(())
    }

    /// The same script on three unrelated pairs. Going round the cycle
    /// p -> q -> r -> p, at least one pair has its first account on the low
    /// side of the row and at least one has it on the high side.
    #[psibase::test_case(packages("Banx"))]
    fn test_pair_net_other_names_both_orders(chain: psibase::Chain) -> Result<(), psibase::Error> {
        Wrapper::push(&chain).init().get()?;
        let p = account!("carol");
        let q = account!("zed");
        let r = account!("aaron");
        for acct in [p, q, r] {
            chain.new_account(acct).unwrap();
        }
        let pairs = [(p, q), (q, r), (r, p)];
        let first_is_low = pairs.iter().filter(|(x, y)| x.value < y.value).count();
        assert!(
            (1..=2).contains(&first_is_low),
            "a cycle cannot be ordered the same way throughout"
        );
        for (x, y) in pairs {
            net_scenario(&chain, x, y);
        }
        Ok(())
    }

    /// A deposit against a reverse claim: smaller cancels part, equal cancels
    /// it, larger flips the direction. Forgive only writes off what is owed.
    #[psibase::test_case(packages("Banx"))]
    fn test_pair_deposit_nets_flips_and_forgive(
        chain: psibase::Chain,
    ) -> Result<(), psibase::Error> {
        Wrapper::push(&chain).init().get()?;
        let a = account!("alice");
        let b = account!("bob");
        chain.new_account(a).unwrap();
        chain.new_account(b).unwrap();
        let usd = Asset::get_by_symbol_assert(account!("usd")).id;

        // A owes B 30.
        Wrapper::push_from(&chain, a)
            .deposit(b, usd, Quantity::new(30), 0)
            .get()?;
        assert_eq!(both(&chain, b, a, usd), (30, 0));

        // B owes A 100: 30 cancels, so B owes A 70 and A owes B nothing.
        Wrapper::push_from(&chain, b)
            .deposit(a, usd, Quantity::new(100), 0)
            .get()?;
        assert_eq!(exp(&chain, a, b, usd), 70);
        assert_eq!(exp(&chain, b, a, usd), 0);

        // A owes B 25 more: cancels 25 of the 70.
        Wrapper::push_from(&chain, a)
            .deposit(b, usd, Quantity::new(25), 0)
            .get()?;
        assert_eq!(exp(&chain, a, b, usd), 45);
        assert_eq!(exp(&chain, b, a, usd), 0);

        // Forgive is by the creditor only. B owes A, so B forgiving does nothing.
        Wrapper::push_from(&chain, b)
            .forgive(a, usd, Quantity::new(10))
            .get()?;
        assert_eq!(exp(&chain, a, b, usd), 45);
        assert_eq!(exp(&chain, b, a, usd), 0);

        // Partial write-off, then an over-ask capped at what is left.
        Wrapper::push_from(&chain, a)
            .forgive(b, usd, Quantity::new(20))
            .get()?;
        assert_eq!(exp(&chain, a, b, usd), 25);
        assert_eq!(exp(&chain, b, a, usd), 0);
        Wrapper::push_from(&chain, a)
            .forgive(b, usd, Quantity::new(1_000))
            .get()?;
        assert_eq!(both(&chain, a, b, usd), (0, 0));
        assert!(pair_row(a, b, usd).is_none());

        // Written-off debt does not become a claim the other way.
        Wrapper::push_from(&chain, a)
            .deposit(b, usd, Quantity::new(5), 0)
            .get()?;
        assert_eq!(both(&chain, b, a, usd), (5, 0));
        Ok(())
    }

    /// `rm_crd_lne` erases the line and nothing else. The row goes only when
    /// both the balance and both lines are empty.
    #[psibase::test_case(packages("Banx"))]
    fn test_pair_rm_line_keeps_balance_and_row_lifecycle(
        chain: psibase::Chain,
    ) -> Result<(), psibase::Error> {
        Wrapper::push(&chain).init().get()?;
        let a = account!("alice");
        let b = account!("bob");
        chain.new_account(a).unwrap();
        chain.new_account(b).unwrap();
        let usd = Asset::get_by_symbol_assert(account!("usd")).id;
        let aud = Asset::get_by_symbol_assert(account!("aud")).id;

        // A line alone makes a row.
        assert!(pair_row(a, b, usd).is_none());
        Wrapper::push_from(&chain, a)
            .st_crd_lne(b, usd, Quantity::new(500), false)
            .get()?;
        let row = pair_row(a, b, usd).expect("line row");
        assert_eq!(row.balance, 0);
        assert!(pair_row(a, b, aud).is_none(), "rows are per asset");

        // B draws 100. Removing A's line leaves what B owes.
        Wrapper::push_from(&chain, b)
            .path_pay(
                seal(&chain, b, vec![hop(a, usd)], Quantity::new(100)),
                Quantity::new(100),
                Quantity::new(100),
                0,
            )
            .get()?;
        assert_eq!(exp(&chain, a, b, usd), 100);
        Wrapper::push_from(&chain, a).rm_crd_lne(b, usd).get()?;
        assert!(Pair::line(a, b, usd).is_none());
        assert_eq!(exp(&chain, a, b, usd), 100);
        assert_eq!(signed_for(a, b, usd).abs(), 100);
        assert!(pair_row(a, b, usd).is_some(), "balance keeps the row");
        // Removing it again is an error: there is no line.
        assert!(Wrapper::push_from(&chain, a)
            .rm_crd_lne(b, usd)
            .get()
            .is_err());
        // Without a line B cannot draw more.
        assert!(Wrapper::push_from(&chain, b)
            .path_pay(
                seal(&chain, b, vec![hop(a, usd)], Quantity::new(1)),
                Quantity::new(1),
                Quantity::new(1),
                0
            )
            .get()
            .is_err());

        // Zero balance, no line: the row is gone.
        Wrapper::push_from(&chain, a)
            .forgive(b, usd, Quantity::new(100))
            .get()?;
        assert_eq!(both(&chain, a, b, usd), (0, 0));
        assert!(pair_row(a, b, usd).is_none());

        // A line survives the balance reaching zero.
        Wrapper::push_from(&chain, a)
            .st_crd_lne(b, usd, Quantity::new(500), false)
            .get()?;
        Wrapper::push_from(&chain, b)
            .deposit(a, usd, Quantity::new(40), 0)
            .get()?;
        assert_eq!(exp(&chain, a, b, usd), 40);
        Wrapper::push_from(&chain, a)
            .forgive(b, usd, Quantity::new(40))
            .get()?;
        let row = pair_row(a, b, usd).expect("line keeps the row");
        assert_eq!(row.balance, 0);
        assert_eq!(Pair::line(a, b, usd).unwrap().limit.value, 500);

        // The two sides' lines are independent.
        Wrapper::push_from(&chain, b)
            .st_crd_lne(a, usd, Quantity::new(300), true)
            .get()?;
        assert_eq!(Pair::line(a, b, usd).unwrap().limit.value, 500);
        let theirs = Pair::line(b, a, usd).unwrap();
        assert_eq!(theirs.limit.value, 300);
        assert!(theirs.deplete_on_debit);
        assert!(!Pair::line(a, b, usd).unwrap().deplete_on_debit);

        Wrapper::push_from(&chain, a).rm_crd_lne(b, usd).get()?;
        assert!(Pair::line(a, b, usd).is_none());
        assert_eq!(Pair::line(b, a, usd).unwrap().limit.value, 300);
        assert!(pair_row(a, b, usd).is_some());

        Wrapper::push_from(&chain, b).rm_crd_lne(a, usd).get()?;
        assert!(Pair::line(b, a, usd).is_none());
        assert!(pair_row(a, b, usd).is_none(), "empty row is deleted");
        Ok(())
    }

    /// The balance is an `i64`. A claim above that is rejected and leaves
    /// the ledger as it was.
    #[psibase::test_case(packages("Banx"))]
    fn test_pair_deposit_rejects_balance_range(
        chain: psibase::Chain,
    ) -> Result<(), psibase::Error> {
        Wrapper::push(&chain).init().get()?;
        let a = account!("alice");
        let b = account!("bob");
        chain.new_account(a).unwrap();
        chain.new_account(b).unwrap();
        let usd = Asset::get_by_symbol_assert(account!("usd")).id;

        for amount in [u64::MAX, i64::MAX as u64 + 1] {
            let err = Wrapper::push_from(&chain, b)
                .deposit(a, usd, Quantity::new(amount), 0)
                .get()
                .expect_err("above i64::MAX");
            assert!(err.to_string().contains("balance range"), "{err}");
            assert_eq!(both(&chain, a, b, usd), (0, 0));
            assert!(pair_row(a, b, usd).is_none());
        }

        // Existing state is untouched by a rejected deposit.
        Wrapper::push_from(&chain, b)
            .deposit(a, usd, Quantity::new(10), 0)
            .get()?;
        let err = Wrapper::push_from(&chain, b)
            .deposit(a, usd, Quantity::new(u64::MAX), 0)
            .get()
            .expect_err("above i64::MAX");
        assert!(err.to_string().contains("balance range"), "{err}");
        assert_eq!(both(&chain, a, b, usd), (10, 0));
        // The reverse direction would net, but the size check is first.
        let err = Wrapper::push_from(&chain, a)
            .deposit(b, usd, Quantity::new(u64::MAX), 0)
            .get()
            .expect_err("above i64::MAX");
        assert!(err.to_string().contains("balance range"), "{err}");
        assert_eq!(both(&chain, a, b, usd), (10, 0));

        // i64::MAX itself fits. One more in the same direction overflows.
        Wrapper::push_from(&chain, a)
            .forgive(b, usd, Quantity::new(10))
            .get()?;
        Wrapper::push_from(&chain, b)
            .deposit(a, usd, Quantity::new(i64::MAX as u64), 0)
            .get()?;
        assert_eq!(exp(&chain, a, b, usd), i64::MAX as u64);
        let over = Wrapper::push_from(&chain, b)
            .deposit(a, usd, Quantity::new(1), 0)
            .get()
            .expect_err("balance would pass i64::MAX");
        assert!(over.to_string().contains("overflow"), "{over}");
        assert_eq!(exp(&chain, a, b, usd), i64::MAX as u64);
        // The other direction nets down, and can then flip within range.
        Wrapper::push_from(&chain, a)
            .deposit(b, usd, Quantity::new(i64::MAX as u64), 0)
            .get()?;
        assert_eq!(both(&chain, a, b, usd), (0, 0));
        assert!(pair_row(a, b, usd).is_none());
        Ok(())
    }

    /// Re-posting a line keeps `remaining` unless the new limit is lower. A
    /// revolving line's `remaining` follows its limit until it is spent.
    #[psibase::test_case(packages("Banx"))]
    fn test_pair_line_repost_clamps_remaining(chain: psibase::Chain) -> Result<(), psibase::Error> {
        Wrapper::push(&chain).init().get()?;
        let a = account!("alice");
        let b = account!("bob");
        chain.new_account(a).unwrap();
        chain.new_account(b).unwrap();
        let usd = Asset::get_by_symbol_assert(account!("usd")).id;
        let remaining = || Pair::line(a, b, usd).unwrap().remaining.value;

        // Revolving: remaining tracks the limit both ways.
        for limit in [100, 50, 200] {
            Wrapper::push_from(&chain, a)
                .st_crd_lne(b, usd, Quantity::new(limit), false)
                .get()?;
            assert_eq!(remaining(), limit);
        }

        // Depleting: spend 60 of a 200 budget.
        Wrapper::push_from(&chain, a)
            .st_crd_lne(b, usd, Quantity::new(200), true)
            .get()?;
        assert_eq!(remaining(), 200);
        Wrapper::push_from(&chain, b)
            .path_pay(
                seal(&chain, b, vec![hop(a, usd)], Quantity::new(60)),
                Quantity::new(60),
                Quantity::new(60),
                0,
            )
            .get()?;
        assert_eq!(remaining(), 140);

        // A lower limit clamps the budget down.
        Wrapper::push_from(&chain, a)
            .st_crd_lne(b, usd, Quantity::new(100), true)
            .get()?;
        assert_eq!(remaining(), 100);
        // A higher limit does not bring it back up.
        Wrapper::push_from(&chain, a)
            .st_crd_lne(b, usd, Quantity::new(500), true)
            .get()?;
        assert_eq!(remaining(), 100);
        // Neither does a toggle through revolving.
        Wrapper::push_from(&chain, a)
            .st_crd_lne(b, usd, Quantity::new(500), false)
            .get()?;
        Wrapper::push_from(&chain, a)
            .st_crd_lne(b, usd, Quantity::new(500), true)
            .get()?;
        assert_eq!(remaining(), 100);
        // The balance is unaffected by line edits.
        assert_eq!(exp(&chain, a, b, usd), 60);

        // Repaying (netting) does not give the spent budget back.
        Wrapper::push_from(&chain, a)
            .deposit(b, usd, Quantity::new(60), 0)
            .get()?;
        assert_eq!(both(&chain, a, b, usd), (0, 0));
        assert_eq!(remaining(), 100);
        Ok(())
    }
}
