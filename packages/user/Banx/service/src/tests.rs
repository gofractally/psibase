#![allow(non_snake_case)]

#[cfg(target_family = "wasm")]
#[link(wasm_import_module = "psibase")]
extern "C" {
    fn commitState(chain: u32);
}

#[cfg(test)]
mod tests {
    use crate::interest::{compound_amount, interest_for, SECONDS_PER_DAY, SECONDS_PER_YEAR};
    use crate::tables::{
        Asset, BanxInvite, BanxInviteTable, BanxRelay, BookAuth, CashQuote, ClaimOffer, CreditLine,
        FxOffer, InitTable, Obligation, ObligationTable, PairCycle, PathHop, PayAuth, PayAuthTab,
        PayRequest, TokenRelay, PPM_SCALE, RATE_SCALE,
    };
    use crate::Wrapper;
    use psibase::fracpack::Pack;
    use psibase::services::tokens::{Precision, Quantity};
    use psibase::*;

    fn hop(account: AccountNumber, asset_id: u16) -> PathHop {
        PathHop { account, asset_id }
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

    fn activity_nodes(chain: &psibase::Chain, account: AccountNumber) -> Vec<serde_json::Value> {
        let graph = banx_gql(
            chain,
            &format!(
                r#"{{ activity(account: "{account}", last: 50) {{
                    edges {{ node {{ kind amount netted actor counterparty }} }}
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

    /// Replay a stored obligation the service can no longer create.
    ///
    /// A service-db write is rejected while a block is open. Between blocks
    /// the write sits in the tester's side session until `commitState`, which
    /// the Rust `Chain` does not wrap. That commit ends the session, so the
    /// next block is what makes the row readable again.
    fn plant_obligation(chain: &psibase::Chain, row: &Obligation) {
        chain.finish_block();
        chain.select_chain();
        ObligationTable::read_write().put(row).unwrap();
        #[cfg(target_family = "wasm")]
        unsafe {
            super::commitState(psibase::tester_raw::get_selected_chain());
        }
        chain.start_block();
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

    #[psibase::test_case(packages("Banx"))]
    fn test_interest_path_independence(_chain: psibase::Chain) -> Result<(), psibase::Error> {
        let year = SECONDS_PER_YEAR as u64;
        let p = 1_000_000u64; // $100.0000 at 4 dp
                              // Daily 10%: ~10.52% effective over 365 days (not exact +10%).
        assert_eq!(compound_amount(p, 100_000, year), 1_104_964);
        assert_eq!(compound_amount(p, 100_000, year * 2), 1_220_966);
        assert_eq!(interest_for(p, 100_000, year * 2), 220_966);
        assert_eq!(compound_amount(p, 100_000, 0), p);
        assert_eq!(compound_amount(0, 100_000, year), 0);
        assert_eq!(interest_for(p, 0, year), 0);
        assert_eq!(compound_amount(p, 100_000, year / 2), 1_051_170);
        assert_eq!(
            compound_amount(p, 100_000, SECONDS_PER_DAY as u64),
            1_000_273
        );
        // $5.0000 at 20% for 12h: half a daily tick, floor to 0.0013.
        assert_eq!(interest_for(50_000, 200_000, 12 * 3600), 13);

        Ok(())
    }

    #[psibase::test_case(packages("Banx"))]
    fn test_compound_amount_saturates_at_u64_max(
        _chain: psibase::Chain,
    ) -> Result<(), psibase::Error> {
        assert_eq!(compound_amount(u64::MAX, 1, 1), u64::MAX);
        assert_eq!(
            compound_amount(u64::MAX, 1, SECONDS_PER_DAY as u64),
            u64::MAX
        );
        // 10% decay for one day truncates the same 273 fee as the growth above.
        assert_eq!(compound_amount(1_000_000, -100_000, 1), 1_000_000);
        assert_eq!(
            compound_amount(1_000_000, -100_000, SECONDS_PER_DAY as u64),
            999_727
        );
        assert_eq!(compound_amount(1, -1_000_000, SECONDS_PER_DAY as u64), 1);
        assert_eq!(compound_amount(1_000_000, -100_000, 0), 1_000_000);
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
            .st_crd_lne(alice, usd, Quantity::new(10_000), false, 0, 0)
            .get()?;
        Wrapper::push_from(&chain, steve)
            .st_crd_lne(gary, usd, Quantity::new(10_000), false, 0, 0)
            .get()?;

        Wrapper::push_from(&chain, gary)
            .st_glb_fwd(
                usd,
                Quantity::new(0),
                PPM_SCALE * 2 / 100,
                PPM_SCALE,
                never(),
                true,
            )
            .get()?;

        Wrapper::push_from(&chain, alice)
            .path_pay(
                vec![hop(gary, usd), hop(steve, usd)],
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
            .deposit(bluey, aud, chores, 0, 0)
            .get()?;
        assert_eq!(exp(&chain, bluey, bandit, aud), chores.value);

        // Children consider their parents debt to be as good as cash.
        // Therefore set high credit limits.
        Wrapper::push_from(&chain, bingo)
            .st_crd_lne(bandit, aud, Quantity::new(1_000_000), false, 0, 0)
            .get()?;
        Wrapper::push_from(&chain, bluey)
            .st_crd_lne(bandit, aud, Quantity::new(1_000_000), false, 0, 0)
            .get()?;

        // Bandit allows forwarding to his children, free of charge.
        Wrapper::push_from(&chain, bandit)
            .st_fwd_ofr(bingo, aud, Quantity::new(0), 0, PPM_SCALE, never(), true)
            .get()?;

        Wrapper::push_from(&chain, bandit)
            .st_fwd_ofr(bluey, aud, Quantity::new(0), 0, PPM_SCALE, never(), true)
            .get()?;

        assert!(Wrapper::push_from(&chain, bluey)
            .path_pay(vec![hop(bingo, aud)], popper, popper, 0)
            .get()
            .is_err());

        Wrapper::push_from(&chain, bluey)
            .path_pay(vec![hop(bandit, aud), hop(bingo, aud)], popper, popper, 0)
            .get()?;

        assert_eq!(exp(&chain, bluey, bandit, aud), leftover.value);
        assert_eq!(exp(&chain, bingo, bandit, aud), popper.value);
        assert_eq!(exp(&chain, bandit, bluey, aud), 0);
        assert_eq!(exp(&chain, bingo, bluey, aud), 0);
        assert_eq!(exp(&chain, bluey, bingo, aud), 0);

        assert!(Wrapper::push_from(&chain, bluey)
            .path_pay(
                vec![hop(bandit, aud), hop(bingo, aud)],
                Quantity::new(leftover.value + 1),
                Quantity::new(leftover.value + 1),
                0,
            )
            .get()
            .is_err());

        Wrapper::push_from(&chain, bluey)
            .path_pay(
                vec![hop(bandit, aud), hop(bingo, aud)],
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
            .st_crd_lne(alice, aud, Quantity::new(10_000), false, 0, 0)
            .get()?;
        Wrapper::push_from(&chain, steve)
            .st_crd_lne(gary, usd, Quantity::new(10_000), false, 0, 0)
            .get()?;

        // Gary (middle man / claim holder) posts AUD→USD (0.70).
        Wrapper::push_from(&chain, gary)
            .st_fx_ofr(
                aud,
                usd,
                true,
                Quantity::new(0),
                RATE_SCALE * 70 / 100,
                0,
                Quantity::new(u64::MAX),
                never(),
            )
            .get()?;
        // Gary routes same-asset USD to Steve (no fee).
        Wrapper::push_from(&chain, gary)
            .st_glb_fwd(usd, Quantity::new(0), 0, PPM_SCALE, never(), true)
            .get()?;

        Wrapper::push_from(&chain, alice)
            .path_pay(
                vec![hop(gary, aud), hop(steve, usd)],
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
            .st_crd_lne(zac, aud, limit, false, 0, 0)
            .get()?;
        // John ← Mitchell (AUD)
        Wrapper::push_from(&chain, john)
            .st_crd_lne(mitchell, aud, limit, false, 0, 0)
            .get()?;
        // Mike ← John (USD) — capacity for AUD→USD hop
        Wrapper::push_from(&chain, mike)
            .st_crd_lne(john, usd, limit, false, 0, 0)
            .get()?;
        // Brandon ← Mike (USD)
        Wrapper::push_from(&chain, brandon)
            .st_crd_lne(mike, usd, limit, false, 0, 0)
            .get()?;

        // --- Routing (same-asset fees) ---
        // Mitchell → John, AUD, 5% hop fee
        Wrapper::push_from(&chain, mitchell)
            .st_glb_fwd(
                aud,
                Quantity::new(0),
                PPM_SCALE * 5 / 100,
                PPM_SCALE,
                never(),
                true,
            )
            .get()?;
        // John → Mike, USD (after convert), no fee
        Wrapper::push_from(&chain, john)
            .st_glb_fwd(usd, Quantity::new(0), 0, PPM_SCALE, never(), true)
            .get()?;
        // Mike → Brandon, USD, 1% hop fee
        Wrapper::push_from(&chain, mike)
            .st_glb_fwd(
                usd,
                Quantity::new(0),
                PPM_SCALE * 1 / 100,
                PPM_SCALE,
                never(),
                true,
            )
            .get()?;
        // John (AUD creditor / middle man into USD) posts AUD→USD at 0.65
        Wrapper::push_from(&chain, john)
            .st_fx_ofr(
                aud,
                usd,
                true,
                Quantity::new(0),
                RATE_SCALE * 65 / 100,
                0,
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
                vec![
                    hop(mitchell, aud),
                    hop(john, aud),
                    hop(mike, usd),
                    hop(brandon, usd),
                ],
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
            .deposit(john, aud, 100_0000.into(), 0, 0)
            .get()?;

        Wrapper::push_from(&chain, john)
            .st_crd_lne(mitchell, aud, 10_0000.into(), false, 0, 0)
            .get()?;
        Wrapper::push_from(&chain, john)
            .st_fwd_ofr(
                cafe,
                aud,
                0.into(),
                PPM_SCALE / 100,
                PPM_SCALE,
                never(),
                false,
            )
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
                vec![hop(john, aud), hop(cafe, aud)],
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
            .st_crd_lne(pippa, aud, Quantity::new(0), false, 0, 0)
            .get()?;
        Wrapper::push_from(&chain, pippa)
            .st_crd_lne(cafe, aud, 90_0000.into(), false, 0, 0)
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
            .st_crd_lne(zac, aud, limit, false, 0, 0)
            .get()?;
        Wrapper::push_from(&chain, john)
            .st_crd_lne(mitchell, aud, limit, false, 0, 0)
            .get()?;
        Wrapper::push_from(&chain, mike)
            .st_crd_lne(john, usd, limit, false, 0, 0)
            .get()?;
        Wrapper::push_from(&chain, brandon)
            .st_crd_lne(mike, usd, limit, false, 0, 0)
            .get()?;

        Wrapper::push_from(&chain, mitchell)
            .st_glb_fwd(
                aud,
                Quantity::new(0),
                PPM_SCALE * 5 / 100,
                PPM_SCALE,
                never(),
                true,
            )
            .get()?;
        Wrapper::push_from(&chain, john)
            .st_glb_fwd(usd, Quantity::new(0), 0, PPM_SCALE, never(), true)
            .get()?;
        Wrapper::push_from(&chain, mike)
            .st_glb_fwd(
                usd,
                Quantity::new(0),
                PPM_SCALE * 1 / 100,
                PPM_SCALE,
                never(),
                true,
            )
            .get()?;
        Wrapper::push_from(&chain, john)
            .st_fx_ofr(
                aud,
                usd,
                true,
                Quantity::new(0),
                RATE_SCALE * 65 / 100,
                0,
                Quantity::new(u64::MAX),
                never(),
            )
            .get()?;

        // Actual final = 6113; demand 7000 → fail; no legs stick.
        let result = Wrapper::push_from(&chain, zac)
            .path_pay(
                vec![
                    hop(mitchell, aud),
                    hop(john, aud),
                    hop(mike, usd),
                    hop(brandon, usd),
                ],
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
            .st_crd_lne(alice, aud, Quantity::new(10_000), false, 0, 0)
            .get()?;

        let zero = Wrapper::push_from(&chain, gary).st_fx_ofr(
            aud,
            usd,
            true,
            Quantity::new(0),
            RATE_SCALE * 50 / 100,
            0,
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
            .st_crd_lne(gary, usd, Quantity::new(10_000), false, 0, 0)
            .get()?;
        Wrapper::push_from(&chain, gary)
            .st_glb_fwd(usd, Quantity::new(0), 0, PPM_SCALE, never(), true)
            .get()?;
        Wrapper::push_from(&chain, gary)
            .st_fx_ofr(
                aud,
                usd,
                true,
                Quantity::new(0),
                RATE_SCALE * 70 / 100,
                0,
                Quantity::new(500),
                never(),
            )
            .get()?;

        let too_big = Wrapper::push_from(&chain, alice).path_pay(
            vec![hop(gary, aud), hop(steve, usd)],
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
            vec![hop(gary, aud), hop(steve, usd)],
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
                vec![hop(gary, aud), hop(steve, usd)],
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
                vec![hop(gary, aud), hop(steve, usd)],
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
                0,
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
            .st_crd_lne(alice, usd, Quantity::new(1_000), false, 0, 0)
            .get()?;
        Wrapper::push_from(&chain, steve)
            .st_crd_lne(gary, usd, Quantity::new(1_000), false, 0, 0)
            .get()?;

        let result = Wrapper::push_from(&chain, alice)
            .path_pay(
                vec![hop(gary, usd), hop(steve, usd)],
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
            .st_crd_lne(alice, usd, Quantity::new(10_000), false, 0, 0)
            .get()?;
        Wrapper::push_from(&chain, steve)
            .st_crd_lne(gary, usd, Quantity::new(10_000), false, 0, 0)
            .get()?;
        Wrapper::push_from(&chain, gary)
            .st_glb_fwd(usd, Quantity::new(50), 0, PPM_SCALE, never(), true)
            .get()?;

        let result = Wrapper::push_from(&chain, alice)
            .path_pay(
                vec![hop(gary, usd), hop(steve, usd)],
                Quantity::new(100),
                Quantity::new(80),
                0,
            )
            .get();
        assert!(result.is_err());

        Wrapper::push_from(&chain, alice)
            .path_pay(
                vec![hop(gary, usd), hop(steve, usd)],
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
            .st_crd_lne(alice, usd, Quantity::new(1_000), false, 0, 0)
            .get()?;
        Wrapper::push_from(&chain, alice)
            .path_pay(vec![hop(bob, usd)], amount, amount, 0)
            .get()?;

        Wrapper::push_from(&chain, bob)
            .deposit(alice, usd, amount, 0, 0)
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
            .st_crd_lne(alice, usd, Quantity::new(10_000), false, 0, 0)
            .get()?;
        Wrapper::push_from(&chain, alice)
            .st_crd_lne(bob, usd, Quantity::new(10_000), false, 0, 0)
            .get()?;

        // Alice draws 100 on Bob → Bob is creditor, Alice debtor.
        Wrapper::push_from(&chain, alice)
            .path_pay(
                vec![hop(bob, usd)],
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
                vec![hop(alice, usd)],
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
                vec![hop(bob, usd)],
                Quantity::new(100),
                Quantity::new(100),
                0,
            )
            .get()?;
        Wrapper::push_from(&chain, bob)
            .path_pay(
                vec![hop(alice, usd)],
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
            .deposit(alice, usd, Quantity::new(10_000), 0, 0)
            .get()?;
        assert_eq!(exp(&chain, alice, bob, usd), 10_000);

        // Peter willing to be owed by Bob up to 10k.
        Wrapper::push_from(&chain, peter)
            .st_crd_lne(bob, usd, Quantity::new(10_000), false, 0, 0)
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
            .st_crd_lne(peter, usd, Quantity::new(0), false, 0, 0)
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
            .deposit(alice, usd, Quantity::new(10_000), 0, 0)
            .get()?;

        Wrapper::push_from(&chain, peter)
            .st_crd_lne(bob, usd, Quantity::new(10_000), false, 0, 0)
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
            .st_crd_lne(peter, usd, Quantity::new(0), false, 0, 0)
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
            .deposit(alice, usd, Quantity::new(10_000), 0, 0)
            .get()?;
        Wrapper::push_from(&chain, peter)
            .st_crd_lne(bob, usd, Quantity::new(10_000), false, 0, 0)
            .get()?;
        Wrapper::push_from(&chain, bob)
            .st_crd_lne(peter, usd, Quantity::new(0), false, 0, 0)
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
            .deposit(alice, usd, Quantity::new(100), 0, 0)
            .get()?;
        Wrapper::push_from(&chain, peter)
            .st_crd_lne(bob, usd, Quantity::new(100), false, 0, 0)
            .get()?;
        Wrapper::push_from(&chain, bob)
            .st_crd_lne(peter, usd, Quantity::new(0), false, 0, 0)
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
            .st_crd_lne(alice, usd, Quantity::new(10_000), false, 0, 0)
            .get()?;
        Wrapper::push_from(&chain, steve)
            .st_crd_lne(gary, usd, Quantity::new(10_000), false, 0, 0)
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
            .st_glb_fwd(
                usd,
                Quantity::new(0),
                PPM_SCALE * 2 / 100,
                PPM_SCALE,
                never(),
                true,
            )
            .get()?;

        Wrapper::push_from(&chain, alice)
            .path_pay(
                vec![hop(gary, usd), hop(steve, usd)],
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
            .st_crd_lne(alice, usd, Quantity::new(10_000), false, 0, 0)
            .get()?;
        Wrapper::push_from(&chain, steve)
            .st_crd_lne(gary, usd, Quantity::new(10_000), false, 0, 0)
            .get()?;
        Wrapper::push_from(&chain, gary)
            .st_fwd_ofr(
                steve,
                usd,
                Quantity::new(0),
                0,
                PPM_SCALE,
                TimePointSec { seconds: 1 },
                true,
            )
            .get()?;
        Wrapper::push_from(&chain, gary)
            .st_glb_fwd(usd, Quantity::new(10), 0, PPM_SCALE, never(), true)
            .get()?;

        Wrapper::push_from(&chain, alice)
            .path_pay(
                vec![hop(gary, usd), hop(steve, usd)],
                Quantity::new(100),
                Quantity::new(90),
                0,
            )
            .get()?;
        assert_eq!(exp(&chain, steve, gary, usd), 90);
        Ok(())
    }

    #[psibase::test_case(packages("Banx"))]
    fn test_max_line_apr_rejects_forward(chain: psibase::Chain) -> Result<(), psibase::Error> {
        Wrapper::push(&chain).init().get()?;
        let alice = account!("alice");
        let gary = account!("gary");
        let steve = account!("steve");
        for a in [alice, gary, steve] {
            chain.new_account(a).unwrap();
        }
        let usd = Asset::get_by_symbol_assert(account!("usd")).id;
        Wrapper::push_from(&chain, gary)
            .st_crd_lne(alice, usd, Quantity::new(10_000), false, 0, 0)
            .get()?;
        Wrapper::push_from(&chain, steve)
            .st_crd_lne(gary, usd, Quantity::new(10_000), false, 20_000, 0)
            .get()?;
        Wrapper::push_from(&chain, gary)
            .st_glb_fwd(usd, Quantity::new(0), 0, 10_000, never(), true)
            .get()?;

        let result = Wrapper::push_from(&chain, alice)
            .path_pay(
                vec![hop(gary, usd), hop(steve, usd)],
                Quantity::new(100),
                Quantity::new(0),
                0,
            )
            .get();
        assert!(result.is_err());
        Ok(())
    }

    /// High APR on the next hop's line does not block a hop that only unwinds
    /// a reverse claim (no new draw at that APR).
    #[psibase::test_case(packages("Banx"))]
    fn test_max_line_apr_allows_unwind(chain: psibase::Chain) -> Result<(), psibase::Error> {
        Wrapper::push(&chain).init().get()?;
        let alice = account!("alice");
        let gary = account!("gary");
        let steve = account!("steve");
        for a in [alice, gary, steve] {
            chain.new_account(a).unwrap();
        }
        let usd = Asset::get_by_symbol_assert(account!("usd")).id;
        Wrapper::push_from(&chain, gary)
            .st_crd_lne(alice, usd, Quantity::new(10_000), false, 0, 0)
            .get()?;
        // Steve owes Gary 100 — Gary's forward to Steve is a pure unwind.
        Wrapper::push_from(&chain, steve)
            .deposit(gary, usd, Quantity::new(100), 0, 0)
            .get()?;
        Wrapper::push_from(&chain, steve)
            .st_crd_lne(gary, usd, Quantity::new(10_000), false, 20_000, 0)
            .get()?;
        Wrapper::push_from(&chain, gary)
            .st_glb_fwd(usd, Quantity::new(0), 0, 10_000, never(), false)
            .get()?;

        Wrapper::push_from(&chain, alice)
            .path_pay(
                vec![hop(gary, usd), hop(steve, usd)],
                Quantity::new(100),
                Quantity::new(100),
                0,
            )
            .get()?;
        assert_eq!(exp(&chain, steve, gary, usd), 0);
        assert_eq!(exp(&chain, gary, alice, usd), 100);
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
            .st_crd_lne(alice, usd, Quantity::new(100), true, 0, 0)
            .get()?;
        let line = CreditLine::get_assert(bob, alice, usd);
        assert_eq!(line.limit.value, 100);
        assert_eq!(line.remaining.value, 100);

        Wrapper::push_from(&chain, alice)
            .path_pay(vec![hop(bob, usd)], Quantity::new(60), Quantity::new(60), 0)
            .get()?;
        let line = CreditLine::get_assert(bob, alice, usd);
        assert_eq!(line.limit.value, 100);
        assert_eq!(line.remaining.value, 40);
        assert_eq!(exp(&chain, bob, alice, usd), 60);
        assert!(exp(&chain, bob, alice, usd) <= line.limit.value);

        // Remaining is 40, not 40-after-shrunk-cap.
        Wrapper::push_from(&chain, alice)
            .path_pay(vec![hop(bob, usd)], Quantity::new(40), Quantity::new(40), 0)
            .get()?;
        assert_eq!(exp(&chain, bob, alice, usd), 100);
        assert_eq!(CreditLine::get_assert(bob, alice, usd).remaining.value, 0);

        // Repay does not restore remaining.
        Wrapper::push_from(&chain, bob)
            .deposit(alice, usd, Quantity::new(100), 0, 0)
            .get()?;
        assert_eq!(exp(&chain, bob, alice, usd), 0);
        let over = Wrapper::push_from(&chain, alice)
            .path_pay(vec![hop(bob, usd)], Quantity::new(1), Quantity::new(1), 0)
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
            .deposit(alice, usd, Quantity::new(50), 0, 0)
            .get()?;
        Wrapper::push_from(&chain, peter)
            .st_crd_lne(bob, usd, Quantity::new(100), true, 0, 0)
            .get()?;
        Wrapper::push_from(&chain, peter)
            .st_glb_buy(usd, Quantity::new(0), 0, Quantity::new(u64::MAX), never())
            .get()?;
        Wrapper::push_from(&chain, bob)
            .st_crd_lne(peter, usd, Quantity::new(0), false, 0, 0)
            .get()?;
        Wrapper::push_from(&chain, alice)
            .sell_claim(peter, bob, usd, Quantity::new(50), Quantity::new(0))
            .get()?;
        let line = CreditLine::get_assert(peter, bob, usd);
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
            .deposit(alice, usd, Quantity::new(50), 0, 0)
            .get()?;
        // Peter owes Bob 50. Same pair, other way: the reverse claim.
        Wrapper::push_from(&chain, peter)
            .deposit(bob, usd, Quantity::new(50), 0, 0)
            .get()?;
        Wrapper::push_from(&chain, peter)
            .st_crd_lne(bob, usd, Quantity::new(100), true, 0, 0)
            .get()?;
        Wrapper::push_from(&chain, peter)
            .st_glb_buy(usd, Quantity::new(0), 0, Quantity::new(u64::MAX), never())
            .get()?;
        // Debtor must know the buyer. Live claims already exist both ways;
        // a 0-limit line is the same consent `path_pay` would use.
        Wrapper::push_from(&chain, bob)
            .st_crd_lne(peter, usd, Quantity::new(0), false, 0, 0)
            .get()?;

        assert_eq!(exp(&chain, alice, bob, usd), 50);
        assert_eq!(exp(&chain, bob, peter, usd), 50);
        assert_eq!(CreditLine::get_assert(peter, bob, usd).remaining.value, 100);

        Wrapper::push_from(&chain, alice)
            .sell_claim(peter, bob, usd, Quantity::new(50), Quantity::new(0))
            .get()?;

        // Wash: Peter's new claim on Bob nets against the 50 he owed.
        assert_eq!(exp(&chain, peter, bob, usd), 0);
        assert_eq!(exp(&chain, bob, peter, usd), 0);
        assert_eq!(exp(&chain, alice, bob, usd), 0);
        // Alice is paid in a claim on Peter (0% spread).
        assert_eq!(exp(&chain, alice, peter, usd), 50);

        let line = CreditLine::get_assert(peter, bob, usd);
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
            .deposit(alice, usd, Quantity::new(1_000), 0, 0)
            .get()?;
        Wrapper::push_from(&chain, peter)
            .st_crd_lne(bob, usd, Quantity::new(10_000), false, 0, 0)
            .get()?;
        Wrapper::push_from(&chain, peter)
            .st_glb_buy(usd, Quantity::new(0), 0, Quantity::new(u64::MAX), never())
            .get()?;

        assert!(Wrapper::push_from(&chain, alice)
            .sell_claim(peter, bob, usd, Quantity::new(1_000), Quantity::new(0))
            .get()
            .is_err());

        Wrapper::push_from(&chain, bob)
            .st_crd_lne(peter, usd, Quantity::new(0), false, 0, 0)
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
            .deposit(steve, usd, Quantity::new(2_000), 0, 0)
            .get()?;
        Wrapper::push_from(&chain, peter)
            .st_glb_buy(usd, Quantity::new(0), 0, Quantity::new(u64::MAX), never())
            .get()?;
        Wrapper::push_from(&chain, carol)
            .st_crd_lne(peter, usd, Quantity::new(0), false, 0, 0)
            .get()?;

        assert!(
            Wrapper::push_from(&chain, steve)
                .sell_claim(peter, carol, usd, Quantity::new(500), Quantity::new(0))
                .get()
                .is_err(),
            "global buy without a buyer line must not take new exposure"
        );

        Wrapper::push_from(&chain, peter)
            .st_crd_lne(carol, usd, Quantity::new(500), false, 0, 0)
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
            .deposit(steve, usd, Quantity::new(500), 0, 0)
            .get()?;
        Wrapper::push_from(&chain, peter)
            .deposit(carol, usd, Quantity::new(500), 0, 0)
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
            .deposit(alice, usd, Quantity::new(1_000), 0, 0)
            .get()?;
        Wrapper::push_from(&chain, mallory)
            .st_crd_lne(bob, usd, Quantity::new(10_000), false, 0, 0)
            .get()?;
        Wrapper::push_from(&chain, mallory)
            .st_glb_buy(usd, Quantity::new(0), 0, Quantity::new(u64::MAX), never())
            .get()?;
        Wrapper::push_from(&chain, mallory)
            .deposit(bob, usd, Quantity::new(1), 0, 0)
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
            .st_crd_lne(alice, usd, Quantity::new(10_000), false, 0, 0)
            .get()?;
        Wrapper::push_from(&chain, steve)
            .st_crd_lne(gary, usd, Quantity::new(10_000), false, 0, 0)
            .get()?;
        Wrapper::push_from(&chain, gary)
            .st_glb_fwd(usd, Quantity::new(0), 0, PPM_SCALE, never(), false)
            .get()?;

        assert!(Wrapper::push_from(&chain, alice)
            .path_pay(
                vec![hop(gary, usd), hop(steve, usd)],
                Quantity::new(100),
                Quantity::new(100),
                0,
            )
            .get()
            .is_err());

        Wrapper::push_from(&chain, gary)
            .st_crd_lne(steve, usd, Quantity::new(0), false, 0, 0)
            .get()?;
        Wrapper::push_from(&chain, alice)
            .path_pay(
                vec![hop(gary, usd), hop(steve, usd)],
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
            .st_crd_lne(sender, usd, Quantity::new(10_000), false, 0, 0)
            .get()?;
        Wrapper::push_from(&chain, mallory)
            .st_crd_lne(alice, usd, Quantity::new(10_000), false, 0, 0)
            .get()?;
        Wrapper::push_from(&chain, alice)
            .st_glb_fwd(usd, Quantity::new(0), 0, PPM_SCALE, never(), false)
            .get()?;
        Wrapper::push_from(&chain, mallory)
            .deposit(alice, usd, Quantity::new(1), 0, 0)
            .get()?;

        assert!(
            Wrapper::push_from(&chain, sender)
                .path_pay(
                    vec![hop(alice, usd), hop(mallory, usd)],
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
            .st_crd_lne(mitchell, usd, Quantity::new(1_000_000), false, 0, 0)
            .get()?;
        Wrapper::push_from(&chain, cafe)
            .deposit(john, usd, Quantity::new(100_0000), 0, 0)
            .get()?;
        Wrapper::push_from(&chain, john)
            .st_fwd_ofr(cafe, usd, Quantity::new(0), 0, PPM_SCALE, never(), false)
            .get()?;

        Wrapper::push_from(&chain, mitchell)
            .path_pay(
                vec![hop(john, usd), hop(cafe, usd)],
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
            .st_crd_lne(alice, usd, Quantity::new(10_000), false, 0, 0)
            .get()?;
        Wrapper::push_from(&chain, gary)
            .st_fwd_ofr(steve, usd, Quantity::new(0), 0, PPM_SCALE, never(), true)
            .get()?;

        assert!(Wrapper::push_from(&chain, alice)
            .path_pay(
                vec![hop(gary, usd), hop(steve, usd)],
                Quantity::new(100),
                Quantity::new(100),
                0,
            )
            .get()
            .is_err());

        Wrapper::push_from(&chain, steve)
            .st_crd_lne(gary, usd, Quantity::new(10_000), false, 0, 0)
            .get()?;
        Wrapper::push_from(&chain, alice)
            .path_pay(
                vec![hop(gary, usd), hop(steve, usd)],
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
            .st_crd_lne(alice, usd, Quantity::new(10_000), false, 0, 0)
            .get()?;
        Wrapper::push_from(&chain, steve)
            .st_crd_lne(gary, usd, Quantity::new(10_000), false, 0, 0)
            .get()?;
        Wrapper::push_from(&chain, gary)
            .st_glb_fwd(usd, Quantity::new(0), 0, PPM_SCALE, never(), false)
            .get()?;
        assert!(Wrapper::push_from(&chain, alice)
            .path_pay(
                vec![hop(gary, usd), hop(steve, usd)],
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
                vec![hop(gary, usd), hop(steve, usd)],
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
            .st_crd_lne(alice, usd, Quantity::new(10_000), false, 0, 0)
            .get()?;
        Wrapper::push_from(&chain, steve)
            .st_crd_lne(gary, usd, Quantity::new(10_000), false, 0, 0)
            .get()?;
        Wrapper::push_from(&chain, gary)
            .st_glb_fwd(usd, Quantity::new(0), 0, PPM_SCALE, never(), true)
            .get()?;
        Wrapper::push_from(&chain, gary)
            .st_glb_fwd(usd, Quantity::new(0), 0, PPM_SCALE, never(), false)
            .get()?;
        assert!(Wrapper::push_from(&chain, alice)
            .path_pay(
                vec![hop(gary, usd), hop(steve, usd)],
                Quantity::new(100),
                Quantity::new(100),
                0,
            )
            .get()
            .is_err());

        Wrapper::push_from(&chain, gary)
            .st_glb_fwd(usd, Quantity::new(0), 0, PPM_SCALE, never(), true)
            .get()?;
        Wrapper::push_from(&chain, alice)
            .path_pay(
                vec![hop(gary, usd), hop(steve, usd)],
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
            .deposit(alice, usd, Quantity::new(1_000), 0, 0)
            .get()?;
        Wrapper::push_from(&chain, peter)
            .st_crd_lne(bob, usd, Quantity::new(10_000), false, 0, 0)
            .get()?;
        Wrapper::push_from(&chain, peter)
            .st_glb_buy(usd, Quantity::new(0), 0, Quantity::new(u64::MAX), never())
            .get()?;
        Wrapper::push_from(&chain, bob)
            .st_crd_lne(peter, usd, Quantity::new(0), false, 0, 0)
            .get()?;
        assert!(CreditLine::get(bob, peter, usd).is_some());

        Wrapper::push_from(&chain, bob)
            .rm_crd_lne(peter, usd)
            .get()?;
        assert!(CreditLine::get(bob, peter, usd).is_none());
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
            .deposit(isabelle, weetbix, Quantity::new(12), 0, 0)
            .get()?;
        Wrapper::push_from(&chain, john)
            .deposit(isabelle, coffee, Quantity::new(800), 0, 0)
            .get()?;
        assert_eq!(exp(&chain, isabelle, john, weetbix), 12);
        assert_eq!(exp(&chain, isabelle, john, coffee), 800);

        Wrapper::push_from(&chain, isabelle)
            .deposit(john, weetbix, Quantity::new(3), 0, 0)
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
            .st_crd_lne(isabelle, aud, dollars, false, 0, 0)
            .get()?;
        Wrapper::push_from(&chain, isabelle)
            .st_crd_lne(john, merlo, grams, false, 0, 0)
            .get()?;
        Wrapper::push_from(&chain, isabelle)
            .st_fx_ofr(
                merlo,
                aud,
                true,
                Quantity::new(0),
                RATE_SCALE * 50,
                0,
                grams,
                never(),
            )
            .get()?;
        Wrapper::push_from(&chain, isabelle)
            .st_fwd_ofr(michelle, aud, Quantity::new(0), 0, PPM_SCALE, never(), true)
            .get()?;

        let direct = Wrapper::push_from(&chain, john)
            .path_pay(vec![hop(michelle, aud)], dollars, dollars, 0)
            .get();
        assert!(
            direct.is_err(),
            "john has no line to michelle; isabelle has to sit in the middle"
        );
        assert_eq!(exp(&chain, michelle, john, aud), 0);
        assert_eq!(exp(&chain, isabelle, john, merlo), 0);

        Wrapper::push_from(&chain, john)
            .path_pay(
                vec![hop(isabelle, merlo), hop(michelle, aud)],
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
            .st_crd_lne(john, weetbix, Quantity::new(BISCUITS), false, 0, 0)
            .get()?;
        Wrapper::push_from(&chain, michelle)
            .st_crd_lne(isabelle, weetbix, Quantity::new(BISCUITS), false, 0, 0)
            .get()?;
        Wrapper::push_from(&chain, isabelle)
            .st_glb_fwd(weetbix, Quantity::new(0), 0, PPM_SCALE, never(), true)
            .get()?;
        Wrapper::push_from(&chain, michelle)
            .st_fx_ofr(
                weetbix,
                aud,
                true,
                Quantity::new(0),
                rate,
                0,
                Quantity::new(BISCUITS),
                never(),
            )
            .get()?;

        let trade = Wrapper::push_from(&chain, john)
            .path_pay(
                vec![hop(isabelle, weetbix), hop(john, aud)],
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
                vec![hop(isabelle, weetbix), hop(michelle, weetbix)],
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
            .st_crd_lne(john, weetbix, Quantity::new(BISCUITS), false, 0, 0)
            .get()?;
        Wrapper::push_from(&chain, michelle)
            .st_crd_lne(isabelle, weetbix, Quantity::new(BISCUITS), false, 0, 0)
            .get()?;
        Wrapper::push_from(&chain, isabelle)
            .st_crd_lne(john, kwh, Quantity::new(CHARGE), false, 0, 0)
            .get()?;
        Wrapper::push_from(&chain, michelle)
            .st_crd_lne(isabelle, kwh, Quantity::new(CHARGE), false, 0, 0)
            .get()?;
        Wrapper::push_from(&chain, isabelle)
            .st_glb_fwd(weetbix, Quantity::new(0), 0, PPM_SCALE, never(), true)
            .get()?;
        Wrapper::push_from(&chain, isabelle)
            .st_glb_fwd(kwh, Quantity::new(0), 0, PPM_SCALE, never(), true)
            .get()?;

        Wrapper::push_from(&chain, john)
            .path_pay(
                vec![hop(isabelle, weetbix), hop(michelle, weetbix)],
                Quantity::new(BISCUITS),
                Quantity::new(BISCUITS),
                0,
            )
            .get()?;
        Wrapper::push_from(&chain, john)
            .path_pay(
                vec![hop(isabelle, kwh), hop(michelle, kwh)],
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
            .deposit(john, kwh, Quantity::new(ISABELLE_OWES_JOHN), 0, 0)
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
                0,
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

        Wrapper::push_from(&chain, isabelle)
            .take_fx(
                michelle,
                kwh,
                aud,
                true,
                Quantity::new(CHARGE),
                quoted_aud as i64,
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
            .st_crd_lne(john, kwh, Quantity::new(LINE), false, 0, 0)
            .get()?;
        Wrapper::push_from(&chain, michelle)
            .st_crd_lne(isabelle, kwh, Quantity::new(LINE), false, 0, 0)
            .get()?;
        Wrapper::push_from(&chain, isabelle)
            .st_crd_lne(michelle, aud, Quantity::new(AUD_LINE), false, 0, 0)
            .get()?;
        Wrapper::push_from(&chain, john)
            .st_crd_lne(isabelle, aud, Quantity::new(AUD_LINE), false, 0, 0)
            .get()?;
        Wrapper::push_from(&chain, isabelle)
            .st_fwd_ofr(michelle, kwh, Quantity::new(0), 0, PPM_SCALE, never(), true)
            .get()?;
        Wrapper::push_from(&chain, michelle)
            .st_fwd_ofr(isabelle, aud, Quantity::new(0), 0, PPM_SCALE, never(), true)
            .get()?;
        Wrapper::push_from(&chain, isabelle)
            .st_fwd_ofr(john, aud, Quantity::new(0), 0, PPM_SCALE, never(), true)
            .get()?;
        Wrapper::push_from(&chain, michelle)
            .st_fx_ofr(
                kwh,
                aud,
                true,
                Quantity::new(0),
                rate,
                0,
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
                vec![
                    hop(isabelle, kwh),
                    hop(michelle, kwh),
                    hop(isabelle, aud),
                    hop(john, aud),
                ],
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
            .st_crd_lne(alice, aud, Quantity::new(10_000), false, 0, 0)
            .get()?;
        Wrapper::push_from(&chain, steve)
            .st_crd_lne(gary, usd, Quantity::new(10_000), false, 0, 0)
            .get()?;
        Wrapper::push_from(&chain, gary)
            .st_fx_ofr(
                aud,
                usd,
                true,
                Quantity::new(0),
                RATE_SCALE * 70 / 100,
                0,
                Quantity::new(u64::MAX),
                never(),
            )
            .get()?;
        Wrapper::push_from(&chain, gary)
            .st_glb_fwd(usd, Quantity::new(0), 0, PPM_SCALE, never(), true)
            .get()?;
        // Reverse AUD book: Gary owes Alice 1000. Hop-0 debit nets it away.
        Wrapper::push_from(&chain, gary)
            .deposit(alice, aud, Quantity::new(1_000), 0, 0)
            .get()?;

        Wrapper::push_from(&chain, alice)
            .path_pay(
                vec![hop(gary, aud), hop(steve, usd)],
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
            .st_crd_lne(alice, aud, Quantity::new(10_000), false, 0, 0)
            .get()?;
        Wrapper::push_from(&chain, steve)
            .st_crd_lne(gary, usd, Quantity::new(10_000), false, 0, 0)
            .get()?;
        Wrapper::push_from(&chain, gary)
            .st_glb_fwd(usd, Quantity::new(0), 0, PPM_SCALE, never(), true)
            .get()?;

        // Fee equal to the send. The hop prices nothing, and the books stay put.
        Wrapper::push_from(&chain, gary)
            .st_fx_ofr(
                aud,
                usd,
                true,
                Quantity::new(1_000),
                RATE_SCALE * 70 / 100,
                0,
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
                0,
                Quantity::new(9_000),
                never(),
            )
            .get()?;
        let consumed = Wrapper::push_from(&chain, alice).path_pay(
            vec![hop(gary, aud), hop(steve, usd)],
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
                0,
                Quantity::new(1_000),
                never(),
            )
            .get()?;

        // (1000 − 100) × 0.70 = 630. Asking for 700 must fail and leave the budget.
        let short = Wrapper::push_from(&chain, alice).path_pay(
            vec![hop(gary, aud), hop(steve, usd)],
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
                vec![hop(gary, aud), hop(steve, usd)],
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

    /// A debtor-side quote is not a path rate. pathGraph omits it.
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
            .st_crd_lne(alice, aud, Quantity::new(10_000), false, 0, 0)
            .get()?;
        Wrapper::push_from(&chain, steve)
            .st_crd_lne(gary, usd, Quantity::new(10_000), false, 0, 0)
            .get()?;
        Wrapper::push_from(&chain, gary)
            .st_glb_fwd(usd, Quantity::new(0), 0, PPM_SCALE, never(), true)
            .get()?;
        Wrapper::push_from(&chain, gary)
            .st_fx_ofr(
                aud,
                usd,
                false,
                Quantity::new(0),
                RATE_SCALE * 50 / 100,
                0,
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
        let graph_q = r#"{ pathGraph(from: "alice", to: "steve", maxHops: 4) {
            fxOffers { poster fromAsset toAsset posterIsCreditor }
        } }"#;

        let listed = banx_gql(&chain, policies_q)?;
        let graph = banx_gql(&chain, graph_q)?;
        assert_eq!(
            gary_sides(&listed, "/data/fxOffers", aud, usd),
            vec![false],
            "{listed}"
        );
        assert!(
            gary_sides(&graph, "/data/pathGraph/fxOffers", aud, usd).is_empty(),
            "{graph}"
        );

        let debtor_only = Wrapper::push_from(&chain, alice).path_pay(
            vec![hop(gary, aud), hop(steve, usd)],
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
                0,
                Quantity::new(2_000),
                never(),
            )
            .get()?;
        let listed = banx_gql(&chain, policies_q)?;
        let graph = banx_gql(&chain, graph_q)?;
        assert_eq!(
            gary_sides(&listed, "/data/fxOffers", aud, usd),
            vec![false, true],
            "{listed}"
        );
        assert_eq!(
            gary_sides(&graph, "/data/pathGraph/fxOffers", aud, usd),
            vec![true],
            "{graph}"
        );

        Wrapper::push_from(&chain, alice)
            .path_pay(
                vec![hop(gary, aud), hop(steve, usd)],
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
            vec![hop(gary, aud), hop(steve, usd)],
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
        let graph = banx_gql(&chain, graph_q)?;
        assert_eq!(
            gary_sides(&listed, "/data/fxOffers", aud, usd),
            vec![false],
            "{listed}"
        );
        assert!(
            gary_sides(&graph, "/data/pathGraph/fxOffers", aud, usd).is_empty(),
            "{graph}"
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
            .st_crd_lne(alice, aud, Quantity::new(10_000), false, 0, 0)
            .get()?;
        Wrapper::push_from(&chain, steve)
            .st_crd_lne(gary, usd, Quantity::new(10_000), false, 0, 0)
            .get()?;
        Wrapper::push_from(&chain, gary)
            .st_fx_ofr(
                aud,
                usd,
                true,
                Quantity::new(0),
                RATE_SCALE * 70 / 100,
                0,
                Quantity::new(u64::MAX),
                never(),
            )
            .get()?;
        Wrapper::push_from(&chain, gary)
            .st_glb_fwd(usd, Quantity::new(0), 0, PPM_SCALE, never(), true)
            .get()?;
        Wrapper::push_from(&chain, gary)
            .deposit(alice, aud, Quantity::new(400), 0, 0)
            .get()?;

        Wrapper::push_from(&chain, alice)
            .path_pay(
                vec![hop(gary, aud), hop(steve, usd)],
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
            .st_crd_lne(alice, aud, Quantity::new(10_000), false, 0, 0)
            .get()?;
        Wrapper::push_from(&chain, steve)
            .st_crd_lne(gary, usd, Quantity::new(10_000), false, 0, 0)
            .get()?;
        Wrapper::push_from(&chain, sam)
            .st_crd_lne(steve, gbp, Quantity::new(10_000), false, 0, 0)
            .get()?;

        Wrapper::push_from(&chain, gary)
            .st_fx_ofr(
                aud,
                usd,
                true,
                Quantity::new(0),
                RATE_SCALE * 70 / 100,
                0,
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
                0,
                Quantity::new(u64::MAX),
                never(),
            )
            .get()?;
        Wrapper::push_from(&chain, gary)
            .st_glb_fwd(usd, Quantity::new(0), 0, PPM_SCALE, never(), true)
            .get()?;
        Wrapper::push_from(&chain, steve)
            .st_glb_fwd(gbp, Quantity::new(0), 0, PPM_SCALE, never(), true)
            .get()?;
        Wrapper::push_from(&chain, gary)
            .deposit(alice, aud, Quantity::new(400), 0, 0)
            .get()?;

        Wrapper::push_from(&chain, alice)
            .path_pay(
                vec![hop(gary, aud), hop(steve, usd), hop(sam, gbp)],
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

    /// path_pay FX does not rebook Alice into USD. Old 20% AUD and new 0% AUD
    /// both stay; Gary takes the USD liability to Steve.
    #[psibase::test_case(packages("Banx"))]
    fn test_path_pay_fx_does_not_rebook_prior_rate_bucket(
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
            .st_crd_lne(alice, aud, Quantity::new(10_000), false, 200_000, 0)
            .get()?;
        Wrapper::push_from(&chain, alice)
            .path_pay(
                vec![hop(gary, aud)],
                Quantity::new(500),
                Quantity::new(500),
                0,
            )
            .get()?;
        assert_eq!(exp(&chain, gary, alice, aud), 500);

        Wrapper::push_from(&chain, gary)
            .st_crd_lne(alice, aud, Quantity::new(10_000), false, 0, 0)
            .get()?;
        Wrapper::push_from(&chain, steve)
            .st_crd_lne(gary, usd, Quantity::new(10_000), false, 0, 0)
            .get()?;
        Wrapper::push_from(&chain, gary)
            .st_fx_ofr(
                aud,
                usd,
                true,
                Quantity::new(0),
                RATE_SCALE * 70 / 100,
                0,
                Quantity::new(u64::MAX),
                never(),
            )
            .get()?;
        Wrapper::push_from(&chain, gary)
            .st_glb_fwd(usd, Quantity::new(0), 0, PPM_SCALE, never(), true)
            .get()?;

        Wrapper::push_from(&chain, alice)
            .path_pay(
                vec![hop(gary, aud), hop(steve, usd)],
                Quantity::new(1_000),
                Quantity::new(700),
                0,
            )
            .get()?;

        let prior = Obligation::get_by_interest_rate(gary, alice, aud, 200_000)
            .expect("prior 20% AUD bucket");
        assert_eq!(prior.remaining_principal.value, 500);
        let new_draw = Obligation::get_by_interest_rate(gary, alice, aud, 0)
            .expect("new 0% AUD draw stays AUD");
        assert_eq!(new_draw.remaining_principal.value, 1_000);
        assert_eq!(exp(&chain, gary, alice, aud), 1500);
        assert_eq!(exp(&chain, gary, alice, usd), 0);
        assert_eq!(exp(&chain, steve, gary, usd), 700);
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
            .st_crd_lne(alice, aud, Quantity::new(10_000), false, 0, 0)
            .get()?;
        Wrapper::push_from(&chain, steve)
            .st_crd_lne(gary, usd, Quantity::new(10_000), false, 0, 0)
            .get()?;
        Wrapper::push_from(&chain, gary)
            .st_glb_fwd(usd, Quantity::new(0), 0, PPM_SCALE, never(), true)
            .get()?;
        Wrapper::push_from(&chain, alice)
            .st_fx_ofr(
                aud,
                usd,
                true,
                Quantity::new(0),
                RATE_SCALE * 50 / 100,
                0,
                Quantity::new(u64::MAX),
                never(),
            )
            .get()?;

        let no_gary = Wrapper::push_from(&chain, alice)
            .path_pay(
                vec![hop(gary, aud), hop(steve, usd)],
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
                0,
                Quantity::new(u64::MAX),
                never(),
            )
            .get()?;
        Wrapper::push_from(&chain, alice)
            .path_pay(
                vec![hop(gary, aud), hop(steve, usd)],
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
            .st_crd_lne(alice, usd, Quantity::new(100), false, 0, 0)
            .get()
            .is_err());
        let bob = account!("bob");
        chain.new_account(bob).unwrap();
        let missing = crate::iso4217::SEEDED_ASSETS.len() as u16 + 1;
        assert!(Wrapper::push_from(&chain, alice)
            .st_crd_lne(bob, missing, Quantity::new(100), false, 0, 0)
            .get()
            .is_err());
        assert!(Wrapper::push_from(&chain, alice)
            .st_crd_lne(bob, usd, Quantity::new(100), false, PPM_SCALE + 1, 0)
            .get()
            .is_err());
        assert!(Wrapper::push_from(&chain, alice)
            .deposit(alice, usd, Quantity::new(1), 0, 0)
            .get()
            .is_err());
        assert!(Wrapper::push_from(&chain, alice)
            .deposit(bob, usd, Quantity::new(0), 0, 0)
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
            .st_crd_lne(ghost, usd, Quantity::new(100), false, 0, 0)
            .get()
            .is_err());
        assert!(Wrapper::push_from(&chain, alice)
            .st_fwd_ofr(ghost, usd, Quantity::new(0), 0, PPM_SCALE, never(), true)
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
            .deposit(ghost, usd, Quantity::new(1), 0, 0)
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
                0,
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
                0,
                Quantity::new(u64::MAX),
                never(),
            )
            .get();
        assert!(fx_from.is_err());
        let fwd = Wrapper::push_from(&chain, alice)
            .st_glb_fwd(missing, Quantity::new(0), 0, PPM_SCALE, never(), true)
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
    fn test_accrue_and_interest_first_net(chain: psibase::Chain) -> Result<(), psibase::Error> {
        Wrapper::push(&chain).init().get()?;
        let alice = account!("alice");
        let bob = account!("bob");
        chain.new_account(alice).unwrap();
        chain.new_account(bob).unwrap();
        let usd = Asset::get_by_symbol_assert(account!("usd")).id;

        Wrapper::push_from(&chain, bob)
            .deposit(alice, usd, Quantity::new(1_000_000), 100_000, 0)
            .get()?;
        Wrapper::push_from(&chain, bob)
            .deposit(alice, usd, Quantity::new(1_000_000), 10_000, 0)
            .get()?;

        chain.start_block_after(Seconds::new(SECONDS_PER_YEAR as i64).into());
        // Live interest — no accrue action needed.
        assert_eq!(exp(&chain, alice, bob, usd), 2_114_819);

        // Net the 10% bucket's interest first (highest rate).
        Wrapper::push_from(&chain, alice)
            .deposit(bob, usd, Quantity::new(104_964), 0, 0)
            .get()?;
        assert_eq!(exp(&chain, alice, bob, usd), 2_009_855);
        let hi = Obligation::get_by_interest_rate(alice, bob, usd, 100_000).unwrap();
        assert_eq!(hi.accrued_interest.value, 0);
        assert_eq!(hi.remaining_principal.value, 1_000_000);
        let lo = Obligation::get_by_interest_rate(alice, bob, usd, 10_000).unwrap();
        assert_eq!(lo.accrued_interest.value, 9_855);
        Ok(())
    }

    /// Daily 10% on $100.0000 over two years without locking the epoch.
    #[psibase::test_case(packages("Banx"))]
    fn test_interest_one_floor_over_epoch(chain: psibase::Chain) -> Result<(), psibase::Error> {
        Wrapper::push(&chain).init().get()?;
        let alice = account!("alice");
        let bob = account!("bob");
        chain.new_account(alice).unwrap();
        chain.new_account(bob).unwrap();
        let usd = Asset::get_by_symbol_assert(account!("usd")).id;

        Wrapper::push_from(&chain, bob)
            .deposit(alice, usd, Quantity::new(1_000_000), 100_000, 0)
            .get()?;

        chain.start_block_after(Seconds::new(SECONDS_PER_YEAR as i64).into());
        assert_eq!(exp(&chain, alice, bob, usd), 1_104_964);

        chain.start_block_after(Seconds::new(SECONDS_PER_YEAR as i64).into());
        assert_eq!(
            exp(&chain, alice, bob, usd),
            1_220_966,
            "daily 10% over 2y from original principal, not two 1y locks"
        );
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
            .deposit(alice, usd, Quantity::new(1_000), 0, 0)
            .get()?;
        Wrapper::push_from(&chain, peter)
            .st_crd_lne(bob, usd, Quantity::new(10_000), false, 0, 0)
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
            .st_crd_lne(peter, usd, Quantity::new(0), false, 0, 0)
            .get()?;

        Wrapper::push_from(&chain, alice)
            .sell_claim(peter, bob, usd, Quantity::new(1_000), Quantity::new(0))
            .get()?;
        assert_eq!(exp(&chain, alice, peter, usd), 1_000);
        Ok(())
    }

    const WEEK_SECS: u32 = 7 * 86_400;

    #[psibase::test_case(packages("Banx"))]
    fn test_grace_hides_interest_then_charges_after(
        chain: psibase::Chain,
    ) -> Result<(), psibase::Error> {
        Wrapper::push(&chain).init().get()?;
        let alice = account!("alice");
        let bob = account!("bob");
        chain.new_account(alice).unwrap();
        chain.new_account(bob).unwrap();
        let usd = Asset::get_by_symbol_assert(account!("usd")).id;

        Wrapper::push_from(&chain, bob)
            .st_crd_lne(
                alice,
                usd,
                Quantity::new(10_000_000),
                false,
                100_000,
                WEEK_SECS,
            )
            .get()?;
        Wrapper::push_from(&chain, alice)
            .path_pay(
                vec![hop(bob, usd)],
                Quantity::new(1_000_000),
                Quantity::new(1_000_000),
                0,
            )
            .get()?;

        chain.start_block_after(Seconds::new(12 * 3600).into());
        assert_eq!(exp(&chain, bob, alice, usd), 1_000_000);

        // 8 days from origination (7d grace + 1d charged).
        chain.start_block_after(Seconds::new(8 * 86_400 - 12 * 3600).into());
        assert_eq!(exp(&chain, bob, alice, usd), 1_002_191);
        Ok(())
    }

    /// A net that cancels nothing must not slide the interest epoch.
    /// Day-8 exposure stays the full compound from origination.
    #[psibase::test_case(packages("Banx"))]
    fn test_grace_noop_net_keeps_origination_epoch(
        chain: psibase::Chain,
    ) -> Result<(), psibase::Error> {
        Wrapper::push(&chain).init().get()?;
        let alice = account!("alice");
        let bob = account!("bob");
        chain.new_account(alice).unwrap();
        chain.new_account(bob).unwrap();
        let usd = Asset::get_by_symbol_assert(account!("usd")).id;
        const RATE: i32 = 100_000;
        const PRINCIPAL: u64 = 1_000_000;

        Wrapper::push_from(&chain, bob)
            .st_crd_lne(
                alice,
                usd,
                Quantity::new(10_000_000),
                false,
                RATE as u32,
                WEEK_SECS,
            )
            .get()?;
        Wrapper::push_from(&chain, alice)
            .path_pay(
                vec![hop(bob, usd)],
                Quantity::new(PRINCIPAL),
                Quantity::new(PRINCIPAL),
                0,
            )
            .get()?;

        let epoch = Obligation::get_by_interest_rate(bob, alice, usd, RATE)
            .unwrap()
            .last_interest_accrual
            .seconds;

        chain.start_block_after(Seconds::new(3 * 86_400).into());
        Wrapper::push_from(&chain, alice)
            .net(bob, usd, Quantity::new(0))
            .get()?;
        assert_eq!(exp(&chain, bob, alice, usd), PRINCIPAL);

        let epoch_after = Obligation::get_by_interest_rate(bob, alice, usd, RATE)
            .unwrap()
            .last_interest_accrual
            .seconds;
        assert_eq!(
            epoch_after, epoch,
            "no-op net during grace moved last_interest_accrual from {epoch} to {epoch_after}"
        );

        chain.start_block_after(Seconds::new(5 * 86_400).into());
        let want = compound_amount(PRINCIPAL, RATE, 8 * SECONDS_PER_DAY as u64);
        let slid = compound_amount(PRINCIPAL, RATE, 5 * SECONDS_PER_DAY as u64);
        let got = exp(&chain, bob, alice, usd);
        assert_eq!(
            got, want,
            "no-op net on day 3 must not restart the epoch; day-8 exposure should be \
             8 days from origination ({want}), not 5 days from the poke ({slid}), got {got}"
        );
        Ok(())
    }

    /// An over-cap split already stored during grace must be written down to
    /// the cap without moving the epoch. Forgive then spends that settleable
    /// balance, not the phantom accrued above the cap.
    #[psibase::test_case(packages("Banx"))]
    fn test_grace_over_cap_trim_persists_without_sliding_epoch(
        chain: psibase::Chain,
    ) -> Result<(), psibase::Error> {
        Wrapper::push(&chain).init().get()?;
        let alice = account!("alice");
        let bob = account!("bob");
        chain.new_account(alice).unwrap();
        chain.new_account(bob).unwrap();
        let usd = Asset::get_by_symbol_assert(account!("usd")).id;

        Wrapper::push_from(&chain, bob)
            .st_crd_lne(alice, usd, Quantity::new(10_000), false, 0, WEEK_SECS)
            .get()?;
        Wrapper::push_from(&chain, alice)
            .path_pay(
                vec![hop(bob, usd)],
                Quantity::new(1_000),
                Quantity::new(1_000),
                0,
            )
            .get()?;

        let mut row = Obligation::get_by_interest_rate(bob, alice, usd, 0).unwrap();
        let epoch = row.last_interest_accrual.seconds;
        row.accrued_interest = Quantity::new(u64::MAX - 100);
        plant_obligation(&chain, &row);
        let stored = Obligation::get_by_interest_rate(bob, alice, usd, 0).unwrap();
        assert_eq!(
            stored.accrued_interest.value,
            u64::MAX - 100,
            "over-cap split was not stored"
        );
        assert_eq!(exp(&chain, bob, alice, usd), u64::MAX);

        Wrapper::push_from(&chain, alice)
            .net(bob, usd, Quantity::new(0))
            .get()?;
        let row = Obligation::get_by_interest_rate(bob, alice, usd, 0).unwrap();
        assert_eq!(row.remaining_principal.value, 1_000);
        assert_eq!(row.accrued_interest.value, u64::MAX - 1_000);
        assert_eq!(
            row.last_interest_accrual.seconds, epoch,
            "writing the cap down during grace moved last_interest_accrual"
        );
        assert_eq!(exp(&chain, bob, alice, usd), u64::MAX);

        Wrapper::push_from(&chain, bob)
            .forgive(alice, usd, Quantity::new(1))
            .get()?;
        assert_eq!(exp(&chain, bob, alice, usd), u64::MAX - 1);
        let row = Obligation::get_by_interest_rate(bob, alice, usd, 0).unwrap();
        assert_eq!(row.remaining_principal.value, 1_000);
        assert_eq!(row.accrued_interest.value, u64::MAX - 1_000 - 1);
        Ok(())
    }

    /// Crediting a different rate bucket during grace must not restart
    /// an untouched bucket's epoch. Auto-net with nothing to cancel is
    /// still a lone accrue on that other row.
    #[psibase::test_case(packages("Banx"))]
    fn test_grace_other_rate_keeps_origination_epoch(
        chain: psibase::Chain,
    ) -> Result<(), psibase::Error> {
        Wrapper::push(&chain).init().get()?;
        let alice = account!("alice");
        let bob = account!("bob");
        chain.new_account(alice).unwrap();
        chain.new_account(bob).unwrap();
        let usd = Asset::get_by_symbol_assert(account!("usd")).id;
        const RATE: i32 = 100_000;
        const PRINCIPAL: u64 = 1_000_000;

        Wrapper::push_from(&chain, bob)
            .st_crd_lne(
                alice,
                usd,
                Quantity::new(10_000_000),
                false,
                RATE as u32,
                WEEK_SECS,
            )
            .get()?;
        Wrapper::push_from(&chain, alice)
            .path_pay(
                vec![hop(bob, usd)],
                Quantity::new(PRINCIPAL),
                Quantity::new(PRINCIPAL),
                0,
            )
            .get()?;

        let epoch = Obligation::get_by_interest_rate(bob, alice, usd, RATE)
            .unwrap()
            .last_interest_accrual
            .seconds;

        chain.start_block_after(Seconds::new(3 * 86_400).into());
        // Same direction as the draw: Alice owes Bob 1 more unit, at 0%.
        // Nothing sits on the reverse side, so auto-net cancels 0.
        Wrapper::push_from(&chain, alice)
            .deposit(bob, usd, Quantity::new(1), 0, 0)
            .get()?;

        let hi = Obligation::get_by_interest_rate(bob, alice, usd, RATE).unwrap();
        assert_eq!(hi.remaining_principal.value, PRINCIPAL);
        assert_eq!(
            hi.last_interest_accrual.seconds, epoch,
            "0% deposit on day 3 moved the untouched 10% epoch from {epoch} to {}",
            hi.last_interest_accrual.seconds
        );
        let dust = Obligation::get_by_interest_rate(bob, alice, usd, 0).unwrap();
        assert_eq!(dust.remaining_principal.value, 1);

        chain.start_block_after(Seconds::new(5 * 86_400).into());
        let want = compound_amount(PRINCIPAL, RATE, 8 * SECONDS_PER_DAY as u64) + 1;
        let slid = compound_amount(PRINCIPAL, RATE, 5 * SECONDS_PER_DAY as u64) + 1;
        let got = exp(&chain, bob, alice, usd);
        assert_eq!(
            got, want,
            "untouched 10% bucket must still compound 8 days from origination ({want}), \
             not 5 days from the other bucket's credit ({slid}), got {got}"
        );
        Ok(())
    }

    #[psibase::test_case(packages("Banx"))]
    fn test_grace_repay_to_zero_waives(chain: psibase::Chain) -> Result<(), psibase::Error> {
        Wrapper::push(&chain).init().get()?;
        let alice = account!("alice");
        let bob = account!("bob");
        chain.new_account(alice).unwrap();
        chain.new_account(bob).unwrap();
        let usd = Asset::get_by_symbol_assert(account!("usd")).id;

        Wrapper::push_from(&chain, bob)
            .st_crd_lne(
                alice,
                usd,
                Quantity::new(10_000_000),
                false,
                100_000,
                WEEK_SECS,
            )
            .get()?;
        Wrapper::push_from(&chain, alice)
            .path_pay(
                vec![hop(bob, usd)],
                Quantity::new(1_000_000),
                Quantity::new(1_000_000),
                0,
            )
            .get()?;

        chain.start_block_after(Seconds::new(86_400).into());
        assert_eq!(exp(&chain, bob, alice, usd), 1_000_000);
        Wrapper::push_from(&chain, bob)
            .deposit(alice, usd, Quantity::new(1_000_000), 0, 0)
            .get()?;
        assert_eq!(exp(&chain, bob, alice, usd), 0);

        chain.start_block_after(Seconds::new(i64::from(WEEK_SECS)).into());
        assert_eq!(exp(&chain, bob, alice, usd), 0);
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
            .deposit(alice, usd, Quantity::new(1_000), 0, 0)
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
        // Already empty. This still succeeds: accrue may have deleted a
        // decayed row, and a failed action would put that row back.
        Wrapper::push_from(&chain, alice)
            .forgive(bob, usd, Quantity::new(1))
            .get()?;
        assert_eq!(exp(&chain, alice, bob, usd), 0);
        Ok(())
    }

    /// Principal at the u64 ceiling compounds to the cap and can still be forgiven.
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
            .deposit(bob, usd, Quantity::new(u64::MAX), 1, 0)
            .get()?;
        assert_eq!(exp(&chain, bob, alice, usd), u64::MAX);

        chain.start_block_after(Seconds::new(1).into());
        assert_eq!(exp(&chain, bob, alice, usd), u64::MAX);

        Wrapper::push_from(&chain, bob)
            .forgive(alice, usd, Quantity::new(u64::MAX))
            .get()?;
        assert_eq!(exp(&chain, bob, alice, usd), 0);
        Ok(())
    }

    #[psibase::test_case(packages("Banx"))]
    fn test_forgive_interest_first_waterfall(chain: psibase::Chain) -> Result<(), psibase::Error> {
        Wrapper::push(&chain).init().get()?;
        let alice = account!("alice");
        let bob = account!("bob");
        chain.new_account(alice).unwrap();
        chain.new_account(bob).unwrap();
        let usd = Asset::get_by_symbol_assert(account!("usd")).id;

        Wrapper::push_from(&chain, bob)
            .deposit(alice, usd, Quantity::new(1_000_000), 100_000, 0)
            .get()?;
        Wrapper::push_from(&chain, bob)
            .deposit(alice, usd, Quantity::new(1_000_000), 10_000, 0)
            .get()?;

        chain.start_block_after(Seconds::new(SECONDS_PER_YEAR as i64).into());
        assert_eq!(exp(&chain, alice, bob, usd), 2_114_819);

        Wrapper::push_from(&chain, alice)
            .forgive(bob, usd, Quantity::new(104_964))
            .get()?;
        assert_eq!(exp(&chain, alice, bob, usd), 2_009_855);
        let hi = Obligation::get_by_interest_rate(alice, bob, usd, 100_000).unwrap();
        assert_eq!(hi.accrued_interest.value, 0);
        assert_eq!(hi.remaining_principal.value, 1_000_000);
        let lo = Obligation::get_by_interest_rate(alice, bob, usd, 10_000).unwrap();
        assert_eq!(lo.accrued_interest.value, 9_855);
        Ok(())
    }

    /// Partial write-off keeps the open grace snapshot. Remaining principal
    /// compounds from that change after the original window ends.
    #[psibase::test_case(packages("Banx"))]
    fn test_forgive_partial_keeps_grace(chain: psibase::Chain) -> Result<(), psibase::Error> {
        Wrapper::push(&chain).init().get()?;
        let alice = account!("alice");
        let bob = account!("bob");
        chain.new_account(alice).unwrap();
        chain.new_account(bob).unwrap();
        let usd = Asset::get_by_symbol_assert(account!("usd")).id;

        Wrapper::push_from(&chain, bob)
            .st_crd_lne(
                alice,
                usd,
                Quantity::new(10_000_000),
                false,
                100_000,
                WEEK_SECS,
            )
            .get()?;
        Wrapper::push_from(&chain, alice)
            .path_pay(
                vec![hop(bob, usd)],
                Quantity::new(1_000_000),
                Quantity::new(1_000_000),
                0,
            )
            .get()?;

        let opened = PairCycle::get(bob, alice, usd).expect("open cycle");
        assert!(opened.cycle_started_at.seconds != 0);
        assert_eq!(opened.cycle_grace_seconds, WEEK_SECS);

        chain.start_block_after(Seconds::new(3 * 86_400).into());
        Wrapper::push_from(&chain, bob)
            .forgive(alice, usd, Quantity::new(400_000))
            .get()?;
        assert_eq!(exp(&chain, bob, alice, usd), 600_000);

        let after = PairCycle::get(bob, alice, usd).expect("cycle still open");
        assert_eq!(
            after.cycle_started_at.seconds,
            opened.cycle_started_at.seconds
        );
        assert_eq!(after.cycle_grace_seconds, WEEK_SECS);

        chain.start_block_after(Seconds::new(3 * 86_400).into());
        assert_eq!(
            exp(&chain, bob, alice, usd),
            600_000,
            "still inside the original 7-day window"
        );

        chain.start_block_after(Seconds::new(2 * 86_400).into());
        let want = compound_amount(600_000, 100_000, 5 * SECONDS_PER_DAY as u64);
        let got = exp(&chain, bob, alice, usd);
        assert_eq!(
            got, want,
            "forgave 400k on day 3; day-8 exposure should be 600k compounded \
             5 days from the write-off ({want}), not 8 days from origination ({got})"
        );
        Ok(())
    }

    /// Writing principal to 0 closes the cycle. A later draw starts a new one.
    #[psibase::test_case(packages("Banx"))]
    fn test_forgive_to_zero_closes_grace(chain: psibase::Chain) -> Result<(), psibase::Error> {
        Wrapper::push(&chain).init().get()?;
        let alice = account!("alice");
        let bob = account!("bob");
        chain.new_account(alice).unwrap();
        chain.new_account(bob).unwrap();
        let usd = Asset::get_by_symbol_assert(account!("usd")).id;

        Wrapper::push_from(&chain, bob)
            .st_crd_lne(
                alice,
                usd,
                Quantity::new(10_000_000),
                false,
                100_000,
                WEEK_SECS,
            )
            .get()?;
        Wrapper::push_from(&chain, alice)
            .path_pay(
                vec![hop(bob, usd)],
                Quantity::new(1_000_000),
                Quantity::new(1_000_000),
                0,
            )
            .get()?;

        chain.start_block_after(Seconds::new(86_400).into());
        Wrapper::push_from(&chain, bob)
            .forgive(alice, usd, Quantity::new(1_000_000))
            .get()?;
        assert_eq!(exp(&chain, bob, alice, usd), 0);
        let closed = PairCycle::get(bob, alice, usd).expect("posted grace row remains");
        assert_eq!(closed.cycle_started_at.seconds, 0);
        assert_eq!(closed.cycle_grace_seconds, 0);

        chain.start_block_after(Seconds::new(i64::from(WEEK_SECS)).into());
        assert_eq!(exp(&chain, bob, alice, usd), 0);

        Wrapper::push_from(&chain, alice)
            .path_pay(
                vec![hop(bob, usd)],
                Quantity::new(1_000_000),
                Quantity::new(1_000_000),
                0,
            )
            .get()?;
        let reopened = PairCycle::get(bob, alice, usd).expect("new cycle");
        assert!(reopened.cycle_started_at.seconds != 0);
        assert_eq!(reopened.cycle_grace_seconds, WEEK_SECS);

        chain.start_block_after(Seconds::new(86_400).into());
        assert_eq!(
            exp(&chain, bob, alice, usd),
            1_000_000,
            "new cycle has a fresh grace window"
        );
        Ok(())
    }

    #[psibase::test_case(packages("Banx"))]
    fn test_grace_snapshot_ignores_later_line_edit(
        chain: psibase::Chain,
    ) -> Result<(), psibase::Error> {
        Wrapper::push(&chain).init().get()?;
        let alice = account!("alice");
        let bob = account!("bob");
        chain.new_account(alice).unwrap();
        chain.new_account(bob).unwrap();
        let usd = Asset::get_by_symbol_assert(account!("usd")).id;

        Wrapper::push_from(&chain, bob)
            .st_crd_lne(
                alice,
                usd,
                Quantity::new(10_000_000),
                false,
                100_000,
                WEEK_SECS,
            )
            .get()?;
        Wrapper::push_from(&chain, alice)
            .path_pay(
                vec![hop(bob, usd)],
                Quantity::new(1_000_000),
                Quantity::new(1_000_000),
                0,
            )
            .get()?;
        // Yank posted grace; open cycle must keep the snapshot.
        Wrapper::push_from(&chain, bob)
            .st_crd_lne(alice, usd, Quantity::new(10_000_000), false, 100_000, 0)
            .get()?;

        chain.start_block_after(Seconds::new(12 * 3600).into());
        assert_eq!(exp(&chain, bob, alice, usd), 1_000_000);
        let cycle = PairCycle::get(bob, alice, usd).expect("open cycle");
        assert_eq!(cycle.grace_seconds, 0);
        assert_eq!(cycle.cycle_grace_seconds, WEEK_SECS);
        assert!(cycle.cycle_started_at.seconds != 0);
        Ok(())
    }

    /// Mid-grace sale keeps the original window. Buyer does not start a new one.
    #[psibase::test_case(packages("Banx"))]
    fn test_sell_claim_inherits_remaining_grace(
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

        Wrapper::push_from(&chain, alice)
            .st_crd_lne(
                bob,
                usd,
                Quantity::new(10_000_000),
                false,
                100_000,
                WEEK_SECS,
            )
            .get()?;
        Wrapper::push_from(&chain, bob)
            .path_pay(
                vec![hop(alice, usd)],
                Quantity::new(1_000_000),
                Quantity::new(1_000_000),
                0,
            )
            .get()?;

        chain.start_block_after(Seconds::new(3 * 86_400).into());
        assert_eq!(exp(&chain, alice, bob, usd), 1_000_000);

        Wrapper::push_from(&chain, peter)
            .st_crd_lne(bob, usd, Quantity::new(10_000_000), false, 0, 0)
            .get()?;
        Wrapper::push_from(&chain, peter)
            .st_glb_buy(usd, Quantity::new(0), 0, Quantity::new(u64::MAX), never())
            .get()?;
        Wrapper::push_from(&chain, bob)
            .st_crd_lne(peter, usd, Quantity::new(0), false, 0, 0)
            .get()?;
        Wrapper::push_from(&chain, alice)
            .sell_claim(peter, bob, usd, Quantity::new(1_000_000), Quantity::new(0))
            .get()?;

        assert_eq!(exp(&chain, alice, bob, usd), 0);
        assert_eq!(exp(&chain, peter, bob, usd), 1_000_000);
        chain.start_block_after(Seconds::new(3 * 86_400).into());
        assert_eq!(
            exp(&chain, peter, bob, usd),
            1_000_000,
            "still inside the original 7-day window"
        );
        Ok(())
    }

    /// Selling one in-grace unit into a buyer who already holds an open
    /// cycle must not push that cycle's end later. The buyer's existing
    /// principal keeps its window.
    #[psibase::test_case(packages("Banx"))]
    fn test_sell_claim_does_not_lengthen_open_dest_grace(
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
        const RATE: i32 = 100_000;
        const PETER_PRINCIPAL: u64 = 1_000_000;

        Wrapper::push_from(&chain, peter)
            .st_crd_lne(
                bob,
                usd,
                Quantity::new(10_000_000),
                false,
                RATE as u32,
                WEEK_SECS,
            )
            .get()?;
        Wrapper::push_from(&chain, bob)
            .path_pay(
                vec![hop(peter, usd)],
                Quantity::new(PETER_PRINCIPAL),
                Quantity::new(PETER_PRINCIPAL),
                0,
            )
            .get()?;
        Wrapper::push_from(&chain, peter)
            .st_glb_buy(usd, Quantity::new(0), 0, Quantity::new(u64::MAX), never())
            .get()?;

        // One day of Peter's 7-day window left.
        chain.start_block_after(Seconds::new(6 * 86_400).into());
        assert_eq!(exp(&chain, peter, bob, usd), PETER_PRINCIPAL);

        Wrapper::push_from(&chain, alice)
            .st_crd_lne(
                bob,
                usd,
                Quantity::new(10_000_000),
                false,
                RATE as u32,
                WEEK_SECS,
            )
            .get()?;
        Wrapper::push_from(&chain, bob)
            .path_pay(
                vec![hop(alice, usd)],
                Quantity::new(1_000),
                Quantity::new(1_000),
                0,
            )
            .get()?;

        let before = PairCycle::get(peter, bob, usd).expect("peter's open cycle");
        assert_eq!(before.cycle_grace_seconds, WEEK_SECS);
        assert!(before.cycle_started_at.seconds != 0);

        Wrapper::push_from(&chain, alice)
            .sell_claim(peter, bob, usd, Quantity::new(1), Quantity::new(0))
            .get()?;

        assert_eq!(exp(&chain, peter, bob, usd), PETER_PRINCIPAL + 1);
        assert_eq!(exp(&chain, alice, bob, usd), 999);
        let after = PairCycle::get(peter, bob, usd).expect("cycle still open");
        assert_eq!(
            after.cycle_started_at.seconds,
            before.cycle_started_at.seconds
        );
        assert_eq!(
            after.cycle_grace_seconds, before.cycle_grace_seconds,
            "1-unit sale lengthened Peter's open grace from {}s to {}s",
            before.cycle_grace_seconds, after.cycle_grace_seconds
        );

        // Past Peter's original end, still inside Alice's later window.
        chain.start_block_after(Seconds::new(2 * 86_400).into());
        let face = PETER_PRINCIPAL + 1;
        let got = exp(&chain, peter, bob, usd);
        assert!(
            got > face,
            "Peter's original window has ended; existing principal must be \
             charging (face {face}, got {got})"
        );
        Ok(())
    }

    /// A sale after grace has ended must not open the buyer's posted window.
    #[psibase::test_case(packages("Banx"))]
    fn test_sell_claim_does_not_reset_expired_grace(
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

        Wrapper::push_from(&chain, alice)
            .st_crd_lne(
                bob,
                usd,
                Quantity::new(10_000_000),
                false,
                100_000,
                WEEK_SECS,
            )
            .get()?;
        Wrapper::push_from(&chain, bob)
            .path_pay(
                vec![hop(alice, usd)],
                Quantity::new(1_000_000),
                Quantity::new(1_000_000),
                0,
            )
            .get()?;

        chain.start_block_after(Seconds::new(i64::from(WEEK_SECS) + 86_400).into());
        let aged = exp(&chain, alice, bob, usd);
        assert!(aged > 1_000_000, "source already past grace");

        Wrapper::push_from(&chain, peter)
            .st_crd_lne(
                bob,
                usd,
                Quantity::new(10_000_000),
                false,
                100_000,
                WEEK_SECS,
            )
            .get()?;
        Wrapper::push_from(&chain, peter)
            .st_glb_buy(usd, Quantity::new(0), 0, Quantity::new(u64::MAX), never())
            .get()?;
        Wrapper::push_from(&chain, bob)
            .st_crd_lne(peter, usd, Quantity::new(0), false, 0, 0)
            .get()?;
        Wrapper::push_from(&chain, alice)
            .sell_claim(peter, bob, usd, Quantity::new(aged), Quantity::new(0))
            .get()?;

        let face = exp(&chain, peter, bob, usd);
        assert!(face > 0);
        chain.start_block_after(Seconds::new(86_400).into());
        assert!(
            exp(&chain, peter, bob, usd) > face,
            "buyer's posted grace must not restart on an aged claim"
        );
        Ok(())
    }

    /// Aged-claim sale onto a buyer who already holds an in-grace claim on
    /// the same debtor must keep transferred finalized interest. Dest grace
    /// suppresses new compounding; it must not erase the source's interest.
    #[psibase::test_case(packages("Banx"))]
    fn test_sell_claim_keeps_interest_on_in_grace_dest(
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
        const RATE: i32 = 100_000;
        const SRC_PRINCIPAL: u64 = 1_000_000;
        const DEST_PRINCIPAL: u64 = 500_000;

        Wrapper::push_from(&chain, alice)
            .st_crd_lne(
                bob,
                usd,
                Quantity::new(10_000_000),
                false,
                RATE as u32,
                WEEK_SECS,
            )
            .get()?;
        Wrapper::push_from(&chain, bob)
            .path_pay(
                vec![hop(alice, usd)],
                Quantity::new(SRC_PRINCIPAL),
                Quantity::new(SRC_PRINCIPAL),
                0,
            )
            .get()?;

        chain.start_block_after(Seconds::new(i64::from(WEEK_SECS) + 86_400).into());
        let src_face = exp(&chain, alice, bob, usd);
        assert!(src_face > SRC_PRINCIPAL, "source already past grace");
        let src_interest = src_face - SRC_PRINCIPAL;

        Wrapper::push_from(&chain, peter)
            .st_crd_lne(
                bob,
                usd,
                Quantity::new(10_000_000),
                false,
                RATE as u32,
                WEEK_SECS,
            )
            .get()?;
        Wrapper::push_from(&chain, bob)
            .path_pay(
                vec![hop(peter, usd)],
                Quantity::new(DEST_PRINCIPAL),
                Quantity::new(DEST_PRINCIPAL),
                0,
            )
            .get()?;
        let dest_before = exp(&chain, peter, bob, usd);
        assert_eq!(dest_before, DEST_PRINCIPAL, "dest still in grace");

        Wrapper::push_from(&chain, peter)
            .st_glb_buy(usd, Quantity::new(0), 0, Quantity::new(u64::MAX), never())
            .get()?;
        Wrapper::push_from(&chain, bob)
            .st_crd_lne(peter, usd, Quantity::new(0), false, 0, 0)
            .get()?;
        Wrapper::push_from(&chain, alice)
            .sell_claim(peter, bob, usd, Quantity::new(src_face), Quantity::new(0))
            .get()?;

        assert_eq!(exp(&chain, alice, bob, usd), 0);
        assert_eq!(
            exp(&chain, alice, peter, usd),
            src_face,
            "seller is paid on full face (principal + interest)"
        );

        let dest = Obligation::get_by_interest_rate(peter, bob, usd, RATE).expect("dest claim");
        assert_eq!(
            dest.remaining_principal.value,
            DEST_PRINCIPAL + SRC_PRINCIPAL
        );
        assert_eq!(
            dest.accrued_interest.value, src_interest,
            "transferred finalized interest must not be zeroed by dest grace"
        );
        assert_eq!(
            exp(&chain, peter, bob, usd),
            dest_before + src_face,
            "debtor exposure must include transferred interest"
        );

        Wrapper::push_from(&chain, peter)
            .forgive(bob, usd, Quantity::new(1))
            .get()?;
        let dest = Obligation::get_by_interest_rate(peter, bob, usd, RATE).expect("dest claim");
        assert_eq!(dest.accrued_interest.value, src_interest - 1);
        let cycle = PairCycle::get(peter, bob, usd).expect("dest cycle");
        assert!(
            cycle.cycle_started_at.seconds != 0,
            "forgiving transferred interest must not close dest grace"
        );
        assert_eq!(cycle.cycle_grace_seconds, WEEK_SECS);

        Ok(())
    }

    /// Interest-only sale onto an empty dest must not start the buyer's posted
    /// grace. A later draw on that dest must not open it either.
    #[psibase::test_case(packages("Banx"))]
    fn test_sell_interest_only_does_not_open_dest_grace(
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
        const RATE: i32 = 100_000;
        const SRC_PRINCIPAL: u64 = 1_000_000;

        Wrapper::push_from(&chain, alice)
            .st_crd_lne(
                bob,
                usd,
                Quantity::new(10_000_000),
                false,
                RATE as u32,
                WEEK_SECS,
            )
            .get()?;
        Wrapper::push_from(&chain, bob)
            .path_pay(
                vec![hop(alice, usd)],
                Quantity::new(SRC_PRINCIPAL),
                Quantity::new(SRC_PRINCIPAL),
                0,
            )
            .get()?;

        chain.start_block_after(Seconds::new(i64::from(WEEK_SECS) + 86_400).into());
        let src_face = exp(&chain, alice, bob, usd);
        let src_interest = src_face - SRC_PRINCIPAL;
        assert!(src_interest > 0, "source already past grace");

        Wrapper::push_from(&chain, peter)
            .st_crd_lne(
                bob,
                usd,
                Quantity::new(10_000_000),
                false,
                RATE as u32,
                WEEK_SECS,
            )
            .get()?;
        Wrapper::push_from(&chain, peter)
            .st_glb_buy(usd, Quantity::new(0), 0, Quantity::new(u64::MAX), never())
            .get()?;
        Wrapper::push_from(&chain, bob)
            .st_crd_lne(peter, usd, Quantity::new(0), false, 0, 0)
            .get()?;
        Wrapper::push_from(&chain, alice)
            .sell_claim(
                peter,
                bob,
                usd,
                Quantity::new(src_interest),
                Quantity::new(0),
            )
            .get()?;

        let dest = Obligation::get_by_interest_rate(peter, bob, usd, RATE).expect("dest claim");
        assert_eq!(dest.remaining_principal.value, 0);
        assert_eq!(dest.accrued_interest.value, src_interest);
        let cycle = PairCycle::get(peter, bob, usd).expect("posted grace row");
        assert_eq!(
            cycle.cycle_started_at.seconds, 0,
            "interest-only aged sale must not open dest posted grace"
        );

        Wrapper::push_from(&chain, bob)
            .path_pay(
                vec![hop(peter, usd)],
                Quantity::new(500_000),
                Quantity::new(500_000),
                0,
            )
            .get()?;
        let cycle = PairCycle::get(peter, bob, usd).expect("posted grace row");
        assert_eq!(
            cycle.cycle_started_at.seconds, 0,
            "draw onto interest-only dest must not open posted grace"
        );

        let face = exp(&chain, peter, bob, usd);
        chain.start_block_after(Seconds::new(86_400).into());
        assert!(
            exp(&chain, peter, bob, usd) > face,
            "dest must compound; posted grace must not have started"
        );
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
            .st_crd_lne(alice, usd, Quantity::new(10_000), false, 0, 0)
            .get()?;
        Wrapper::push_from(&chain, steve)
            .st_crd_lne(gary, usd, Quantity::new(10_000), false, 0, 0)
            .get()?;
        Wrapper::push_from(&chain, gary)
            .st_crd_lne(bob, usd, Quantity::new(10_000), false, 0, 0)
            .get()?;
        Wrapper::push_from(&chain, gary)
            .st_glb_fwd(
                usd,
                Quantity::new(0),
                PPM_SCALE * 5 / 100,
                PPM_SCALE,
                never(),
                true,
            )
            .get()?;
        Wrapper::push_from(&chain, gary)
            .st_glb_buy(usd, Quantity::new(0), 0, Quantity::new(u64::MAX), never())
            .get()?;

        Wrapper::push_from(&chain, alice)
            .path_pay(
                vec![hop(gary, usd), hop(steve, usd)],
                Quantity::new(1_000),
                Quantity::new(950),
                0,
            )
            .get()?;
        assert_eq!(exp(&chain, steve, gary, usd), 950);

        Wrapper::push_from(&chain, bob)
            .deposit(carol, usd, Quantity::new(1_000), 0, 0)
            .get()?;
        Wrapper::push_from(&chain, bob)
            .st_crd_lne(gary, usd, Quantity::new(0), false, 0, 0)
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
            .st_crd_lne(a, usd, Quantity::new(10_000), false, 0, 0)
            .get()?;
        Wrapper::push_from(&chain, c)
            .st_crd_lne(b, usd, Quantity::new(10_000), false, 0, 0)
            .get()?;
        Wrapper::push_from(&chain, b)
            .st_glb_fwd(usd, Quantity::new(0), 0, PPM_SCALE, never(), true)
            .get()?;

        Wrapper::push_from(&chain, a)
            .path_pay(
                vec![hop(b, usd), hop(c, usd)],
                Quantity::new(1_000),
                Quantity::new(1_000),
                0,
            )
            .get()?;
        assert_eq!(exp(&chain, b, a, usd), 1_000);
        assert_eq!(exp(&chain, c, b, usd), 1_000);

        Wrapper::push_from(&chain, c)
            .path_pay(
                vec![hop(b, usd), hop(a, usd)],
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
            .st_crd_lne(alice, usd, Quantity::new(10_000), false, 0, 0)
            .get()?;
        Wrapper::push_from(&chain, steve)
            .st_crd_lne(gary, usd, Quantity::new(10_000), false, 0, 0)
            .get()?;
        Wrapper::push_from(&chain, gary)
            .st_glb_fwd(usd, Quantity::new(0), 0, PPM_SCALE, never(), true)
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
                vec![hop(gary, usd), hop(steve, usd)],
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
            .st_crd_lne(mitchell, aud, 50_0000.into(), false, 0, 0)
            .get()?;
        Wrapper::push_from(&chain, cafe)
            .st_crd_lne(john, aud, 50_0000.into(), false, 0, 0)
            .get()?;
        Wrapper::push_from(&chain, john)
            .st_crd_lne(cafe, aud, 0.into(), false, 0, 0)
            .get()?;
        Wrapper::push_from(&chain, john)
            .st_fwd_ofr(cafe, aud, 0.into(), 0, PPM_SCALE, never(), false)
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
            .pay_inv(vec![hop(john, aud), hop(cafe, aud)], 20_0000.into(), id)
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
            .st_crd_lne(mitchell, aud, 50_0000.into(), false, 0, 0)
            .get()?;
        Wrapper::push_from(&chain, cafe)
            .st_crd_lne(john, aud, 50_0000.into(), false, 0, 0)
            .get()?;
        Wrapper::push_from(&chain, john)
            .st_crd_lne(cafe, aud, 0.into(), false, 0, 0)
            .get()?;
        Wrapper::push_from(&chain, john)
            .st_fwd_ofr(
                cafe,
                aud,
                0.into(),
                PPM_SCALE / 100,
                PPM_SCALE,
                never(),
                false,
            )
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
            .pay_inv(vec![hop(john, aud), hop(cafe, aud)], 20_0000.into(), id)
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
            .st_crd_lne(mitchell, aud, 50_0000.into(), false, 0, 0)
            .get()?;
        Wrapper::push_from(&chain, cafe)
            .st_crd_lne(john, aud, 50_0000.into(), false, 0, 0)
            .get()?;
        Wrapper::push_from(&chain, john)
            .st_crd_lne(cafe, aud, 0.into(), false, 0, 0)
            .get()?;
        Wrapper::push_from(&chain, john)
            .st_fwd_ofr(cafe, aud, 0.into(), 0, PPM_SCALE, never(), false)
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
            vec![hop(john, aud), hop(cafe, aud)],
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
            .st_crd_lne(alice, aud, Quantity::new(10_000), false, 0, 0)
            .get()?;
        Wrapper::push_from(&chain, steve)
            .st_crd_lne(gary, usd, Quantity::new(10_000), false, 0, 0)
            .get()?;
        Wrapper::push_from(&chain, gary)
            .st_glb_fwd(usd, Quantity::new(0), 0, PPM_SCALE, never(), true)
            .get()?;
        Wrapper::push_from(&chain, gary)
            .st_fx_ofr(
                aud,
                usd,
                true,
                Quantity::new(0),
                RATE_SCALE * 70 / 100,
                0,
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
            vec![hop(gary, aud), hop(steve, usd)],
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
            .st_crd_lne(alice, usd, Quantity::new(10_000), false, 0, 0)
            .get()?;
        Wrapper::push_from(&chain, steve)
            .st_crd_lne(gary, usd, Quantity::new(10_000), false, 0, 0)
            .get()?;
        Wrapper::push_from(&chain, gary)
            .st_glb_fwd(usd, Quantity::new(0), 0, PPM_SCALE, never(), true)
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
                vec![hop(gary, usd)],
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
                vec![hop(steve, usd)],
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
            .st_crd_lne(alice, usd, Quantity::new(10_000), false, 0, 0)
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
                vec![hop(steve, usd)],
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
            .st_crd_lne(alice, usd, Quantity::new(10_000), false, 0, 0)
            .get()?;
        Wrapper::push_from(&chain, alice)
            .path_pay(
                vec![hop(bob, usd)],
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
            .deposit(alice, usd, Quantity::new(1_000), 0, id)
            .get()
            .is_err());

        Wrapper::push_from(&chain, bob)
            .deposit(alice, usd, Quantity::new(1_000), 0, id)
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
            .deposit(alice, usd, Quantity::new(50), 0, id)
            .get()
            .is_err());
        Ok(())
    }

    /// Editing a depleting line (APR / limit) must not refill spent remaining.
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
            .st_crd_lne(alice, usd, Quantity::new(100), true, 0, 0)
            .get()?;
        Wrapper::push_from(&chain, alice)
            .path_pay(vec![hop(bob, usd)], Quantity::new(60), Quantity::new(60), 0)
            .get()?;
        assert_eq!(CreditLine::get_assert(bob, alice, usd).remaining.value, 40);

        Wrapper::push_from(&chain, bob)
            .st_crd_lne(alice, usd, Quantity::new(100), true, 10_000, 0)
            .get()?;
        assert_eq!(
            CreditLine::get_assert(bob, alice, usd).remaining.value,
            40,
            "test_want_deplete_edit_does_not_refill_remaining: APR-only upsert reset remaining \
             to the limit; spent remaining must stay 40"
        );

        Wrapper::push_from(&chain, bob)
            .st_crd_lne(alice, usd, Quantity::new(200), true, 10_000, 0)
            .get()?;
        assert_eq!(
            CreditLine::get_assert(bob, alice, usd).remaining.value,
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
            .st_crd_lne(alice, usd, Quantity::new(100), true, 0, 0)
            .get()?;
        Wrapper::push_from(&chain, alice)
            .path_pay(vec![hop(bob, usd)], Quantity::new(60), Quantity::new(60), 0)
            .get()?;
        assert_eq!(CreditLine::get_assert(bob, alice, usd).remaining.value, 40);

        Wrapper::push_from(&chain, bob)
            .st_crd_lne(alice, usd, Quantity::new(100), false, 0, 0)
            .get()?;
        Wrapper::push_from(&chain, bob)
            .st_crd_lne(alice, usd, Quantity::new(100), true, 0, 0)
            .get()?;
        assert_eq!(
            CreditLine::get_assert(bob, alice, usd).remaining.value,
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
            .st_crd_lne(alice, usd, Quantity::new(100), true, 0, 0)
            .get()?;
        Wrapper::push_from(&chain, alice)
            .path_pay(
                vec![hop(bob, usd)],
                Quantity::new(100),
                Quantity::new(100),
                0,
            )
            .get()?;
        assert_eq!(CreditLine::get_assert(bob, alice, usd).remaining.value, 0);

        Wrapper::push_from(&chain, bob)
            .st_crd_lne(alice, usd, Quantity::new(100), false, 0, 0)
            .get()?;
        Wrapper::push_from(&chain, bob)
            .st_crd_lne(alice, usd, Quantity::new(100), true, 0, 0)
            .get()?;
        assert_eq!(
            CreditLine::get_assert(bob, alice, usd).remaining.value,
            0,
            "toggling deplete off then on refilled a fully spent remaining"
        );

        Wrapper::push_from(&chain, bob)
            .deposit(alice, usd, Quantity::new(100), 0, 0)
            .get()?;
        let over = Wrapper::push_from(&chain, alice)
            .path_pay(vec![hop(bob, usd)], Quantity::new(1), Quantity::new(1), 0)
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
            .st_crd_lne(alice, usd, Quantity::new(100), false, 0, 0)
            .get()?;
        let line = CreditLine::get_assert(bob, alice, usd);
        assert!(!line.deplete_on_debit);
        assert_eq!(line.remaining.value, 100);

        Wrapper::push_from(&chain, bob)
            .st_crd_lne(alice, usd, Quantity::new(200), false, 0, 0)
            .get()?;
        assert_eq!(CreditLine::get_assert(bob, alice, usd).remaining.value, 200);

        Wrapper::push_from(&chain, bob)
            .st_crd_lne(alice, usd, Quantity::new(200), true, 0, 0)
            .get()?;
        assert_eq!(CreditLine::get_assert(bob, alice, usd).remaining.value, 200);

        Wrapper::push_from(&chain, alice)
            .path_pay(
                vec![hop(bob, usd)],
                Quantity::new(200),
                Quantity::new(200),
                0,
            )
            .get()?;
        assert_eq!(exp(&chain, bob, alice, usd), 200);
        assert_eq!(CreditLine::get_assert(bob, alice, usd).remaining.value, 0);

        Wrapper::push_from(&chain, bob)
            .deposit(alice, usd, Quantity::new(200), 0, 0)
            .get()?;
        assert_eq!(exp(&chain, bob, alice, usd), 0);
        let over = Wrapper::push_from(&chain, alice)
            .path_pay(vec![hop(bob, usd)], Quantity::new(1), Quantity::new(1), 0)
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
            .st_crd_lne(alice, aud, Quantity::new(10_000), false, 0, 0)
            .get()?;
        Wrapper::push_from(&chain, steve)
            .st_crd_lne(gary, usd, Quantity::new(10_000), false, 0, 0)
            .get()?;
        Wrapper::push_from(&chain, gary)
            .st_fx_ofr(
                aud,
                usd,
                true,
                Quantity::new(0),
                RATE_SCALE * 70 / 100,
                0,
                Quantity::new(u64::MAX),
                never(),
            )
            .get()?;
        Wrapper::push_from(&chain, gary)
            .st_glb_fwd(usd, Quantity::new(0), 0, PPM_SCALE, never(), true)
            .get()?;
        Wrapper::push_from(&chain, gary)
            .deposit(alice, aud, Quantity::new(1_000), 0, 0)
            .get()?;

        Wrapper::push_from(&chain, alice)
            .path_pay(
                vec![hop(gary, aud), hop(steve, usd)],
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

    /// Principal added during grace is not back-dated to cycle start. Lost
    /// grace compounds from the last principal change.
    #[psibase::test_case(packages("Banx"))]
    fn test_want_grace_extra_draw_from_last_change(
        chain: psibase::Chain,
    ) -> Result<(), psibase::Error> {
        Wrapper::push(&chain).init().get()?;
        let alice = account!("alice");
        let bob = account!("bob");
        chain.new_account(alice).unwrap();
        chain.new_account(bob).unwrap();
        let usd = Asset::get_by_symbol_assert(account!("usd")).id;

        Wrapper::push_from(&chain, bob)
            .st_crd_lne(
                alice,
                usd,
                Quantity::new(10_000_000),
                false,
                100_000,
                WEEK_SECS,
            )
            .get()?;
        Wrapper::push_from(&chain, alice)
            .path_pay(
                vec![hop(bob, usd)],
                Quantity::new(1_000_000),
                Quantity::new(1_000_000),
                0,
            )
            .get()?;

        chain.start_block_after(Seconds::new(3 * 86_400).into());
        Wrapper::push_from(&chain, alice)
            .path_pay(
                vec![hop(bob, usd)],
                Quantity::new(1_000_000),
                Quantity::new(1_000_000),
                0,
            )
            .get()?;

        chain.start_block_after(Seconds::new(5 * 86_400).into());
        let want = compound_amount(2_000_000, 100_000, 5 * SECONDS_PER_DAY as u64);
        let got = exp(&chain, bob, alice, usd);
        assert_eq!(
            got, want,
            "test_want_grace_extra_draw_from_last_change: extra 1M drawn on day 3; \
             day-8 exposure should be 2M compounded 5 days from that draw ({want}), \
             not 8 days from origination ({got})"
        );
        Ok(())
    }

    /// Partial repay during grace: remaining principal compounds from that
    /// repay, not from origination.
    #[psibase::test_case(packages("Banx"))]
    fn test_want_grace_partial_repay_from_last_change(
        chain: psibase::Chain,
    ) -> Result<(), psibase::Error> {
        Wrapper::push(&chain).init().get()?;
        let alice = account!("alice");
        let bob = account!("bob");
        chain.new_account(alice).unwrap();
        chain.new_account(bob).unwrap();
        let usd = Asset::get_by_symbol_assert(account!("usd")).id;

        Wrapper::push_from(&chain, bob)
            .st_crd_lne(
                alice,
                usd,
                Quantity::new(10_000_000),
                false,
                100_000,
                WEEK_SECS,
            )
            .get()?;
        Wrapper::push_from(&chain, alice)
            .path_pay(
                vec![hop(bob, usd)],
                Quantity::new(1_000_000),
                Quantity::new(1_000_000),
                0,
            )
            .get()?;

        chain.start_block_after(Seconds::new(3 * 86_400).into());
        Wrapper::push_from(&chain, bob)
            .deposit(alice, usd, Quantity::new(400_000), 0, 0)
            .get()?;
        assert_eq!(exp(&chain, bob, alice, usd), 600_000);

        chain.start_block_after(Seconds::new(5 * 86_400).into());
        let want = compound_amount(600_000, 100_000, 5 * SECONDS_PER_DAY as u64);
        let got = exp(&chain, bob, alice, usd);
        assert_eq!(
            got, want,
            "test_want_grace_partial_repay_from_last_change: repaid 400k on day 3; \
             day-8 exposure should be 600k compounded 5 days from the repay ({want}), \
             not 8 days from origination ({got})"
        );
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
                0,
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
            .st_crd_lne(alice, usd, Quantity::new(1_000_000), false, 0, 0)
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
            .st_crd_lne(alice, usd, Quantity::new(100_000), false, 0, 0)
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
            .st_crd_lne(alice, usd, Quantity::new(100_000), false, 0, 0)
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
            .st_crd_lne(alice, usd, Quantity::new(100_000), true, 0, 0)
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
        assert_eq!(CreditLine::get_assert(bob, alice, usd).remaining.value, 0);
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
            .st_crd_lne(bob, usd, 10_000.into(), false, 0, 0)
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
        let grace = 7 * SECONDS_PER_DAY as u32;

        Wrapper::push_from(&chain, alice)
            .cr_invite(invite_id, invite_payload(1), 1, usd, limit, false, 0, grace)
            .get()?;

        let stored = BanxInvite::get_assert(invite_id);
        assert_eq!(stored.inviter, alice);
        assert_eq!(stored.asset_id, usd);
        assert_eq!(stored.limit.value, limit.value);
        assert_eq!(BanxInvite::list_by_inviter(alice).len(), 1);
        assert!(CreditLine::get(alice, bob, usd).is_none());

        Wrapper::push_from(&chain, psibase::services::invite::Wrapper::SERVICE)
            .onInvAccept(invite_id, bob)
            .get()?;

        let line = CreditLine::get_assert(alice, bob, usd);
        assert_eq!(line.limit.value, limit.value);
        assert!(!line.deplete_on_debit);
        assert_eq!(line.interest_rate, 0);
        let stored = BanxInvite::get_assert(invite_id);
        assert_eq!(stored.claimed_by, Some(bob));
        assert_eq!(BanxInvite::list_by_inviter(alice).len(), 1);

        Wrapper::push_from(&chain, psibase::services::invite::Wrapper::SERVICE)
            .onInvAccept(invite_id, bob)
            .get()?;
        assert_eq!(
            CreditLine::get_assert(alice, bob, usd).limit.value,
            limit.value
        );
        assert_eq!(BanxInvite::get_assert(invite_id).claimed_by, Some(bob));

        Wrapper::push_from(&chain, psibase::services::invite::Wrapper::SERVICE)
            .onInvAccept(invite_id, carol)
            .get()?;
        assert!(CreditLine::get(alice, carol, usd).is_none());
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
            .st_crd_lne(bob, usd, Quantity::new(1), true, 12_000, 0)
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
                0,
                0,
            )
            .get()?;

        Wrapper::push_from(&chain, psibase::services::invite::Wrapper::SERVICE)
            .onInvAccept(invite_id, bob)
            .get()?;

        let line = CreditLine::get_assert(alice, bob, usd);
        assert_eq!(line.limit.value, 1);
        assert!(line.deplete_on_debit);
        assert_eq!(line.interest_rate, 12_000);
        assert_eq!(BanxInvite::get_assert(invite_id).claimed_by, Some(bob));

        Wrapper::push_from(&chain, psibase::services::invite::Wrapper::SERVICE)
            .onInvAccept(invite_id, carol)
            .get()?;
        assert!(CreditLine::get(alice, carol, usd).is_none());
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
            .cr_invite(
                1,
                invite_payload(5),
                2,
                usd,
                Quantity::new(5_000),
                false,
                0,
                0,
            )
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
                0,
                0,
            )
            .get()?;

        let result = Wrapper::push_from(&chain, alice)
            .onInvAccept(invite_id, bob)
            .get();
        assert!(result.is_err());
        assert!(CreditLine::get(alice, bob, usd).is_none());

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
                0,
                0,
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
        assert!(CreditLine::get(alice, bob, usd).is_none());

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
                0,
                0,
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
        assert_eq!(CreditLine::get_assert(alice, bob, usd).limit.value, 5_000);

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
            .st_bk_ath(bob, usd, Quantity::new(10_000), 0, 0, never())
            .get()?;
        let auth = BookAuth::get_assert(alice, bob, usd);
        assert_eq!(auth.remaining.value, 10_000);
        assert_eq!(auth.max_interest_rate, 0);
        assert_eq!(auth.min_interest_rate, 0);

        Wrapper::push_from(&chain, bob)
            .book(alice, usd, Quantity::new(3_000), 0, "dinner".into())
            .get()?;
        assert_eq!(exp(&chain, bob, alice, usd), 3_000);
        assert_eq!(BookAuth::get_assert(alice, bob, usd).remaining.value, 7_000);

        Ok(())
    }

    #[psibase::test_case(packages("Banx"))]
    fn test_book_auth_caps_amount_and_apr(chain: psibase::Chain) -> Result<(), psibase::Error> {
        Wrapper::push(&chain).init().get()?;
        let alice = account!("alice");
        let bob = account!("bob");
        chain.new_account(alice).unwrap();
        chain.new_account(bob).unwrap();
        let usd = Asset::get_by_symbol_assert(account!("usd")).id;

        Wrapper::push_from(&chain, alice)
            .st_bk_ath(bob, usd, Quantity::new(1_000), 0, 0, never())
            .get()?;

        assert!(Wrapper::push_from(&chain, bob)
            .book(alice, usd, Quantity::new(1_001), 0, "".into())
            .get()
            .is_err());
        assert!(Wrapper::push_from(&chain, bob)
            .book(alice, usd, Quantity::new(100), 1, "".into())
            .get()
            .is_err());
        assert!(Wrapper::push_from(&chain, bob)
            .book(alice, usd, Quantity::new(100), -1, "".into())
            .get()
            .is_err());
        assert!(Wrapper::push_from(&chain, alice)
            .book(alice, usd, Quantity::new(100), 0, "".into())
            .get()
            .is_err());

        Wrapper::push_from(&chain, bob)
            .book(alice, usd, Quantity::new(1_000), 0, "".into())
            .get()?;
        assert_eq!(exp(&chain, bob, alice, usd), 1_000);
        assert_eq!(BookAuth::get_assert(alice, bob, usd).remaining.value, 0);

        Wrapper::push_from(&chain, alice)
            .st_bk_ath(bob, usd, Quantity::new(500), 0, 0, never())
            .get()?;
        assert_eq!(BookAuth::get_assert(alice, bob, usd).remaining.value, 500);

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
            .st_bk_ath(bob, usd, Quantity::new(5_000), 12_000, 0, never())
            .get()?;
        Wrapper::push_from(&chain, bob)
            .book(alice, usd, Quantity::new(100), 12_000, "".into())
            .get()?;
        assert_eq!(exp(&chain, bob, alice, usd), 100);

        Wrapper::push_from(&chain, alice)
            .rm_bk_ath(bob, usd)
            .get()?;
        assert!(BookAuth::get(alice, bob, usd).is_none());
        assert!(Wrapper::push_from(&chain, bob)
            .book(alice, usd, Quantity::new(100), 0, "".into())
            .get()
            .is_err());

        Wrapper::push_from(&chain, alice)
            .st_bk_ath(
                bob,
                usd,
                Quantity::new(5_000),
                0,
                0,
                TimePointSec { seconds: 1 },
            )
            .get()?;
        assert!(Wrapper::push_from(&chain, bob)
            .book(alice, usd, Quantity::new(100), 0, "".into())
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
            .deposit(alice, usd, Quantity::new(2_000), 0, 0)
            .get()?;
        assert_eq!(exp(&chain, alice, bob, usd), 2_000);

        Wrapper::push_from(&chain, alice)
            .st_bk_ath(bob, usd, Quantity::new(5_000), 0, 0, never())
            .get()?;
        Wrapper::push_from(&chain, bob)
            .book(alice, usd, Quantity::new(2_000), 0, "tab".into())
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
            .deposit(alice, usd, Quantity::new(1_000), 0, 0)
            .get()?;
        Wrapper::push_from(&chain, peter)
            .st_crd_lne(bob, usd, Quantity::new(1_000), false, 0, 0)
            .get()?;
        Wrapper::push_from(&chain, bob)
            .st_crd_lne(peter, usd, Quantity::new(0), false, 0, 0)
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
            .st_crd_lne(alice, usd, Quantity::new(1_000), false, 0, 0)
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

    fn allow_book(
        chain: &psibase::Chain,
        debtor: AccountNumber,
        creditor: AccountNumber,
        asset: u16,
        min_interest_rate: i32,
    ) {
        Wrapper::push_from(chain, debtor)
            .st_bk_ath(
                creditor,
                asset,
                Quantity::new(u64::MAX),
                0,
                min_interest_rate,
                never(),
            )
            .get()
            .unwrap();
    }

    /// Creditor-signed −10% decays the claim. One untouched day on 1_000_000 is 999_727.
    #[psibase::test_case(packages("Banx"))]
    fn test_negative_rate_decays_booked_claim(chain: psibase::Chain) -> Result<(), psibase::Error> {
        Wrapper::push(&chain).init().get()?;
        let alice = account!("alice");
        let bob = account!("bob");
        chain.new_account(alice).unwrap();
        chain.new_account(bob).unwrap();
        let usd = Asset::get_by_symbol_assert(account!("usd")).id;
        allow_book(&chain, alice, bob, usd, -100_000);

        Wrapper::push_from(&chain, bob)
            .book(alice, usd, Quantity::new(1_000_000), -100_000, "".into())
            .get()?;
        assert_eq!(exp(&chain, bob, alice, usd), 1_000_000);

        chain.start_block_after(Seconds::new(SECONDS_PER_DAY as i64).into());
        assert_eq!(exp(&chain, bob, alice, usd), 999_727);
        Wrapper::push_from(&chain, bob)
            .net(alice, usd, Quantity::new(0))
            .get()?;
        let row = Obligation::get_by_interest_rate(bob, alice, usd, -100_000).unwrap();
        assert_eq!(row.remaining_principal.value, 999_727);
        assert_eq!(row.accrued_interest.value, 0);
        Ok(())
    }

    /// A touch that adds no unit must keep the epoch. One unit of 10% on
    /// 1_000_000 needs 316 seconds, so a net every 5 minutes used to finish
    /// the day still at 1_000_000. The epoch stays until a unit is earned,
    /// which is every 10 minutes here. Each of those 144 units starts a new
    /// epoch, so the day bills 144, not the 273 a single untouched evaluation
    /// would.
    #[psibase::test_case(packages("Banx"))]
    fn test_noop_net_keeps_unbilled_interest(chain: psibase::Chain) -> Result<(), psibase::Error> {
        Wrapper::push(&chain).init().get()?;
        let alice = account!("alice");
        let bob = account!("bob");
        chain.new_account(alice).unwrap();
        chain.new_account(bob).unwrap();
        let usd = Asset::get_by_symbol_assert(account!("usd")).id;
        Wrapper::push_from(&chain, alice)
            .deposit(bob, usd, Quantity::new(1_000_000), 100_000, 0)
            .get()?;

        for _ in 0..288 {
            chain.start_block_after(Seconds::new(300).into());
            Wrapper::push_from(&chain, alice)
                .net(bob, usd, Quantity::new(0))
                .get()?;
        }
        assert_eq!(exp(&chain, bob, alice, usd), 1_000_144);
        Ok(())
    }

    /// The same checkpoint used to freeze decay. 3_650 at −10% loses 1 in an
    /// untouched day and used to lose nothing across two 12-hour nets.
    #[psibase::test_case(packages("Banx"))]
    fn test_noop_net_keeps_unbilled_decay(chain: psibase::Chain) -> Result<(), psibase::Error> {
        Wrapper::push(&chain).init().get()?;
        let alice = account!("alice");
        let bob = account!("bob");
        chain.new_account(alice).unwrap();
        chain.new_account(bob).unwrap();
        let usd = Asset::get_by_symbol_assert(account!("usd")).id;
        allow_book(&chain, alice, bob, usd, -100_000);
        Wrapper::push_from(&chain, bob)
            .book(alice, usd, Quantity::new(3_650), -100_000, "".into())
            .get()?;

        let half = Seconds::new(12 * 60 * 60);
        chain.start_block_after(half.into());
        Wrapper::push_from(&chain, alice)
            .net(bob, usd, Quantity::new(0))
            .get()?;
        assert_eq!(exp(&chain, bob, alice, usd), 3_650);
        chain.start_block_after(half.into());
        Wrapper::push_from(&chain, alice)
            .net(bob, usd, Quantity::new(0))
            .get()?;
        assert_eq!(exp(&chain, bob, alice, usd), 3_649);
        Ok(())
    }

    /// One day of interest on a near-max principal fills the u64 cap and splits
    /// it across principal and accrued. Another unit must fail, and the row
    /// must still forgive.
    #[psibase::test_case(packages("Banx"))]
    fn test_saturated_obligation_rejects_top_up_and_forgives(
        chain: psibase::Chain,
    ) -> Result<(), psibase::Error> {
        Wrapper::push(&chain).init().get()?;
        let alice = account!("alice");
        let bob = account!("bob");
        chain.new_account(alice).unwrap();
        chain.new_account(bob).unwrap();
        let usd = Asset::get_by_symbol_assert(account!("usd")).id;

        let principal = u64::MAX - 5;
        Wrapper::push_from(&chain, alice)
            .deposit(bob, usd, Quantity::new(principal), 1, 0)
            .get()?;

        chain.start_block_after(Seconds::new(SECONDS_PER_DAY as i64).into());
        Wrapper::push_from(&chain, bob)
            .net(alice, usd, Quantity::new(0))
            .get()?;
        assert_eq!(exp(&chain, bob, alice, usd), u64::MAX);
        let row = Obligation::get_by_interest_rate(bob, alice, usd, 1).unwrap();
        assert!(row.remaining_principal.value < u64::MAX);
        assert!(row.accrued_interest.value > 0);
        assert_eq!(
            row.remaining_principal
                .value
                .saturating_add(row.accrued_interest.value),
            u64::MAX
        );

        let topped = Wrapper::push_from(&chain, alice)
            .deposit(bob, usd, Quantity::new(1), 1, 0)
            .get();
        assert!(topped.is_err());
        assert_eq!(exp(&chain, bob, alice, usd), u64::MAX);

        Wrapper::push_from(&chain, bob)
            .forgive(alice, usd, Quantity::new(u64::MAX))
            .get()?;
        assert_eq!(exp(&chain, bob, alice, usd), 0);
        Ok(())
    }

    /// Two buckets that each fit can sum past `u64::MAX` after one day.
    /// The pair total saturates, so forgive still reduces it. The unit that
    /// does not fit in one settle is cleared by the next one.
    #[psibase::test_case(packages("Banx"))]
    fn test_pair_exposure_past_cap_can_still_be_forgiven(
        chain: psibase::Chain,
    ) -> Result<(), psibase::Error> {
        Wrapper::push(&chain).init().get()?;
        let alice = account!("alice");
        let bob = account!("bob");
        chain.new_account(alice).unwrap();
        chain.new_account(bob).unwrap();
        let usd = Asset::get_by_symbol_assert(account!("usd")).id;

        // 0% stays put. 10% on 4_000 grows by 1 in one day, so the pair is
        // u64::MAX + 1 and no longer fits in one Quantity.
        let low = u64::MAX - 4_000;
        Wrapper::push_from(&chain, alice)
            .deposit(bob, usd, Quantity::new(low), 0, 0)
            .get()?;
        Wrapper::push_from(&chain, alice)
            .deposit(bob, usd, Quantity::new(4_000), 100_000, 0)
            .get()?;
        assert_eq!(exp(&chain, bob, alice, usd), u64::MAX);

        chain.start_block_after(Seconds::new(SECONDS_PER_DAY as i64).into());
        assert_eq!(exp(&chain, bob, alice, usd), u64::MAX);

        Wrapper::push_from(&chain, bob)
            .forgive(alice, usd, Quantity::new(u64::MAX))
            .get()?;
        assert_eq!(exp(&chain, bob, alice, usd), 1);

        Wrapper::push_from(&chain, bob)
            .forgive(alice, usd, Quantity::new(1))
            .get()?;
        assert_eq!(exp(&chain, bob, alice, usd), 0);
        Ok(())
    }

    /// −1% on 10_000 raw is a fraction of a unit per day. Truncate that fee.
    /// One evaluation of the day and 24 hourly accruals must charge the same amount.
    #[psibase::test_case(packages("Banx"))]
    fn test_negative_rate_fractional_day_fee_matches_hourly(
        chain: psibase::Chain,
    ) -> Result<(), psibase::Error> {
        const PRINCIPAL: u64 = 10_000;
        const RATE: i32 = -10_000;
        let day = SECONDS_PER_DAY as u64;
        let one_day_math = compound_amount(PRINCIPAL, RATE, day);
        let mut hourly_math = PRINCIPAL;
        for _ in 0..24 {
            hourly_math = compound_amount(hourly_math, RATE, 3600);
        }

        Wrapper::push(&chain).init().get()?;
        let alice = account!("alice");
        let bob = account!("bob");
        chain.new_account(alice).unwrap();
        chain.new_account(bob).unwrap();
        let usd = Asset::get_by_symbol_assert(account!("usd")).id;
        let aud = Asset::get_by_symbol_assert(account!("aud")).id;
        allow_book(&chain, alice, bob, usd, -10_000);
        allow_book(&chain, alice, bob, aud, -10_000);
        Wrapper::push_from(&chain, bob)
            .book(alice, usd, Quantity::new(PRINCIPAL), RATE, "".into())
            .get()?;
        Wrapper::push_from(&chain, bob)
            .book(alice, aud, Quantity::new(PRINCIPAL), RATE, "".into())
            .get()?;

        for _ in 0..24 {
            chain.start_block_after(Seconds::new(3600).into());
            Wrapper::push_from(&chain, bob)
                .net(alice, usd, Quantity::new(0))
                .get()?;
        }

        let on_chain_hourly = exp(&chain, bob, alice, usd);
        let on_chain_untouched = exp(&chain, bob, alice, aud);
        assert!(
            on_chain_hourly == on_chain_untouched && on_chain_untouched == PRINCIPAL,
            "fractional −1% day fee charged as a whole unit: compound hourly={hourly_math}, compound one-day={one_day_math}, on-chain hourly={on_chain_hourly}, on-chain untouched={on_chain_untouched}"
        );
        Ok(())
    }

    /// A 0% deposit stays its own bucket. Reducing the claim retires 0% before −10%.
    #[psibase::test_case(packages("Banx"))]
    fn test_negative_rate_reduced_after_zero(chain: psibase::Chain) -> Result<(), psibase::Error> {
        Wrapper::push(&chain).init().get()?;
        let alice = account!("alice");
        let bob = account!("bob");
        chain.new_account(alice).unwrap();
        chain.new_account(bob).unwrap();
        let usd = Asset::get_by_symbol_assert(account!("usd")).id;
        allow_book(&chain, alice, bob, usd, -10_000);

        Wrapper::push_from(&chain, bob)
            .book(alice, usd, Quantity::new(100), 0, "".into())
            .get()?;
        Wrapper::push_from(&chain, bob)
            .book(alice, usd, Quantity::new(100), -10_000, "".into())
            .get()?;
        Wrapper::push_from(&chain, alice)
            .deposit(bob, usd, Quantity::new(50), 0, 0)
            .get()?;
        assert_eq!(exp(&chain, bob, alice, usd), 250);
        assert_eq!(
            Obligation::get_by_interest_rate(bob, alice, usd, 0)
                .unwrap()
                .remaining_principal
                .value,
            150
        );
        assert_eq!(
            Obligation::get_by_interest_rate(bob, alice, usd, -10_000)
                .unwrap()
                .remaining_principal
                .value,
            100
        );

        Wrapper::push_from(&chain, bob)
            .forgive(alice, usd, Quantity::new(150))
            .get()?;
        assert!(Obligation::get_by_interest_rate(bob, alice, usd, 0).is_none());
        assert_eq!(
            Obligation::get_by_interest_rate(bob, alice, usd, -10_000)
                .unwrap()
                .remaining_principal
                .value,
            100
        );
        Ok(())
    }

    /// −100% on 1 raw unit is below one day's fee, so the claim stays until forgiven.
    #[psibase::test_case(packages("Banx"))]
    fn test_negative_rate_sub_unit_fee_keeps_claim(
        chain: psibase::Chain,
    ) -> Result<(), psibase::Error> {
        Wrapper::push(&chain).init().get()?;
        let alice = account!("alice");
        let bob = account!("bob");
        chain.new_account(alice).unwrap();
        chain.new_account(bob).unwrap();
        let usd = Asset::get_by_symbol_assert(account!("usd")).id;
        allow_book(&chain, alice, bob, usd, -1_000_000);

        Wrapper::push_from(&chain, bob)
            .book(alice, usd, Quantity::new(1), -1_000_000, "".into())
            .get()?;
        chain.start_block_after(Seconds::new(SECONDS_PER_DAY as i64).into());
        assert_eq!(exp(&chain, bob, alice, usd), 1);
        assert!(Obligation::get_by_interest_rate(bob, alice, usd, -1_000_000).is_some());
        Wrapper::push_from(&chain, bob)
            .forgive(alice, usd, Quantity::new(1))
            .get()?;
        assert!(Obligation::get_by_interest_rate(bob, alice, usd, -1_000_000).is_none());
        Ok(())
    }

    /// A later top-up is not decayed for the interval before it arrived.
    #[psibase::test_case(packages("Banx"))]
    fn test_negative_rate_top_up_not_backdated(
        chain: psibase::Chain,
    ) -> Result<(), psibase::Error> {
        Wrapper::push(&chain).init().get()?;
        let alice = account!("alice");
        let bob = account!("bob");
        chain.new_account(alice).unwrap();
        chain.new_account(bob).unwrap();
        let usd = Asset::get_by_symbol_assert(account!("usd")).id;
        allow_book(&chain, alice, bob, usd, -100_000);
        const RATE: i32 = -100_000;

        Wrapper::push_from(&chain, bob)
            .book(alice, usd, Quantity::new(1_000_000), RATE, "".into())
            .get()?;
        chain.start_block_after(Seconds::new(SECONDS_PER_DAY as i64).into());
        Wrapper::push_from(&chain, bob)
            .book(alice, usd, Quantity::new(1_000_000), RATE, "".into())
            .get()?;
        assert_eq!(exp(&chain, bob, alice, usd), 999_727 + 1_000_000);

        chain.start_block_after(Seconds::new(SECONDS_PER_DAY as i64).into());
        assert_eq!(
            exp(&chain, bob, alice, usd),
            compound_amount(999_727 + 1_000_000, RATE, SECONDS_PER_DAY as u64)
        );
        Ok(())
    }

    /// Grace hides the decay. After the window the whole elapsed time is charged.
    #[psibase::test_case(packages("Banx"))]
    fn test_negative_rate_paused_during_grace(chain: psibase::Chain) -> Result<(), psibase::Error> {
        Wrapper::push(&chain).init().get()?;
        let alice = account!("alice");
        let bob = account!("bob");
        chain.new_account(alice).unwrap();
        chain.new_account(bob).unwrap();
        let usd = Asset::get_by_symbol_assert(account!("usd")).id;
        Wrapper::push_from(&chain, bob)
            .st_crd_lne(alice, usd, Quantity::new(0), false, 0, 7 * 86_400)
            .get()?;
        allow_book(&chain, alice, bob, usd, -100_000);
        Wrapper::push_from(&chain, bob)
            .book(alice, usd, Quantity::new(1_000_000), -100_000, "".into())
            .get()?;

        chain.start_block_after(Seconds::new(SECONDS_PER_DAY as i64).into());
        assert_eq!(exp(&chain, bob, alice, usd), 1_000_000);

        chain.start_block_after(Seconds::new(7 * 86_400).into());
        assert_eq!(
            exp(&chain, bob, alice, usd),
            compound_amount(1_000_000, -100_000, 8 * SECONDS_PER_DAY as u64)
        );
        Ok(())
    }

    /// A floor of 0 with a ceiling of 0 is 0% only. Decay requires an explicit floor.
    #[psibase::test_case(packages("Banx"))]
    fn test_book_negative_rate_bounds(chain: psibase::Chain) -> Result<(), psibase::Error> {
        Wrapper::push(&chain).init().get()?;
        let alice = account!("alice");
        let bob = account!("bob");
        chain.new_account(alice).unwrap();
        chain.new_account(bob).unwrap();
        let usd = Asset::get_by_symbol_assert(account!("usd")).id;
        allow_book(&chain, alice, bob, usd, 0);

        assert!(Wrapper::push_from(&chain, bob)
            .book(alice, usd, Quantity::new(10), -1, "".into())
            .get()
            .is_err());
        assert!(Wrapper::push_from(&chain, bob)
            .book(alice, usd, Quantity::new(10), 1, "".into())
            .get()
            .is_err());
        Wrapper::push_from(&chain, bob)
            .book(alice, usd, Quantity::new(10), 0, "".into())
            .get()?;

        Wrapper::push_from(&chain, alice)
            .st_bk_ath(bob, usd, Quantity::new(u64::MAX), 0, -1_000_000, never())
            .get()?;
        assert!(Wrapper::push_from(&chain, bob)
            .book(alice, usd, Quantity::new(10), -1_000_001, "".into())
            .get()
            .is_err());
        assert!(Wrapper::push_from(&chain, bob)
            .book(alice, usd, Quantity::new(10), 1, "".into())
            .get()
            .is_err());
        Wrapper::push_from(&chain, bob)
            .book(alice, usd, Quantity::new(10), -1_000_000, "".into())
            .get()?;
        assert_eq!(
            Obligation::get_by_interest_rate(bob, alice, usd, -1_000_000)
                .unwrap()
                .interest_rate,
            -1_000_000
        );
        Ok(())
    }

    /// A 1-unit claim below one day's fee stays owed, so the pair stays occupied
    /// and a later claim does not open a fresh grace window.
    #[psibase::test_case(packages("Banx"))]
    fn test_negative_rate_dust_keeps_pair_occupied(
        chain: psibase::Chain,
    ) -> Result<(), psibase::Error> {
        Wrapper::push(&chain).init().get()?;
        let alice = account!("alice");
        let bob = account!("bob");
        chain.new_account(alice).unwrap();
        chain.new_account(bob).unwrap();
        let usd = Asset::get_by_symbol_assert(account!("usd")).id;
        const WEEK: u32 = 7 * 86_400;
        const POSITIVE: i32 = 100_000;

        Wrapper::push_from(&chain, bob)
            .st_crd_lne(alice, usd, Quantity::new(0), false, 0, WEEK)
            .get()?;
        Wrapper::push_from(&chain, alice)
            .st_bk_ath(
                bob,
                usd,
                Quantity::new(u64::MAX),
                POSITIVE as u32,
                -1_000_000,
                never(),
            )
            .get()?;
        Wrapper::push_from(&chain, bob)
            .book(alice, usd, Quantity::new(1), -1_000_000, "".into())
            .get()?;
        let opened = PairCycle::get(bob, alice, usd).expect("cycle opened on the decay");

        chain.start_block_after(Seconds::new(8 * SECONDS_PER_DAY as i64).into());
        assert_eq!(exp(&chain, bob, alice, usd), 1);
        assert!(Obligation::get_by_interest_rate(bob, alice, usd, -1_000_000).is_some());

        Wrapper::push_from(&chain, bob)
            .book(alice, usd, Quantity::new(1_000_000), POSITIVE, "".into())
            .get()?;
        assert!(Obligation::get_by_interest_rate(bob, alice, usd, -1_000_000).is_some());
        assert_eq!(
            Obligation::get_by_interest_rate(bob, alice, usd, POSITIVE)
                .unwrap()
                .remaining_principal
                .value,
            1_000_000
        );
        let cycle = PairCycle::get(bob, alice, usd).expect("cycle still open");
        assert_eq!(
            cycle.cycle_started_at.seconds,
            opened.cycle_started_at.seconds
        );
        assert_eq!(cycle.cycle_grace_seconds, WEEK);
        assert_eq!(exp(&chain, bob, alice, usd), 1_000_001);

        chain.start_block_after(Seconds::new(SECONDS_PER_DAY as i64).into());
        assert_eq!(
            exp(&chain, bob, alice, usd),
            1 + compound_amount(1_000_000, POSITIVE, SECONDS_PER_DAY as u64),
            "dust kept the expired cycle; the new claim was charged"
        );
        Ok(())
    }

    /// Topping up adds onto the unit that survived, and does not decay the new
    /// principal for the interval before it arrived.
    #[psibase::test_case(packages("Banx"))]
    fn test_negative_rate_top_up_keeps_surviving_unit(
        chain: psibase::Chain,
    ) -> Result<(), psibase::Error> {
        Wrapper::push(&chain).init().get()?;
        let alice = account!("alice");
        let bob = account!("bob");
        chain.new_account(alice).unwrap();
        chain.new_account(bob).unwrap();
        let usd = Asset::get_by_symbol_assert(account!("usd")).id;
        const WEEK: u32 = 7 * 86_400;
        const RATE: i32 = -1_000_000;

        Wrapper::push_from(&chain, bob)
            .st_crd_lne(alice, usd, Quantity::new(0), false, 0, WEEK)
            .get()?;
        allow_book(&chain, alice, bob, usd, RATE);
        Wrapper::push_from(&chain, bob)
            .book(alice, usd, Quantity::new(1), RATE, "".into())
            .get()?;
        let opened = PairCycle::get(bob, alice, usd).expect("cycle opened");

        chain.start_block_after(Seconds::new(8 * SECONDS_PER_DAY as i64).into());
        assert_eq!(exp(&chain, bob, alice, usd), 1);

        Wrapper::push_from(&chain, bob)
            .book(alice, usd, Quantity::new(1_000_000), RATE, "".into())
            .get()?;
        let row = Obligation::get_by_interest_rate(bob, alice, usd, RATE).unwrap();
        assert_eq!(row.remaining_principal.value, 1_000_001);
        assert_eq!(row.accrued_interest.value, 0);
        let cycle = PairCycle::get(bob, alice, usd).expect("cycle still open");
        assert_eq!(
            cycle.cycle_started_at.seconds,
            opened.cycle_started_at.seconds
        );
        assert_eq!(cycle.cycle_grace_seconds, WEEK);

        chain.start_block_after(Seconds::new(SECONDS_PER_DAY as i64).into());
        assert_eq!(
            exp(&chain, bob, alice, usd),
            compound_amount(1_000_001, RATE, SECONDS_PER_DAY as u64)
        );
        Ok(())
    }

    /// A 1-unit claim below one day's fee still occupies the destination, so a
    /// sale does not inherit the source grace window.
    #[psibase::test_case(packages("Banx"))]
    fn test_negative_rate_dust_blocks_transfer_grace(
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
        const WEEK: u32 = 7 * 86_400;
        const RATE: i32 = 100_000;

        allow_book(&chain, bob, peter, usd, -1_000_000);
        Wrapper::push_from(&chain, peter)
            .book(bob, usd, Quantity::new(1), -1_000_000, "".into())
            .get()?;
        chain.start_block_after(Seconds::new(SECONDS_PER_DAY as i64).into());
        assert_eq!(exp(&chain, peter, bob, usd), 1);
        assert!(Obligation::get_by_interest_rate(peter, bob, usd, -1_000_000).is_some());

        Wrapper::push_from(&chain, alice)
            .st_crd_lne(
                bob,
                usd,
                Quantity::new(10_000_000),
                false,
                RATE as u32,
                WEEK,
            )
            .get()?;
        Wrapper::push_from(&chain, bob)
            .path_pay(
                vec![hop(alice, usd)],
                Quantity::new(1_000_000),
                Quantity::new(1_000_000),
                0,
            )
            .get()?;
        assert_eq!(exp(&chain, alice, bob, usd), 1_000_000);

        Wrapper::push_from(&chain, peter)
            .st_crd_lne(bob, usd, Quantity::new(10_000_000), false, 0, 0)
            .get()?;
        Wrapper::push_from(&chain, peter)
            .st_glb_buy(usd, Quantity::new(0), 0, Quantity::new(u64::MAX), never())
            .get()?;
        Wrapper::push_from(&chain, bob)
            .st_crd_lne(peter, usd, Quantity::new(0), false, 0, 0)
            .get()?;
        Wrapper::push_from(&chain, alice)
            .sell_claim(peter, bob, usd, Quantity::new(1_000_000), Quantity::new(0))
            .get()?;

        assert_eq!(exp(&chain, alice, bob, usd), 0);
        assert_eq!(exp(&chain, peter, bob, usd), 1_000_001);
        assert!(Obligation::get_by_interest_rate(peter, bob, usd, -1_000_000).is_some());
        assert_eq!(
            PairCycle::get(peter, bob, usd)
                .map(|c| c.cycle_started_at.seconds)
                .unwrap_or(0),
            0
        );

        chain.start_block_after(Seconds::new(SECONDS_PER_DAY as i64).into());
        assert_eq!(
            exp(&chain, peter, bob, usd),
            1 + compound_amount(1_000_000, RATE, SECONDS_PER_DAY as u64),
            "destination was occupied, so the transferred claim was charged"
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
                PPM_SCALE,
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
            0,
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
            0,
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
            0,
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
            0,
            now,
            never(),
        );
        assert!(rejected.get().is_err());

        let over = Wrapper::push_from(&chain, alice)
            .st_pay_ath(
                bob,
                usd,
                Quantity::new(100),
                Quantity::new(100),
                PPM_SCALE + 1,
                100,
                now,
                never(),
            )
            .get()
            .expect_err("a rate above 100% is not a cap");
        assert!(
            over.to_string().contains("pay auth rate exceeds 100%"),
            "{over}"
        );
        Ok(())
    }

    /// The payee submits the hops. Hop 0 is a raw draw, so the stored cap
    /// has to cover that line whoever the creditor is. A 0% cap still pays
    /// a 0% line.
    #[psibase::test_case(packages("Banx"))]
    fn test_pay_auth_caps_first_hop_rate(chain: psibase::Chain) -> Result<(), psibase::Error> {
        Wrapper::push(&chain).init().get()?;
        let alice = account!("alice");
        let bob = account!("bob");
        let carol = account!("carol");
        chain.new_account(alice).unwrap();
        chain.new_account(bob).unwrap();
        chain.new_account(carol).unwrap();
        let usd = Asset::get_by_symbol_assert(account!("usd")).id;
        const START: i64 = 1_700_000_000;
        pin(&chain, START);

        Wrapper::push_from(&chain, bob)
            .st_crd_lne(alice, usd, Quantity::new(10_000), false, 0, 0)
            .get()?;
        let zero = Wrapper::push_from(&chain, alice)
            .st_pay_ath(
                bob,
                usd,
                Quantity::new(100),
                Quantity::new(100),
                0,
                100,
                TimePointSec { seconds: START },
                never(),
            )
            .get()?;
        Wrapper::push_from(&chain, bob)
            .run_pay_ath(zero, vec![hop(bob, usd)])
            .get()?;
        assert_eq!(exp(&chain, bob, alice, usd), 100);

        Wrapper::push_from(&chain, bob)
            .st_crd_lne(alice, usd, Quantity::new(10_000), false, PPM_SCALE, 0)
            .get()?;
        let capped = Wrapper::push_from(&chain, alice)
            .st_pay_ath(
                bob,
                usd,
                Quantity::new(100),
                Quantity::new(100),
                0,
                100,
                TimePointSec { seconds: START },
                never(),
            )
            .get()?;
        let own = Wrapper::push_from(&chain, bob)
            .run_pay_ath(capped, vec![hop(bob, usd)])
            .get()
            .expect_err("the payee cannot raise the line and collect at 100%");
        assert!(
            own.to_string().contains("pay auth rate exceeds max"),
            "{own}"
        );
        assert_eq!(exp(&chain, bob, alice, usd), 100);
        assert_eq!(pay_row(capped).next_due.seconds, START);

        Wrapper::push_from(&chain, carol)
            .st_crd_lne(alice, usd, Quantity::new(10_000), false, PPM_SCALE, 0)
            .get()?;
        // The path still has to end at the payee. Hop 0 is the raw draw.
        let third = Wrapper::push_from(&chain, bob)
            .run_pay_ath(capped, vec![hop(carol, usd), hop(bob, usd)])
            .get()
            .expect_err("another account's 100% line is the same hole");
        assert!(
            third.to_string().contains("pay auth rate exceeds max"),
            "{third}"
        );
        assert_eq!(exp(&chain, carol, alice, usd), 0);

        Wrapper::push_from(&chain, carol)
            .st_crd_lne(alice, usd, Quantity::new(10_000), false, 0, 0)
            .get()?;
        Wrapper::push_from(&chain, bob)
            .st_crd_lne(carol, usd, Quantity::new(10_000), false, 0, 0)
            .get()?;
        Wrapper::push_from(&chain, carol)
            .st_fwd_ofr(bob, usd, Quantity::new(0), 0, PPM_SCALE, never(), true)
            .get()?;
        Wrapper::push_from(&chain, bob)
            .run_pay_ath(capped, vec![hop(carol, usd), hop(bob, usd)])
            .get()?;
        assert_eq!(exp(&chain, carol, alice, usd), 100);
        assert_eq!(exp(&chain, bob, alice, usd), 100);
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
            .st_crd_lne(alice, usd, Quantity::new(10_000), false, 0, 0)
            .get()?;

        const START: i64 = 1_700_000_000;
        pin(&chain, START);
        let id = schedule(&chain, alice, bob, usd, 100, 100, 100, START, 0);
        assert_eq!(id, 1);

        pin(&chain, START + 40);
        Wrapper::push_from(&chain, alice)
            .run_pay_ath(id, vec![hop(bob, usd)])
            .get()?;
        assert_eq!(exp(&chain, bob, alice, usd), 100);
        assert_eq!(pay_row(id).next_due.seconds, START + 100);

        let early = Wrapper::push_from(&chain, alice).run_pay_ath(id, vec![hop(bob, usd)]);
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
            .st_crd_lne(alice, usd, Quantity::new(10_000), false, 0, 0)
            .get()?;

        const START: i64 = 1_700_000_000;
        pin(&chain, START);
        let id = schedule(&chain, alice, bob, usd, 100, 100, 100, START - 250, 0);

        Wrapper::push_from(&chain, alice)
            .run_pay_ath(id, vec![hop(bob, usd)])
            .get()?;
        assert_eq!(exp(&chain, bob, alice, usd), 100);
        assert_eq!(pay_row(id).next_due.seconds, START - 150);

        Wrapper::push_from(&chain, alice)
            .run_pay_ath(id, vec![hop(bob, usd)])
            .get()?;
        assert_eq!(exp(&chain, bob, alice, usd), 200);
        assert_eq!(pay_row(id).next_due.seconds, START - 50);

        Wrapper::push_from(&chain, alice)
            .run_pay_ath(id, vec![hop(bob, usd)])
            .get()?;
        assert_eq!(exp(&chain, bob, alice, usd), 300);
        assert_eq!(pay_row(id).next_due.seconds, START + 50);

        let extra = Wrapper::push_from(&chain, alice).run_pay_ath(id, vec![hop(bob, usd)]);
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
            .st_crd_lne(alice, usd, Quantity::new(10_000), false, 0, 0)
            .get()?;
        Wrapper::push_from(&chain, bob)
            .st_crd_lne(dave, usd, Quantity::new(10_000), false, 0, 0)
            .get()?;
        Wrapper::push_from(&chain, dave)
            .st_fwd_ofr(bob, usd, Quantity::new(10), 0, PPM_SCALE, never(), true)
            .get()?;

        const START: i64 = 1_700_000_000;
        pin(&chain, START);
        let id = schedule(&chain, alice, bob, usd, 100, 100, 100, START, 0);

        let wrong_payee = Wrapper::push_from(&chain, alice).run_pay_ath(id, vec![hop(carol, usd)]);
        assert!(wrong_payee.get().is_err());
        let wrong_asset = Wrapper::push_from(&chain, alice).run_pay_ath(id, vec![hop(bob, aud)]);
        assert!(wrong_asset.get().is_err());
        let over_ceiling =
            Wrapper::push_from(&chain, alice).run_pay_ath(id, vec![hop(dave, usd), hop(bob, usd)]);
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
            .st_crd_lne(alice, usd, Quantity::new(10_000), false, 0, 0)
            .get()?;

        const START: i64 = 1_700_000_000;
        pin(&chain, START);
        let id = schedule(&chain, alice, bob, usd, 100, 100, 100, START, 0);

        let third = Wrapper::push_from(&chain, carol).run_pay_ath(id, vec![hop(bob, usd)]);
        assert!(third.get().is_err());
        let third_cancel = Wrapper::push_from(&chain, carol).rm_pay_ath(id, true);
        assert!(third_cancel.get().is_err());
        assert_eq!(pay_row(id).next_due.seconds, START);

        Wrapper::push_from(&chain, bob)
            .run_pay_ath(id, vec![hop(bob, usd)])
            .get()?;
        assert_eq!(exp(&chain, bob, alice, usd), 100);
        assert_eq!(exp(&chain, alice, bob, usd), 0);
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
            .st_crd_lne(alice, usd, Quantity::new(10_000), false, 0, 0)
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
        let gone = Wrapper::push_from(&chain, alice).run_pay_ath(due, vec![hop(bob, usd)]);
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
            .run_pay_ath(ending, vec![hop(bob, usd)])
            .get()?;
        assert_eq!(pay_row(ending).next_due.seconds, START + 100);
        let after_end = Wrapper::push_from(&chain, alice).run_pay_ath(ending, vec![hop(bob, usd)]);
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
            .st_crd_lne(alice, usd, Quantity::new(100), true, 0, 0)
            .get()?;
        Wrapper::push_from(&chain, carol)
            .st_glb_fwd(usd, Quantity::new(0), 0, PPM_SCALE, never(), true)
            .get()?;

        let err = Wrapper::push_from(&chain, alice)
            .path_pay(
                vec![hop(carol, usd), hop(alice, usd)],
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
        assert_eq!(
            CreditLine::get_assert(carol, alice, usd).remaining.value,
            100
        );
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
            .st_crd_lne(alice, aud, Quantity::new(10_000), false, 0, 0)
            .get()?;
        Wrapper::push_from(&chain, bob)
            .st_crd_lne(alice, usd, Quantity::new(10_000), false, 0, 0)
            .get()?;
        Wrapper::push_from(&chain, alice)
            .st_crd_lne(bob, usd, Quantity::new(10_000), false, 0, 0)
            .get()?;
        Wrapper::push_from(&chain, carol)
            .st_crd_lne(alice, usd, Quantity::new(10_000), false, 0, 0)
            .get()?;
        Wrapper::push_from(&chain, bob)
            .st_fx_ofr(
                aud,
                usd,
                true,
                Quantity::new(0),
                RATE_SCALE,
                0,
                Quantity::new(10_000),
                never(),
            )
            .get()?;
        Wrapper::push_from(&chain, bob)
            .st_glb_fwd(usd, Quantity::new(0), 0, PPM_SCALE, never(), true)
            .get()?;
        Wrapper::push_from(&chain, alice)
            .st_glb_fwd(usd, Quantity::new(0), 0, PPM_SCALE, never(), true)
            .get()?;

        let onward = Wrapper::push_from(&chain, alice).path_pay(
            vec![hop(bob, aud), hop(alice, usd), hop(carol, usd)],
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
            vec![hop(bob, usd), hop(alice, usd)],
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
                vec![hop(bob, aud), hop(alice, usd)],
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
        const RATE: u32 = 100_000;

        Wrapper::push_from(&chain, bob)
            .st_crd_lne(alice, usd, Quantity::new(AMOUNT * 2), true, RATE, 0)
            .get()?;
        Wrapper::push_from(&chain, carol)
            .st_crd_lne(bob, usd, Quantity::new(AMOUNT), false, 0, 0)
            .get()?;
        Wrapper::push_from(&chain, alice)
            .deposit(carol, usd, Quantity::new(AMOUNT), 0, 0)
            .get()?;
        Wrapper::push_from(&chain, bob)
            .st_fwd_ofr(carol, usd, Quantity::new(0), 0, PPM_SCALE, never(), true)
            .get()?;
        Wrapper::push_from(&chain, carol)
            .st_fwd_ofr(alice, usd, Quantity::new(0), 0, PPM_SCALE, never(), false)
            .get()?;
        Wrapper::push_from(&chain, alice)
            .st_fwd_ofr(bob, usd, Quantity::new(0), 0, PPM_SCALE, never(), false)
            .get()?;

        const START: i64 = 1_700_000_000;
        pin(&chain, START);
        let id = schedule(&chain, alice, bob, usd, AMOUNT, AMOUNT, 100, START, 0);

        let cycled = Wrapper::push_from(&chain, bob).run_pay_ath(
            id,
            vec![
                hop(bob, usd),
                hop(carol, usd),
                hop(alice, usd),
                hop(bob, usd),
            ],
        );
        assert!(cycled.get().is_err());
        assert_eq!(pay_row(id).next_due.seconds, START);
        assert_eq!(exp(&chain, bob, alice, usd), 0);
        assert_eq!(exp(&chain, carol, alice, usd), AMOUNT);
        assert_eq!(exp(&chain, carol, bob, usd), 0);
        assert_eq!(
            CreditLine::get_assert(bob, alice, usd).remaining.value,
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
            .st_crd_lne(alice, usd, Quantity::new(AMOUNT), true, 0, 0)
            .get()?;
        Wrapper::push_from(&chain, dave)
            .st_crd_lne(carol, usd, Quantity::new(AMOUNT), false, 0, 0)
            .get()?;
        Wrapper::push_from(&chain, alice)
            .st_crd_lne(dave, usd, Quantity::new(AMOUNT), true, 0, 0)
            .get()?;
        Wrapper::push_from(&chain, bob)
            .st_crd_lne(alice, usd, Quantity::new(AMOUNT), true, 0, 0)
            .get()?;
        Wrapper::push_from(&chain, carol)
            .st_fwd_ofr(dave, usd, Quantity::new(0), 0, PPM_SCALE, never(), true)
            .get()?;
        Wrapper::push_from(&chain, dave)
            .st_fwd_ofr(alice, usd, Quantity::new(0), 0, PPM_SCALE, never(), true)
            .get()?;
        Wrapper::push_from(&chain, alice)
            .st_fwd_ofr(bob, usd, Quantity::new(0), 0, PPM_SCALE, never(), true)
            .get()?;

        const START: i64 = 1_700_000_000;
        pin(&chain, START);
        let id = schedule(&chain, alice, bob, usd, AMOUNT, AMOUNT, 100, START, 0);

        let err = Wrapper::push_from(&chain, bob)
            .run_pay_ath(
                id,
                vec![
                    hop(carol, usd),
                    hop(dave, usd),
                    hop(alice, usd),
                    hop(bob, usd),
                ],
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
            CreditLine::get_assert(carol, alice, usd).remaining.value,
            AMOUNT
        );
        assert_eq!(
            CreditLine::get_assert(alice, dave, usd).remaining.value,
            AMOUNT
        );
        assert_eq!(
            CreditLine::get_assert(bob, alice, usd).remaining.value,
            AMOUNT
        );
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
            .st_crd_lne(bob, usd, Quantity::new(100_000), false, 0, 0)
            .get()
            .unwrap();
        Wrapper::push_from(chain, john)
            .st_crd_lne(brandon, usd, Quantity::new(100_000), false, 0, 0)
            .get()
            .unwrap();
        Wrapper::push_from(chain, alice)
            .st_crd_lne(john, aud, Quantity::new(100_000), false, 0, 0)
            .get()
            .unwrap();
        Wrapper::push_from(chain, brandon)
            .st_glb_fwd(usd, Quantity::new(0), 0, PPM_SCALE, never(), true)
            .get()
            .unwrap();
        Wrapper::push_from(chain, john)
            .st_glb_fwd(aud, Quantity::new(0), 0, PPM_SCALE, never(), true)
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

    fn post_relay(chain: &psibase::Chain, john: AccountNumber, usd: u16, aud: u16, fee_ppm: u32) {
        Wrapper::push_from(chain, john)
            .st_relay(
                usd,
                Quantity::new(10_000),
                aud,
                Quantity::new(15_000),
                fee_ppm,
            )
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
        post_relay(&chain, net.john, net.usd, net.aud, 0);
        assert_eq!(relay_sides(net.john, net.usd, net.aud), (10_000, 15_000));

        let carol = account!("carol");
        chain.new_account(carol).unwrap();
        let missing = Wrapper::push_from(&chain, net.bob)
            .path_pay(
                vec![
                    hop(net.brandon, net.usd),
                    hop(net.john, net.usd),
                    hop(carol, net.aud),
                ],
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
                vec![
                    hop(net.brandon, net.usd),
                    hop(net.john, net.usd),
                    hop(net.alice, net.aud),
                ],
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
                vec![
                    hop(net.brandon, net.usd),
                    hop(net.john, net.usd),
                    hop(net.alice, net.aud),
                ],
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
        post_relay(&chain, net.john, net.usd, net.aud, 0);
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
            .pay_inv(hops.clone(), Quantity::new(999), id)
            .get()
            .expect_err("999 is under the curve's required send");
        assert!(
            err.to_string().contains("max_spend below required send"),
            "{err}"
        );
        assert_eq!(relay_sides(net.john, net.usd, net.aud), (10_000, 15_000));
        assert_eq!(PayRequest::get_assert(id).remaining.value, 1_363);

        Wrapper::push_from(&chain, net.bob)
            .pay_inv(hops, Quantity::new(1_000), id)
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
        post_relay(&chain, net.john, net.usd, net.aud, 0);
        Wrapper::push_from(&chain, net.john)
            .st_fx_ofr(
                net.usd,
                net.aud,
                true,
                Quantity::new(0),
                RATE_SCALE * 2,
                0,
                Quantity::new(u64::MAX),
                never(),
            )
            .get()?;

        let graph = banx_gql(
            &chain,
            r#"{ pathGraph(from: "bob", to: "alice", maxHops: 4) {
                fxOffers { poster fromAsset toAsset }
                relays { owner assetLo assetHi feePpm }
            } }"#,
        )?;
        let policies = graph
            .pointer("/data/pathGraph/fxOffers")
            .and_then(|v| v.as_array())
            .expect("policies");
        assert!(
            policies
                .iter()
                .all(|row| row.get("poster").and_then(|v| v.as_str()) != Some("john")),
            "{graph}"
        );
        let relays = graph
            .pointer("/data/pathGraph/relays")
            .and_then(|v| v.as_array())
            .expect("relays");
        assert_eq!(relays.len(), 1, "{graph}");
        assert_eq!(
            relays[0].get("owner").and_then(|v| v.as_str()),
            Some("john")
        );
        assert_eq!(relays[0].get("feePpm").and_then(|v| v.as_u64()), Some(0));

        Wrapper::push_from(&chain, net.bob)
            .path_pay(
                vec![
                    hop(net.brandon, net.usd),
                    hop(net.john, net.usd),
                    hop(net.alice, net.aud),
                ],
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
                vec![
                    hop(net.brandon, net.usd),
                    hop(net.john, net.usd),
                    hop(net.alice, net.aud),
                ],
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
    fn test_relay_fee_stays_in_the_input(chain: psibase::Chain) -> Result<(), psibase::Error> {
        let net = relay_net(&chain);
        post_relay(&chain, net.john, net.usd, net.aud, 100_000);
        Wrapper::push_from(&chain, net.bob)
            .path_pay(
                vec![
                    hop(net.brandon, net.usd),
                    hop(net.john, net.usd),
                    hop(net.alice, net.aud),
                ],
                Quantity::new(1_000),
                Quantity::new(1_238),
                0,
            )
            .get()?;
        assert_eq!(exp(&chain, net.alice, net.john, net.aud), 1_238);
        assert_eq!(exp(&chain, net.john, net.brandon, net.usd), 1_000);
        assert_eq!(relay_sides(net.john, net.usd, net.aud), (11_000, 13_762));
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
            .st_crd_lne(alice, aud, Quantity::new(100_000), false, 0, 0)
            .get()?;

        let tokens = Wrapper::push_from(&chain, alice)
            .tok_relay_out(john, aud, gas, Quantity::new(1_000), Quantity::new(1_363))
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
            .st_crd_lne(bob, aud, Quantity::new(100_000), false, 0, 0)
            .get()?;
        Wrapper::push_from(&chain, john)
            .st_crd_lne(brandon, aud, Quantity::new(100_000), false, 0, 0)
            .get()?;
        Wrapper::push_from(&chain, brandon)
            .st_glb_fwd(aud, Quantity::new(0), 0, PPM_SCALE, never(), true)
            .get()?;

        let ghost = account!("nobody");
        let missing = Wrapper::push_from(&chain, bob)
            .path_cash(
                vec![hop(brandon, aud), hop(john, aud)],
                Quantity::new(1_000),
                gas,
                ghost,
                Quantity::new(1),
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
                vec![hop(brandon, aud), hop(john, aud)],
                Quantity::new(1_000),
                gas,
                alice,
                Quantity::new(1_363),
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
            .deposit(alice, aud, Quantity::new(1_000), 0, 0)
            .get()?;

        Wrapper::push_from(&chain, alice)
            .tok_relay_out(john, aud, gas, Quantity::new(1_000), Quantity::new(1_363))
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
            .st_crd_lne(alice, aud, Quantity::new(100_000), false, 0, 0)
            .get()?;
        Wrapper::push_from(&chain, alice)
            .path_pay(
                vec![hop(john, aud)],
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
            .st_tok_relay(aud, gas, Quantity::new(1), Quantity::new(0), 0)
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
            .st_tok_relay(aud, gas, Quantity::new(10_000), Quantity::new(1), 0)
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
            .st_crd_lne(alice, aud, Quantity::new(100_000), false, 0, 0)
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
            .tok_relay_out(john, aud, gas, Quantity::new(1_000), Quantity::new(1_363))
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
        post_relay(&chain, net.john, net.usd, net.aud, 0);
        let carol = account!("carol");
        chain.new_account(carol).unwrap();
        Wrapper::push_from(&chain, net.alice)
            .st_glb_fwd(net.aud, Quantity::new(0), 0, PPM_SCALE, never(), true)
            .get()?;
        Wrapper::push_from(&chain, net.john)
            .st_glb_fwd(net.usd, Quantity::new(0), 0, PPM_SCALE, never(), true)
            .get()?;
        Wrapper::push_from(&chain, carol)
            .st_crd_lne(net.john, net.usd, Quantity::new(100_000), false, 0, 0)
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
            .pay_inv(hops.clone(), Quantity::new(500), id)
            .get()
            .expect_err("500 is one short of the sequential curve");
        assert!(
            short.to_string().contains("max_spend below required send"),
            "{short}"
        );
        assert_eq!(relay_sides(net.john, net.usd, net.aud), (10_000, 15_000));

        Wrapper::push_from(&chain, net.bob)
            .pay_inv(hops.clone(), Quantity::new(501), id)
            .get()?;
        assert!(PayRequest::get(id).is_none());
        assert_eq!(exp(&chain, carol, net.john, net.usd), 500);
        assert_eq!(exp(&chain, net.brandon, net.bob, net.usd), 501);
        assert_eq!(exp(&chain, net.john, net.brandon, net.usd), 501);
        assert_eq!(relay_sides(net.john, net.usd, net.aud), (10_001, 15_000));

        Wrapper::push_from(&chain, net.bob)
            .path_pay(hops, Quantity::new(1_000), Quantity::new(999), 0)
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
        post_relay(&chain, net.john, net.usd, net.aud, 0);
        let carol = account!("carol");
        chain.new_account(carol).unwrap();
        let eur = Asset::get_by_symbol_assert(account!("eur")).id;
        Wrapper::push_from(&chain, net.brandon)
            .st_crd_lne(net.bob, eur, Quantity::new(100_000), false, 0, 0)
            .get()?;
        Wrapper::push_from(&chain, net.brandon)
            .st_fx_ofr(
                eur,
                net.usd,
                true,
                Quantity::new(0),
                RATE_SCALE,
                0,
                Quantity::new(1_500),
                never(),
            )
            .get()?;
        Wrapper::push_from(&chain, net.alice)
            .st_glb_fwd(net.aud, Quantity::new(0), 0, PPM_SCALE, never(), true)
            .get()?;
        Wrapper::push_from(&chain, net.john)
            .st_glb_fwd(net.usd, Quantity::new(0), 0, PPM_SCALE, never(), true)
            .get()?;
        Wrapper::push_from(&chain, carol)
            .st_crd_lne(net.john, net.usd, Quantity::new(100_000), false, 0, 0)
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
            .pay_inv(hops.clone(), Quantity::new(1_024), id)
            .get()
            .expect_err("1024 is below the send that delivers 1400");
        assert!(
            short.to_string().contains("max_spend below required send"),
            "{short}"
        );
        assert_eq!(relay_sides(net.john, net.usd, net.aud), (10_000, 15_000));
        assert!(PayRequest::get(id).is_some());

        Wrapper::push_from(&chain, net.bob)
            .pay_inv(hops, Quantity::new(1_500), id)
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
            .st_relay(wow, Quantity::new(10_000), aud, Quantity::new(15_000), 0)
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
            .st_crd_lne(debitor, asset, Quantity::new(100_000), false, 0, 0)
            .get()
            .unwrap();
    }

    fn forward_any(chain: &psibase::Chain, poster: AccountNumber, asset: u16) {
        Wrapper::push_from(chain, poster)
            .st_glb_fwd(asset, Quantity::new(0), 0, PPM_SCALE, never(), true)
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
        assert!(CreditLine::get(john, billy, aud).is_none());

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
            .path_pay(sell.clone(), Quantity::new(gold), Quantity::new(1), 0)
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
            .deposit(billy, wow, Quantity::new(gold), 0, id)
            .get()
            .is_err());
        assert!(Wrapper::push_from(&chain, billy)
            .deposit(billy, wow, Quantity::new(gold), 0, id)
            .get()
            .is_err());
        Wrapper::push_from(&chain, john)
            .deposit(billy, wow, Quantity::new(gold), 0, id)
            .get()?;
        assert!(PayRequest::get(id).is_none());
        assert_eq!(exp(&chain, billy, john, wow), gold);

        let over = Wrapper::push_from(&chain, billy)
            .path_pay(sell.clone(), Quantity::new(gold + 1), Quantity::new(1), 0)
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
                vec![hop(john, aud)],
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
                vec![hop(john, wow), hop(anthony, aud), hop(billy, aud)],
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
            .path_pay(sell, Quantity::new(gold), Quantity::new(1_363), 0)
            .get()?;
        assert_eq!(exp(&chain, billy, john, wow), 0);
        assert_eq!(exp(&chain, john, billy, wow), 0);
        assert_eq!(exp(&chain, anthony, john, aud), 1_363);
        assert_eq!(exp(&chain, john, anthony, aud), 0);
        assert_eq!(exp(&chain, anthony, billy, aud), 0);
        assert_eq!(exp(&chain, billy, john, aud), 0);
        assert!(CreditLine::get(john, billy, aud).is_none());
        assert_eq!(aud_wow(john, aud, wow), (13_637, 11_000));

        // Billy spends 500 AUD through Anthony. That unwinds 500 of the sale, so John owes Anthony 863.
        Wrapper::push_from(&chain, billy)
            .path_pay(
                vec![hop(anthony, aud), hop(john, aud)],
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
        assert!(CreditLine::get(john, matt, aud).is_none());
        assert!(CreditLine::get(john, matt, wow).is_none());

        let skip = Wrapper::push_from(&chain, matt)
            .path_pay(
                vec![hop(john, aud), hop(josh, wow)],
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
                vec![hop(josh, aud), hop(john, aud), hop(matt, wow)],
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
            .path_pay(buy.clone(), Quantity::new(1_000), Quantity::new(1), 0)
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
            .path_pay(buy, Quantity::new(1_000), Quantity::new(625), 0)
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
            .st_crd_lne(zac, aud, Quantity::new(DEAL_AUD), false, 0, 0)
            .get()?;
        Wrapper::push_from(&chain, zac)
            .st_crd_lne(dave, aud, Quantity::new(DEAL_AUD), false, 0, 0)
            .get()?;
        Wrapper::push_from(&chain, zac)
            .st_glb_fwd(aud, Quantity::new(0), 0, PPM_SCALE, never(), true)
            .get()?;
        Wrapper::push_from(&chain, john)
            .st_glb_fwd(wow, Quantity::new(0), 0, PPM_SCALE, never(), true)
            .get()?;
        Wrapper::push_from(&chain, john)
            .deposit(dave, wow, Quantity::new(DEAL_GOLD), 0, 0)
            .get()?;
        Wrapper::push_from(&chain, john)
            .st_fx_ofr(
                aud,
                wow,
                true,
                Quantity::new(0),
                RATE_SCALE * 2,
                0,
                Quantity::new(DEAL_AUD),
                never(),
            )
            .get()?;
        assert_eq!(exp(&chain, dave, john, wow), DEAL_GOLD);

        let buy = vec![hop(zac, aud), hop(john, aud), hop(dave, wow)];
        let no_line = Wrapper::push_from(&chain, dave)
            .path_pay(
                buy.clone(),
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
            .st_crd_lne(john, wow, Quantity::new(DEAL_GOLD + GOLD_OUT), false, 0, 0)
            .get()?;
        Wrapper::push_from(&chain, dave)
            .path_pay(buy, Quantity::new(PAY_AUD), Quantity::new(GOLD_OUT), 0)
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
            .st_crd_lne(zac, aud, Quantity::new(PAY_AUD), false, 0, 0)
            .get()?;
        Wrapper::push_from(&chain, zac)
            .st_crd_lne(dave, aud, Quantity::new(PAY_AUD), false, 0, 0)
            .get()?;
        Wrapper::push_from(&chain, zac)
            .st_glb_fwd(aud, Quantity::new(0), 0, PPM_SCALE, never(), true)
            .get()?;
        Wrapper::push_from(&chain, john)
            .st_glb_fwd(wow, Quantity::new(0), 0, PPM_SCALE, never(), true)
            .get()?;
        Wrapper::push_from(&chain, john)
            .deposit(dave, wow, Quantity::new(WEIGHT_GOLD), 0, 0)
            .get()?;
        Wrapper::push_from(&chain, john)
            .st_relay(
                aud,
                Quantity::new(WEIGHT_AUD),
                wow,
                Quantity::new(WEIGHT_GOLD),
                0,
            )
            .get()?;
        assert_eq!(exp(&chain, dave, john, wow), WEIGHT_GOLD);
        assert_eq!(aud_wow(john, aud, wow), (WEIGHT_AUD, WEIGHT_GOLD));
        assert!(FxOffer::get(john, aud, wow, true).is_none());

        let buy = vec![hop(zac, aud), hop(john, aud), hop(dave, wow)];
        let no_line = Wrapper::push_from(&chain, dave)
            .path_pay(
                buy.clone(),
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
            .st_crd_lne(
                john,
                wow,
                Quantity::new(WEIGHT_GOLD + GOLD_OUT),
                false,
                0,
                0,
            )
            .get()?;
        Wrapper::push_from(&chain, dave)
            .path_pay(buy, Quantity::new(PAY_AUD), Quantity::new(GOLD_OUT), 0)
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
            .st_crd_lne(dave, wow, Quantity::new(PAY_GOLD), false, 0, 0)
            .get()?;
        Wrapper::push_from(&chain, john)
            .st_crd_lne(zac, wow, Quantity::new(PAY_GOLD), false, 0, 0)
            .get()?;
        Wrapper::push_from(&chain, zac)
            .st_glb_fwd(wow, Quantity::new(0), 0, PPM_SCALE, never(), true)
            .get()?;
        Wrapper::push_from(&chain, john)
            .st_glb_fwd(aud, Quantity::new(0), 0, PPM_SCALE, never(), true)
            .get()?;
        Wrapper::push_from(&chain, john)
            .st_relay(
                aud,
                Quantity::new(WEIGHT_AUD),
                wow,
                Quantity::new(WEIGHT_GOLD),
                0,
            )
            .get()?;
        assert_eq!(aud_wow(john, aud, wow), (WEIGHT_AUD, WEIGHT_GOLD));

        let pay = vec![hop(zac, wow), hop(john, wow), hop(mitchell, aud)];
        let no_line = Wrapper::push_from(&chain, dave)
            .path_pay(
                pay.clone(),
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
            .st_crd_lne(john, aud, Quantity::new(AUD_OUT), false, 0, 0)
            .get()?;
        Wrapper::push_from(&chain, dave)
            .path_pay(pay, Quantity::new(PAY_GOLD), Quantity::new(AUD_OUT), 0)
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
            .st_crd_lne(alice, aud, Quantity::new(10_000), false, 0, 0)
            .get()?;
        Wrapper::push_from(&chain, alice)
            .path_pay(
                vec![hop(gary, aud)],
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
                0,
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
    /// Lines are capacity. The line APR is not the claim rate. No forward offer.
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
            .st_crd_lne(gary, aud, Quantity::new(1_000), false, 100_000, 0)
            .get()?;
        Wrapper::push_from(&chain, alice)
            .st_fx_ofr(
                aud,
                usd,
                true,
                Quantity::new(10),
                RATE_SCALE / 2,
                0,
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
            .st_crd_lne(alice, usd, Quantity::new(1_000), false, 80_000, 0)
            .get()?;
        let short = Wrapper::push_from(&chain, gary)
            .take_fx(alice, aud, usd, true, Quantity::new(100), 46)
            .get()
            .expect_err("fee leaves 45, below the signed floor");
        assert!(
            short.to_string().contains("trade output below min_to"),
            "{short}"
        );

        Wrapper::push_from(&chain, gary)
            .take_fx(alice, aud, usd, true, Quantity::new(100), 45)
            .get()?;
        // 100 − 10 fee, then half. Order APR is 0, not either line's rate.
        assert_eq!(exp(&chain, alice, gary, aud), 100);
        assert_eq!(exp(&chain, gary, alice, usd), 45);
        assert_eq!(exp(&chain, gary, alice, aud), 0);
        assert_eq!(exp(&chain, alice, gary, usd), 0);
        assert_eq!(
            Obligation::get_by_interest_rate(alice, gary, aud, 0)
                .unwrap()
                .interest_rate,
            0
        );
        assert_eq!(
            Obligation::get_by_interest_rate(gary, alice, usd, 0)
                .unwrap()
                .interest_rate,
            0
        );
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
            .st_crd_lne(gary, aud, Quantity::new(1_000), false, 0, 0)
            .get()?;
        Wrapper::push_from(&chain, gary)
            .path_pay(
                vec![hop(alice, aud)],
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
                0,
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
            .st_crd_lne(gary, aud, Quantity::new(1_000), false, 0, 0)
            .get()?;
        Wrapper::push_from(&chain, gary)
            .path_pay(
                vec![hop(alice, aud)],
                Quantity::new(10),
                Quantity::new(10),
                0,
            )
            .get()?;
        Wrapper::push_from(&chain, gary)
            .st_crd_lne(alice, usd, Quantity::new(1_000), false, 80_000, 0)
            .get()?;
        Wrapper::push_from(&chain, alice)
            .st_fx_ofr(
                aud,
                usd,
                true,
                Quantity::new(0),
                RATE_SCALE / 2,
                0,
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
            .st_crd_lne(gary, aud, Quantity::new(1_000), false, 0, 0)
            .get()?;
        Wrapper::push_from(&chain, gary)
            .st_crd_lne(alice, usd, Quantity::new(1_000), false, 0, 0)
            .get()?;
        Wrapper::push_from(&chain, gary)
            .path_pay(
                vec![hop(alice, aud)],
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
                0,
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
            .st_crd_lne(gary, aud, Quantity::new(1_000), false, 0, 0)
            .get()?;
        Wrapper::push_from(&chain, gary)
            .st_crd_lne(alice, usd, Quantity::new(1_000), false, 0, 0)
            .get()?;
        Wrapper::push_from(&chain, gary)
            .path_pay(
                vec![hop(alice, aud)],
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
                0,
                Quantity::new(200),
                never(),
            )
            .get()?;

        // 80 + 10 rebooks to 45 of debt. 20 − 10 opens 5 of receipt. Net debt 40.
        let over = Wrapper::push_from(&chain, gary)
            .take_fx(alice, aud, usd, true, Quantity::new(100), -39)
            .get()
            .expect_err("net debt is 40, above the signed cap");
        assert!(
            over.to_string().contains("trade output above min_to"),
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
            .st_crd_lne(gary, aud, Quantity::new(1_000), false, 100_000, 0)
            .get()?;
        Wrapper::push_from(&chain, gary)
            .st_crd_lne(alice, usd, Quantity::new(1_000), false, 80_000, 0)
            .get()?;
        // Alice owes Gary 1 AUD. That must not select a sell.
        Wrapper::push_from(&chain, alice)
            .deposit(gary, aud, Quantity::new(1), 0, 0)
            .get()?;
        Wrapper::push_from(&chain, alice)
            .st_fx_ofr(
                aud,
                usd,
                true,
                Quantity::new(0),
                RATE_SCALE / 2,
                0,
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
            .st_crd_lne(alice, aud, Quantity::new(10_000), false, 0, 0)
            .get()?;
        Wrapper::push_from(&chain, alice)
            .path_pay(
                vec![hop(gary, aud)],
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
                0,
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
                0,
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
            .deposit(john, kwh, Quantity::new(ten_kwh), 0, 0)
            .get()?;
        assert_eq!(exp(&chain, john, isabelle, kwh), ten_kwh);

        Wrapper::push_from(&chain, john)
            .st_fx_ofr(
                kwh,
                aud,
                true,
                Quantity::new(fee_kwh),
                rate,
                0,
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
            .deposit(isabelle, kwh, Quantity::new(ten_kwh), 0, 0)
            .get()?;
        assert_eq!(exp(&chain, isabelle, john, kwh), ten_kwh);

        Wrapper::push_from(&chain, john)
            .st_fx_ofr(
                kwh,
                aud,
                true,
                Quantity::new(fee_kwh),
                rate,
                0,
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
                0,
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
            .deposit(john, kwh, Quantity::new(ten_kwh), 0, 0)
            .get()?;
        Wrapper::push_from(&chain, john)
            .st_fx_ofr(
                kwh,
                aud,
                true,
                Quantity::new(fee_kwh),
                rate,
                0,
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
            .deposit(isabelle, kwh, Quantity::new(five_kwh), 0, 0)
            .get()?;
        Wrapper::push_from(&chain, john)
            .deposit(isabelle, aud, Quantity::new(creditor_aud), 0, 0)
            .get()?;
        assert_eq!(exp(&chain, john, isabelle, kwh), 0);
        assert_eq!(exp(&chain, john, isabelle, aud), 0);

        Wrapper::push_from(&chain, john)
            .deposit(isabelle, kwh, Quantity::new(ten_kwh), 0, 0)
            .get()?;
        Wrapper::push_from(&chain, john)
            .st_fx_ofr(
                kwh,
                aud,
                false,
                Quantity::new(fee_kwh),
                rate,
                0,
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
            .deposit(isabelle, kwh, Quantity::new(ten_kwh), 0, 0)
            .get()?;
        Wrapper::push_from(&chain, john)
            .st_fx_ofr(
                kwh,
                aud,
                false,
                Quantity::new(fee_kwh),
                rate,
                0,
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
            .deposit(john, kwh, Quantity::new(ten_kwh + one_kwh), 0, 0)
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
                0,
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
            0,
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
                    0,
                    Quantity::new(ten),
                    never(),
                )
                .get()?;
        }

        // She owes him 1 raw AUD. USD→AUD rows must not fill in the other way.
        Wrapper::push_from(&chain, isabelle)
            .deposit(john, aud, Quantity::new(1), 0, 0)
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
            .deposit(isabelle, aud, Quantity::new(1), 0, 0)
            .get()?;
        assert_eq!(exp(&chain, john, isabelle, aud), 0);
        assert_eq!(exp(&chain, isabelle, john, aud), 0);

        // They owe him 10 USD. 10 × 1.14 = 11.4000 AUD.
        Wrapper::push_from(&chain, isabelle)
            .deposit(john, usd, Quantity::new(ten), 0, 0)
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
            .deposit(isabelle, aud, Quantity::new(114_000), 0, 0)
            .get()?;
        assert_eq!(exp(&chain, john, isabelle, aud), 0);

        // He owes her 10 USD. Same rate, the other debt side.
        Wrapper::push_from(&chain, john)
            .deposit(isabelle, usd, Quantity::new(ten), 0, 0)
            .get()?;
        Wrapper::push_from(&chain, isabelle)
            .convert(john, usd, aud, Quantity::new(ten), Quantity::new(0))
            .get()?;
        assert_eq!(exp(&chain, isabelle, john, usd), 0);
        assert_eq!(exp(&chain, isabelle, john, aud), 114_000);
        assert!(FxOffer::get(john, usd, aud, false).is_none());
        Wrapper::push_from(&chain, isabelle)
            .deposit(john, aud, Quantity::new(114_000), 0, 0)
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
                    0,
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
            .deposit(john, aud, Quantity::new(ten), 0, 0)
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
            .deposit(isabelle, usd, Quantity::new(79_166), 0, 0)
            .get()?;
        Wrapper::push_from(&chain, john)
            .deposit(isabelle, aud, Quantity::new(ten), 0, 0)
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
            .st_crd_lne(alice, aud, Quantity::new(10_000), false, 0, 0)
            .get()?;
        Wrapper::push_from(&chain, alice)
            .path_pay(
                vec![hop(gary, aud)],
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
            0,
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
                0,
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
                0,
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
                0,
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
            .st_crd_lne(gary, usd, Quantity::new(10_000), false, 0, 0)
            .get()?;
        Wrapper::push_from(&chain, gary)
            .st_glb_fwd(usd, Quantity::new(0), 0, PPM_SCALE, never(), true)
            .get()?;
        Wrapper::push_from(&chain, gary)
            .st_fx_ofr(
                aud,
                usd,
                true,
                Quantity::new(0),
                RATE_SCALE * 70 / 100,
                0,
                Quantity::new(500),
                never(),
            )
            .get()?;

        let too_big = Wrapper::push_from(&chain, alice).path_pay(
            vec![hop(gary, aud), hop(steve, usd)],
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
            vec![hop(gary, aud), hop(steve, usd)],
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
                vec![hop(gary, aud), hop(steve, usd)],
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
                vec![hop(gary, aud), hop(steve, usd)],
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
            .st_crd_lne(alice, aud, Quantity::new(10_000), false, 0, 0)
            .get()?;
        Wrapper::push_from(&chain, alice)
            .path_pay(
                vec![hop(gary, aud)],
                Quantity::new(100),
                Quantity::new(100),
                0,
            )
            .get()?;
        // Reverse 40 AUD (Gary books value from Alice). Deposit auto-nets
        // to 60; convert also nets, so a live two-way book is the same.
        Wrapper::push_from(&chain, gary)
            .deposit(alice, aud, Quantity::new(40), 0, 0)
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
                0,
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
            .st_crd_lne(alice, aud, Quantity::new(10_000), false, 0, 0)
            .get()?;
        Wrapper::push_from(&chain, alice)
            .path_pay(
                vec![hop(gary, aud)],
                Quantity::new(100),
                Quantity::new(100),
                0,
            )
            .get()?;
        // Gary already owes Alice 80 USD.
        Wrapper::push_from(&chain, gary)
            .deposit(alice, usd, Quantity::new(80), 0, 0)
            .get()?;
        assert_eq!(exp(&chain, alice, gary, usd), 80);

        Wrapper::push_from(&chain, gary)
            .st_fx_ofr(
                aud,
                usd,
                true,
                Quantity::new(0),
                RATE_SCALE,
                0,
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
            .st_crd_lne(alice, aud, Quantity::new(10_000), false, 0, 0)
            .get()?;
        Wrapper::push_from(&chain, alice)
            .path_pay(
                vec![hop(gary, aud)],
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
                0,
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
                0,
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
            .st_crd_lne(alice, aud, Quantity::new(10000), false, 200_000, 0)
            .get()?;
        Wrapper::push_from(&chain, alice)
            .path_pay(vec![hop(gary, aud)], 100.into(), 100.into(), 0)
            .get()?;
        Wrapper::push_from(&chain, alice)
            .st_fx_ofr(
                aud,
                usd,
                true,
                0.into(),
                RATE_SCALE,
                0,
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
        let still = Obligation::get_by_interest_rate(gary, alice, aud, 200_000).unwrap();
        assert_eq!(still.remaining_principal.value, 100);

        Wrapper::push_from(&chain, gary)
            .st_fx_ofr(
                aud,
                usd,
                true,
                Quantity::new(0),
                RATE_SCALE * 50 / 100,
                0,
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
}
