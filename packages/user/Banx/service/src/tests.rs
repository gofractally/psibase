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
        Asset, BanxInvite, BanxInviteTable, BookAuth, CashQuote, ClaimOffer, CreditLine,
        CurrencyPolicy, InitTable, Obligation, ObligationTable, PairCycle, PathHop, PayAuth,
        PayAuthTab, PayRequest, PPM_SCALE, RATE_SCALE,
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
            .st_cur_pol(
                aud,
                usd,
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
            .st_cur_pol(
                aud,
                usd,
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
            .buy_claim(john, cafe, aud, 90_0000.into())
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
            .st_cur_pol(
                aud,
                usd,
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

    #[psibase::test_case(packages("Banx"))]
    fn test_currency_policy_convert(chain: psibase::Chain) -> Result<(), psibase::Error> {
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
            .st_cur_pol(
                aud,
                usd,
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

    /// From-asset `remaining` caps convert and path FX. A take larger than
    /// what is left is rejected whole. Posting again replaces what is left.
    #[psibase::test_case(packages("Banx"))]
    fn test_currency_policy_remaining_caps_convert_and_path(
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

        let zero = Wrapper::push_from(&chain, gary).st_cur_pol(
            aud,
            usd,
            Quantity::new(0),
            RATE_SCALE * 50 / 100,
            0,
            Quantity::new(0),
            never(),
        );
        let err = zero.trace.error.as_deref().unwrap_or("(no error)");
        assert!(
            err.contains("currency policy remaining must be positive"),
            "zero remaining: {err}"
        );
        assert!(CurrencyPolicy::get(gary, aud, usd).is_none());

        Wrapper::push_from(&chain, gary)
            .st_cur_pol(
                aud,
                usd,
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
            err.contains("currency policy amount exceeds remaining"),
            "convert over remaining: {err}"
        );
        assert_eq!(exp(&chain, gary, alice, aud), 100);
        assert_eq!(exp(&chain, gary, alice, usd), 0);
        assert_eq!(
            CurrencyPolicy::get_assert(gary, aud, usd).remaining.value,
            40
        );

        Wrapper::push_from(&chain, alice)
            .convert(gary, aud, usd, Quantity::new(40), Quantity::new(20))
            .get()?;
        assert_eq!(exp(&chain, gary, alice, aud), 60);
        assert_eq!(exp(&chain, gary, alice, usd), 20);
        assert_eq!(
            CurrencyPolicy::get_assert(gary, aud, usd).remaining.value,
            0
        );
        assert!(Wrapper::push_from(&chain, alice)
            .convert(gary, aud, usd, Quantity::new(1), Quantity::new(0))
            .get()
            .is_err());
        assert_eq!(exp(&chain, gary, alice, aud), 60);

        // 60 of exposure against a budget of 50 must not fill 50 and leave 10.
        Wrapper::push_from(&chain, gary)
            .st_cur_pol(
                aud,
                usd,
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
            err.contains("currency policy amount exceeds remaining"),
            "no partial fill: {err}"
        );
        assert_eq!(exp(&chain, gary, alice, aud), 60);
        assert_eq!(exp(&chain, gary, alice, usd), 20);
        assert_eq!(
            CurrencyPolicy::get_assert(gary, aud, usd).remaining.value,
            50
        );

        Wrapper::push_from(&chain, gary)
            .st_cur_pol(
                aud,
                usd,
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
        assert_eq!(
            CurrencyPolicy::get_assert(gary, aud, usd).remaining.value,
            0
        );

        // 1000 AUD at 0.70 needs 1000 of budget. 500 delivers 350 USD.
        Wrapper::push_from(&chain, steve)
            .st_crd_lne(gary, usd, Quantity::new(10_000), false, 0, 0)
            .get()?;
        Wrapper::push_from(&chain, gary)
            .st_glb_fwd(usd, Quantity::new(0), 0, PPM_SCALE, never(), true)
            .get()?;
        Wrapper::push_from(&chain, gary)
            .st_cur_pol(
                aud,
                usd,
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
            err.contains("currency policy amount exceeds remaining"),
            "path over remaining: {err}"
        );
        assert_eq!(exp(&chain, gary, alice, aud), 0);
        assert_eq!(exp(&chain, steve, gary, usd), 0);
        assert_eq!(
            CurrencyPolicy::get_assert(gary, aud, usd).remaining.value,
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
            err.contains("currency policy amount exceeds remaining"),
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
        assert_eq!(
            CurrencyPolicy::get_assert(gary, aud, usd).remaining.value,
            0
        );
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
    fn test_rm_cur_pol_removes_offer(chain: psibase::Chain) -> Result<(), psibase::Error> {
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
            .st_cur_pol(
                aud,
                usd,
                Quantity::new(0),
                RATE_SCALE,
                0,
                Quantity::new(u64::MAX),
                never(),
            )
            .get()?;
        assert!(CurrencyPolicy::get(gary, aud, usd).is_some());

        Wrapper::push_from(&chain, gary)
            .rm_cur_pol(aud, usd)
            .get()?;
        assert!(CurrencyPolicy::get(gary, aud, usd).is_none());
        assert!(Wrapper::push_from(&chain, alice)
            .convert(gary, aud, usd, Quantity::new(100), Quantity::new(100))
            .get()
            .is_err());
        assert!(Wrapper::push_from(&chain, gary)
            .rm_cur_pol(aud, usd)
            .get()
            .is_err());
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
            .st_cur_pol(
                aud,
                usd,
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
            .st_cur_pol(
                aud,
                usd,
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

        Wrapper::push_from(&chain, alice)
            .sell_claim(peter, bob, usd, Quantity::new(10_000))
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

        Wrapper::push_from(&chain, alice)
            .sell_claim(peter, bob, usd, Quantity::new(10_000))
            .get()?;

        assert_eq!(exp(&chain, alice, bob, usd), 0);
        assert_eq!(exp(&chain, peter, bob, usd), 10_000);
        assert_eq!(exp(&chain, alice, peter, usd), 10_500);

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
            .sell_claim(peter, bob, usd, Quantity::new(50))
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
            .sell_claim(peter, bob, usd, Quantity::new(50))
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
            .sell_claim(peter, bob, usd, Quantity::new(1_000))
            .get()
            .is_err());

        Wrapper::push_from(&chain, bob)
            .st_crd_lne(peter, usd, Quantity::new(0), false, 0, 0)
            .get()?;
        Wrapper::push_from(&chain, alice)
            .sell_claim(peter, bob, usd, Quantity::new(1_000))
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
                .sell_claim(peter, carol, usd, Quantity::new(500))
                .get()
                .is_err(),
            "global buy without a buyer line must not take new exposure"
        );

        Wrapper::push_from(&chain, peter)
            .st_crd_lne(carol, usd, Quantity::new(500), false, 0, 0)
            .get()?;
        assert!(
            Wrapper::push_from(&chain, steve)
                .sell_claim(peter, carol, usd, Quantity::new(2_000))
                .get()
                .is_err(),
            "cannot dump more than the buyer's empty line"
        );
        Wrapper::push_from(&chain, steve)
            .sell_claim(peter, carol, usd, Quantity::new(500))
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
            .sell_claim(peter, carol, usd, Quantity::new(500))
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
                .sell_claim(mallory, bob, usd, Quantity::new(1_000))
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
            .sell_claim(peter, bob, usd, Quantity::new(1_000))
            .get()
            .is_err());
        assert_eq!(exp(&chain, alice, bob, usd), 1_000);
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

        Wrapper::push_from(&chain, alice)
            .st_cur_pol(
                aud,
                usd,
                Quantity::new(0),
                RATE_SCALE * 50 / 100,
                0,
                Quantity::new(u64::MAX),
                never(),
            )
            .get()?;
        Wrapper::push_from(&chain, gary)
            .st_cur_pol(
                aud,
                usd,
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

    /// John takes 12 weetbix and 80.0g of coffee. Isabelle's later 3 weetbix
    /// net his biscuit claim to 9. He posts the coffee→AUD price; she accepts
    /// it. His own convert looks up her policy and does not reprice the claim.
    #[psibase::test_case(packages("Banx"))]
    fn test_pantry_open_biscuits_and_debtor_priced_coffee(
        chain: psibase::Chain,
    ) -> Result<(), psibase::Error> {
        Wrapper::push(&chain).init().get()?;
        let john = account!("john");
        let isabelle = account!("isabelle");
        chain.new_account(john).unwrap();
        chain.new_account(isabelle).unwrap();

        let weetbix = Wrapper::push_from(&chain, john)
            .add_asset(
                account!("weetbix"),
                Precision::new(0).unwrap(),
                "biscuit".into(),
            )
            .get()?;
        // Precision 1: 80.0g is 800 raw units.
        let coffee = Wrapper::push_from(&chain, john)
            .add_asset(
                account!("coffee"),
                Precision::new(1).unwrap(),
                "0.1g of beans".into(),
            )
            .get()?;
        let aud = Asset::get_by_symbol_assert(account!("aud")).id;

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

        // 800 raw coffee * 50 / 1 = 40_000 raw AUD = $4.00 at precision 4.
        Wrapper::push_from(&chain, john)
            .st_cur_pol(
                coffee,
                aud,
                Quantity::new(0),
                RATE_SCALE * 50,
                0,
                Quantity::new(800),
                never(),
            )
            .get()?;
        let own = Wrapper::push_from(&chain, john).convert(
            isabelle,
            coffee,
            aud,
            Quantity::new(800),
            Quantity::new(40_000),
        );
        let err = own
            .trace
            .error
            .as_deref()
            .unwrap_or("(no error — convert succeeded)");
        assert!(
            err.contains("CurrencyPolicy not found"),
            "john must not reprice coffee with his own policy, got {err}"
        );
        assert_eq!(exp(&chain, isabelle, john, coffee), 800);
        assert_eq!(exp(&chain, isabelle, john, aud), 0);

        Wrapper::push_from(&chain, isabelle)
            .convert(john, coffee, aud, Quantity::new(800), Quantity::new(40_000))
            .get()?;
        assert_eq!(exp(&chain, isabelle, john, coffee), 0);
        assert_eq!(exp(&chain, isabelle, john, aud), 40_000);
        assert_eq!(exp(&chain, isabelle, john, weetbix), 9);
        assert_eq!(
            CurrencyPolicy::get(john, coffee, aud)
                .unwrap()
                .remaining
                .value,
            0
        );
        let aud_claim = Obligation::get_by_interest_rate(isabelle, john, aud, 0).unwrap();
        assert_eq!(aud_claim.remaining_principal.value, 40_000);
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
            .st_cur_pol(
                merlo,
                aud,
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
        assert_eq!(
            CurrencyPolicy::get(isabelle, merlo, aud)
                .unwrap()
                .remaining
                .value,
            0
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
            .st_cur_pol(
                aud,
                usd,
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
            .st_cur_pol(
                aud,
                usd,
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
            .st_cur_pol(
                aud,
                usd,
                Quantity::new(0),
                RATE_SCALE * 70 / 100,
                0,
                Quantity::new(u64::MAX),
                never(),
            )
            .get()?;
        // Steve sits between USD and GBP.
        Wrapper::push_from(&chain, steve)
            .st_cur_pol(
                usd,
                gbp,
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
            .st_cur_pol(
                aud,
                usd,
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
            .st_cur_pol(
                aud,
                usd,
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
            "path_pay must fail without Gary's AUD→USD policy"
        );

        Wrapper::push_from(&chain, gary)
            .st_cur_pol(
                aud,
                usd,
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
            .st_cur_pol(
                usd,
                missing,
                Quantity::new(0),
                RATE_SCALE,
                0,
                Quantity::new(u64::MAX),
                never(),
            )
            .get();
        assert!(fx.is_err());
        let fx_from = Wrapper::push_from(&chain, alice)
            .st_cur_pol(
                missing,
                usd,
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
            .sell_claim(peter, bob, usd, Quantity::new(1_000))
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
            .sell_claim(peter, bob, usd, Quantity::new(1_000_000))
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
            .sell_claim(peter, bob, usd, Quantity::new(1))
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
            .sell_claim(peter, bob, usd, Quantity::new(aged))
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
            .sell_claim(peter, bob, usd, Quantity::new(src_face))
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
            .sell_claim(peter, bob, usd, Quantity::new(src_interest))
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
            .sell_claim(gary, bob, usd, Quantity::new(1_000))
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

    /// Expired FX must fail at invert (`currency policy expired`), not after
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
            .st_cur_pol(
                aud,
                usd,
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
            err.contains("currency policy expired"),
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

    /// Convert uses the counterparty's quote, not the sender's. Alice cannot
    /// rebook at her own 1:1; she can take Gary's 0.50.
    #[psibase::test_case(packages("Banx"))]
    fn test_convert_uses_counterparty_policy(chain: psibase::Chain) -> Result<(), psibase::Error> {
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
            .st_cur_pol(
                aud,
                usd,
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
            err.contains("CurrencyPolicy not found"),
            "test_convert_uses_counterparty_policy: want policy missing, got {err}"
        );
        assert_eq!(exp(&chain, gary, alice, aud), 100);
        assert_eq!(exp(&chain, gary, alice, usd), 0);
        let still = Obligation::get_by_interest_rate(gary, alice, aud, 200_000).unwrap();
        assert_eq!(still.remaining_principal.value, 100);

        Wrapper::push_from(&chain, gary)
            .st_cur_pol(
                aud,
                usd,
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
            .st_cur_pol(
                aud,
                usd,
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
        enable_auto_debit(chain, minter);
        enable_auto_debit(chain, holder);
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
            psibase::services::tokens::Wrapper::push_from(chain, minter)
                .credit(
                    token_id,
                    holder,
                    Quantity::new(supply),
                    "gas".to_string().try_into().unwrap(),
                )
                .get()
                .unwrap();
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

    #[psibase::test_case(packages("Banx"))]
    fn test_cash_out_and_in_gas_usd(chain: psibase::Chain) -> Result<(), psibase::Error> {
        Wrapper::push(&chain).init().get()?;
        let alice = account!("alice");
        let bob = account!("bob");
        chain.new_account(alice).unwrap();
        chain.new_account(bob).unwrap();
        enable_auto_debit(&chain, alice);
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
        assert_eq!(token_balance(&chain, gas, alice), 1_000_000);
        assert_eq!(vault_bal(&chain, bob, gas), 4_000_000);

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
        enable_auto_debit(&chain, alice);
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
        assert_eq!(token_balance(&chain, gas, alice), 200_000);
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
        assert_eq!(token_balance(&chain, gas, bob), 1_000_000);
        Ok(())
    }

    /// A cash-out that the taker has not auto-debited must not book the claim.
    #[psibase::test_case(packages("Banx"))]
    fn test_cash_out_requires_delivered_tokens(
        chain: psibase::Chain,
    ) -> Result<(), psibase::Error> {
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
            err.to_string().contains("token credit was not delivered"),
            "got {err}"
        );
        assert_eq!(exp(&chain, bob, alice, usd), 0);
        assert_eq!(token_balance(&chain, gas, alice), 0);
        assert_eq!(vault_bal(&chain, bob, gas), 500_000);
        assert_eq!(
            CreditLine::get_assert(bob, alice, usd).remaining.value,
            100_000
        );
        assert_eq!(
            CashQuote::get_assert(bob, usd, gas, true).remaining.value,
            100_000
        );
        Ok(())
    }

    /// Withdrawing the vault without auto-debit must leave the vault in place.
    #[psibase::test_case(packages("Banx"))]
    fn test_cash_withdraw_requires_delivered_tokens(
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

        let err = Wrapper::push_from(&chain, bob)
            .csh_wd(gas, Quantity::new(400_000))
            .get()
            .unwrap_err();
        assert!(
            err.to_string().contains("token credit was not delivered"),
            "got {err}"
        );
        assert_eq!(vault_bal(&chain, bob, gas), 400_000);
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
        enable_auto_debit(&chain, bob);

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

        assert_eq!(token_balance(&chain, gas, bob), 500);
        assert_eq!(exp(&chain, james, bob, usd), 5_000);
        assert_eq!(vault_bal(&chain, james, gas), 399_500);

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
            .st_bk_ath(bob, usd, Quantity::new(10_000), 0, never())
            .get()?;
        let auth = BookAuth::get_assert(alice, bob, usd);
        assert_eq!(auth.remaining.value, 10_000);
        assert_eq!(auth.max_interest_rate, 0);

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
            .st_bk_ath(bob, usd, Quantity::new(1_000), 0, never())
            .get()?;

        assert!(Wrapper::push_from(&chain, bob)
            .book(alice, usd, Quantity::new(1_001), 0, "".into())
            .get()
            .is_err());
        assert!(Wrapper::push_from(&chain, bob)
            .book(alice, usd, Quantity::new(100), 1, "".into())
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
            .st_bk_ath(bob, usd, Quantity::new(500), 0, never())
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
            .st_bk_ath(bob, usd, Quantity::new(5_000), 12_000, never())
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
            .st_bk_ath(bob, usd, Quantity::new(5_000), 0, never())
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
            .sell_claim(peter, bob, usd, Quantity::new(401))
            .get()
            .is_err());
        Wrapper::push_from(&chain, alice)
            .sell_claim(peter, bob, usd, Quantity::new(400))
            .get()?;
        assert_eq!(
            ClaimOffer::get_assert(peter, ClaimOffer::GLOBAL, usd, ClaimOffer::BUY)
                .remaining
                .value,
            0
        );
        assert!(Wrapper::push_from(&chain, alice)
            .sell_claim(peter, bob, usd, Quantity::new(1))
            .get()
            .is_err());

        Wrapper::push_from(&chain, peter)
            .st_glb_buy(usd, Quantity::new(0), 0, Quantity::new(600), never())
            .get()?;
        Wrapper::push_from(&chain, alice)
            .sell_claim(peter, bob, usd, Quantity::new(600))
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
        enable_auto_debit(&chain, alice);
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
    ) {
        Wrapper::push_from(chain, debtor)
            .st_bk_ath(creditor, asset, Quantity::new(u64::MAX), 0, never())
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
        allow_book(&chain, alice, bob, usd);

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
        allow_book(&chain, alice, bob, usd);
        allow_book(&chain, alice, bob, aud);
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
        allow_book(&chain, alice, bob, usd);

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
        allow_book(&chain, alice, bob, usd);

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
        allow_book(&chain, alice, bob, usd);
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
        allow_book(&chain, alice, bob, usd);
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

    /// max 0 still allows a negative rate. Past −100% is rejected.
    #[psibase::test_case(packages("Banx"))]
    fn test_book_negative_rate_bounds(chain: psibase::Chain) -> Result<(), psibase::Error> {
        Wrapper::push(&chain).init().get()?;
        let alice = account!("alice");
        let bob = account!("bob");
        chain.new_account(alice).unwrap();
        chain.new_account(bob).unwrap();
        let usd = Asset::get_by_symbol_assert(account!("usd")).id;
        allow_book(&chain, alice, bob, usd);

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
            .st_bk_ath(bob, usd, Quantity::new(u64::MAX), POSITIVE as u32, never())
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
        allow_book(&chain, alice, bob, usd);
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

        allow_book(&chain, bob, peter, usd);
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
            .sell_claim(peter, bob, usd, Quantity::new(1_000_000))
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
}
