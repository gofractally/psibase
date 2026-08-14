#![allow(non_snake_case)]

#[cfg(test)]
mod tests {
    use crate::interest::{
        compound_amount, interest_for, SECONDS_PER_DAY, SECONDS_PER_YEAR,
    };
    use crate::tables::{Asset, CreditLine, Obligation, PairCycle, PathHop, PPM_SCALE, RATE_SCALE};
    use crate::Wrapper;
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

    #[psibase::test_case(packages("Banx"))]
    fn test_init_seeds_default_assets(chain: psibase::Chain) -> Result<(), psibase::Error> {
        Wrapper::push(&chain).init().get()?;

        let fiat = [
            (account!("usd"), "United States dollar"),
            (account!("aud"), "Australian dollar"),
            (account!("gbp"), "British pound sterling"),
            (account!("euro"), "Euro"),
        ];
        for (i, (symbol, description)) in fiat.into_iter().enumerate() {
            let asset = Asset::get_by_symbol_assert(symbol);
            assert_eq!(asset.id, (i as u16) + 1);
            assert_eq!(asset.symbol, symbol);
            assert_eq!(asset.precision.value(), 4);
            assert_eq!(asset.description.to_string(), description);
            assert_eq!(Asset::get_assert(asset.id).symbol, symbol);
        }

        let gold = Asset::get_by_symbol_assert(account!("gold"));
        assert_eq!(gold.id, 5);
        assert_eq!(gold.precision.value(), 6);
        assert_eq!(
            gold.description.to_string(),
            "1.000000 = 1 gram of gold"
        );

        let silver = Asset::get_by_symbol_assert(account!("silver"));
        assert_eq!(silver.id, 6);
        assert_eq!(silver.precision.value(), 6);
        assert_eq!(
            silver.description.to_string(),
            "1.000000 = 1 gram of silver"
        );

        let more_fiat = [
            (account!("cad"), 7u16, 4u8, "Canadian dollar"),
            (account!("chf"), 8, 4, "Swiss franc"),
            (account!("jpy"), 9, 2, "Japanese yen"),
            (account!("nzd"), 10, 4, "New Zealand dollar"),
        ];
        for (symbol, id, prec, description) in more_fiat {
            let asset = Asset::get_by_symbol_assert(symbol);
            assert_eq!(asset.id, id);
            assert_eq!(asset.precision.value(), prec);
            assert_eq!(asset.description.to_string(), description);
        }

        let btc = Asset::get_by_symbol_assert(account!("btc"));
        assert_eq!(btc.id, 11);
        assert_eq!(btc.precision.value(), 8);
        assert_eq!(btc.description.to_string(), "1.00000000 = 1 Bitcoin");

        let eth = Asset::get_by_symbol_assert(account!("eth"));
        assert_eq!(eth.id, 12);
        assert_eq!(eth.precision.value(), 8);
        assert_eq!(eth.description.to_string(), "1.00000000 = 1 Ethereum");

        Ok(())
    }

    #[psibase::test_case(packages("Banx"))]
    fn test_add_asset_service_only(chain: psibase::Chain) -> Result<(), psibase::Error> {
        Wrapper::push(&chain).init().get()?;

        let alice = account!("alice");
        chain.new_account(alice).unwrap();

        let prec = Precision::new(2).unwrap();
        let id = Wrapper::push_from(&chain, Wrapper::SERVICE)
            .add_asset(account!("cny"), prec, "Chinese yuan".into())
            .get()?;
        assert_eq!(id, 13);
        let asset = Asset::get_assert(id);
        assert_eq!(asset.symbol, account!("cny"));
        assert_eq!(asset.precision.value(), 2);

        // Non-service sender rejected.
        let result = Wrapper::push_from(&chain, alice)
            .add_asset(account!("krw"), prec, "Korean won".into())
            .get();
        assert!(result.is_err());

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
        assert_eq!(compound_amount(p, 100_000, SECONDS_PER_DAY as u64), 1_000_273);
        // $5.0000 at 20% for 12h: half a daily tick, floor to 0.0013.
        assert_eq!(
            interest_for(50_000, 200_000, 12 * 3600),
            13
        );

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
                usd, Quantity::new(0), PPM_SCALE * 2 / 100, PPM_SCALE, never(),
            )
            .get()?;

        Wrapper::push_from(&chain, alice)
            .path_pay(
                vec![hop(gary, usd), hop(steve, usd)],
                amount,
                Quantity::new(490),
            )
            .get()?;

        assert_eq!(exp(&chain, gary, alice, usd), 500);
        assert_eq!(exp(&chain, steve, gary, usd), 490);

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

        // Alice posts FX quote for her debts AUD→USD (0.70).
        Wrapper::push_from(&chain, alice)
            .st_cur_pol(
                aud,
                usd,
                Quantity::new(0),
                RATE_SCALE * 70 / 100,
                0,
                never(),
            )
            .get()?;
        // Gary routes same-asset USD to Steve (no fee).
        Wrapper::push_from(&chain, gary)
            .st_glb_fwd(
                usd, Quantity::new(0), 0, PPM_SCALE, never(),
            )
            .get()?;

        Wrapper::push_from(&chain, alice)
            .path_pay(
                vec![hop(gary, aud), hop(steve, usd)],
                Quantity::new(1_000),
                Quantity::new(700),
            )
            .get()?;

        // After implied convert, Alice owes Gary USD (not AUD).
        assert_eq!(exp(&chain, gary, alice, aud), 0);
        assert_eq!(exp(&chain, gary, alice, usd), 700);
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
                aud, Quantity::new(0), PPM_SCALE * 5 / 100, PPM_SCALE, never(),
            )
            .get()?;
        // John → Mike, USD (after convert), no fee
        Wrapper::push_from(&chain, john)
            .st_glb_fwd(
                usd, Quantity::new(0), 0, PPM_SCALE, never(),
            )
            .get()?;
        // Mike → Brandon, USD, 1% hop fee
        Wrapper::push_from(&chain, mike)
            .st_glb_fwd(
                usd, Quantity::new(0), PPM_SCALE * 1 / 100, PPM_SCALE, never(),
            )
            .get()?;
        // Mitchell posts convert AUD→USD at 0.65 (applied when path hits USD hop)
        Wrapper::push_from(&chain, mitchell)
            .st_cur_pol(
                aud,
                usd,
                Quantity::new(0),
                RATE_SCALE * 65 / 100,
                0,
                never(),
            )
            .get()?;

        // 10_000 AUD:
        //   Zac owes Mitchell 10_000 AUD
        //   Mitchell owes John  9_500 AUD  (5% fee) then convert → 6_175 USD
        //   John owes Mike      6_175 USD
        //   Mike owes Brandon   6_113 USD  (1% fee)
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
            )
            .get()?;

        // AUD book
        assert_eq!(
            exp(&chain, mitchell, zac, aud),
            10_000,
            "Zac owes Mitchell 10000 AUD"
        );
        // Mitchell→John claim converted to USD
        assert_eq!(
            exp(&chain, john, mitchell, aud),
            0,
            "Mitchell→John AUD cleared by convert"
        );
        assert_eq!(
            exp(&chain, john, mitchell, usd),
            6_175,
            "Mitchell owes John 6175 USD after convert"
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
                aud, Quantity::new(0), PPM_SCALE * 5 / 100, PPM_SCALE, never(),
            )
            .get()?;
        Wrapper::push_from(&chain, john)
            .st_glb_fwd(
                usd, Quantity::new(0), 0, PPM_SCALE, never(),
            )
            .get()?;
        Wrapper::push_from(&chain, mike)
            .st_glb_fwd(
                usd, Quantity::new(0), PPM_SCALE * 1 / 100, PPM_SCALE, never(),
            )
            .get()?;
        Wrapper::push_from(&chain, mitchell)
            .st_cur_pol(
                aud,
                usd,
                Quantity::new(0),
                RATE_SCALE * 65 / 100,
                0,
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
            .path_pay(vec![hop(gary, aud)], Quantity::new(100), Quantity::new(100))
            .get()?;

        Wrapper::push_from(&chain, alice)
            .st_cur_pol(
                aud,
                usd,
                Quantity::new(0),
                RATE_SCALE * 50 / 100,
                0,
                never(),
            )
            .get()?;

        Wrapper::push_from(&chain, gary)
            .convert(alice, aud, usd, Quantity::new(100), Quantity::new(50))
            .get()?;

        assert_eq!(exp(&chain, gary, alice, aud), 0);
        assert_eq!(exp(&chain, gary, alice, usd), 50);

        Ok(())
    }

    /// Reverse claim in the destination asset is cancelled by convert.
    #[psibase::test_case(packages("Banx"))]
    fn test_convert_autonets_reverse_to_asset(
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
            .path_pay(vec![hop(gary, aud)], Quantity::new(100), Quantity::new(100))
            .get()?;
        // Gary already owes Alice 80 USD.
        Wrapper::push_from(&chain, gary)
            .deposit(alice, usd, Quantity::new(80), 0)
            .get()?;
        assert_eq!(exp(&chain, alice, gary, usd), 80);

        Wrapper::push_from(&chain, alice)
            .st_cur_pol(aud, usd, Quantity::new(0), RATE_SCALE, 0, never())
            .get()?;
        Wrapper::push_from(&chain, gary)
            .convert(alice, aud, usd, Quantity::new(100), Quantity::new(100))
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
            .st_glb_fwd(
                usd, Quantity::new(50), 0, PPM_SCALE, never(),
            )
            .get()?;

        let result = Wrapper::push_from(&chain, alice)
            .path_pay(
                vec![hop(gary, usd), hop(steve, usd)],
                Quantity::new(100),
                Quantity::new(80),
            )
            .get();
        assert!(result.is_err());

        Wrapper::push_from(&chain, alice)
            .path_pay(
                vec![hop(gary, usd), hop(steve, usd)],
                Quantity::new(100),
                Quantity::new(50),
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
            .path_pay(vec![hop(bob, usd)], amount, amount)
            .get()?;

        Wrapper::push_from(&chain, bob)
            .deposit(alice, usd, amount, 0)
            .get()?;

        assert_eq!(exp(&chain, bob, alice, usd), 0);
        assert_eq!(exp(&chain, alice, bob, usd), 0);

        Ok(())
    }

    /// path_pay / CreditLine::debit auto-nets mutual claims on the pair.
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
            )
            .get()?;
        Wrapper::push_from(&chain, bob)
            .path_pay(
                vec![hop(alice, usd)],
                Quantity::new(40),
                Quantity::new(40),
            )
            .get()?;
        assert_eq!(exp(&chain, bob, alice, usd), 60);
        assert_eq!(exp(&chain, alice, bob, usd), 0);

        Ok(())
    }

    /// Alice holds Bob debt, sells to Peter under Peter's takeout offer.
    /// Peter takes Bob face; Alice gets face after fees as claim on Peter.
    #[psibase::test_case(packages("Banx"))]
    fn test_sell_claim_takeout(chain: psibase::Chain) -> Result<(), psibase::Error> {
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
            .st_crd_lne(bob, usd, Quantity::new(10_000), false, 0, 0)
            .get()?;
        // Global takeout: 5% take fee (no forward offer needed).
        Wrapper::push_from(&chain, peter)
            .st_glb_tko(
                usd, Quantity::new(0), PPM_SCALE * 5 / 100, never(),
            )
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

    #[psibase::test_case(packages("Banx"))]
    fn test_specific_takeout_does_not_block_global_forward(
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
        // Specific takeout must not affect path forward.
        Wrapper::push_from(&chain, gary)
            .st_tko_ofr(
                steve, usd, Quantity::new(0), 0, never(),
            )
            .get()?;
        Wrapper::push_from(&chain, gary)
            .st_glb_fwd(
                usd, Quantity::new(0), PPM_SCALE * 2 / 100, PPM_SCALE, never(),
            )
            .get()?;

        Wrapper::push_from(&chain, alice)
            .path_pay(
                vec![hop(gary, usd), hop(steve, usd)],
                Quantity::new(500),
                Quantity::new(490),
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
                steve, usd, Quantity::new(0), 0, PPM_SCALE, TimePointSec { seconds: 1 },
            )
            .get()?;
        Wrapper::push_from(&chain, gary)
            .st_glb_fwd(
                usd, Quantity::new(10), 0, PPM_SCALE, never(),
            )
            .get()?;

        Wrapper::push_from(&chain, alice)
            .path_pay(
                vec![hop(gary, usd), hop(steve, usd)],
                Quantity::new(100),
                Quantity::new(90),
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
            .st_glb_fwd(usd, Quantity::new(0), 0, 10_000, never())
            .get()?;

        let result = Wrapper::push_from(&chain, alice)
            .path_pay(
                vec![hop(gary, usd), hop(steve, usd)],
                Quantity::new(100),
                Quantity::new(0),
            )
            .get();
        assert!(result.is_err());
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
            .path_pay(vec![hop(bob, usd)], Quantity::new(60), Quantity::new(60))
            .get()?;
        let line = CreditLine::get_assert(bob, alice, usd);
        assert_eq!(line.limit.value, 100);
        assert_eq!(line.remaining.value, 40);
        assert_eq!(exp(&chain, bob, alice, usd), 60);
        assert!(exp(&chain, bob, alice, usd) <= line.limit.value);

        // Leftover grant is 40, not 40-after-shrunk-cap.
        Wrapper::push_from(&chain, alice)
            .path_pay(vec![hop(bob, usd)], Quantity::new(40), Quantity::new(40))
            .get()?;
        assert_eq!(exp(&chain, bob, alice, usd), 100);
        assert_eq!(CreditLine::get_assert(bob, alice, usd).remaining.value, 0);

        // Repay does not restore grant.
        Wrapper::push_from(&chain, bob)
            .deposit(alice, usd, Quantity::new(100), 0)
            .get()?;
        assert_eq!(exp(&chain, bob, alice, usd), 0);
        let over = Wrapper::push_from(&chain, alice)
            .path_pay(vec![hop(bob, usd)], Quantity::new(1), Quantity::new(1))
            .get();
        assert!(over.is_err());
        Ok(())
    }

    #[psibase::test_case(packages("Banx"))]
    fn test_sell_claim_consumes_depleting_grant(
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
            .st_crd_lne(bob, usd, Quantity::new(100), true, 0, 0)
            .get()?;
        Wrapper::push_from(&chain, peter)
            .st_glb_tko(usd, Quantity::new(0), 0, never())
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
            .path_pay(vec![hop(gary, aud)], Quantity::new(100), Quantity::new(100))
            .get()?;

        Wrapper::push_from(&chain, alice)
            .st_cur_pol(aud, usd, Quantity::new(0), RATE_SCALE * 50 / 100, 0, never())
            .get()?;
        Wrapper::push_from(&chain, gary)
            .st_cur_pol(aud, usd, Quantity::new(0), RATE_SCALE * 80 / 100, 0, never())
            .get()?;

        // Gary holds the claim; Alice is the debtor. Use Alice's 0.50 quote.
        Wrapper::push_from(&chain, gary)
            .convert(alice, aud, usd, Quantity::new(100), Quantity::new(50))
            .get()?;
        assert_eq!(exp(&chain, gary, alice, aud), 0);
        assert_eq!(exp(&chain, gary, alice, usd), 50);
        Ok(())
    }

    #[psibase::test_case(packages("Banx"))]
    fn test_path_pay_fx_after_full_reverse_net_fails_min_return(
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
        Wrapper::push_from(&chain, alice)
            .st_cur_pol(aud, usd, Quantity::new(0), RATE_SCALE * 70 / 100, 0, never())
            .get()?;
        Wrapper::push_from(&chain, gary)
            .st_glb_fwd(usd, Quantity::new(0), 0, PPM_SCALE, never())
            .get()?;
        // Reverse AUD book: Gary owes Alice 1000. Hop-0 debit nets it away.
        Wrapper::push_from(&chain, gary)
            .deposit(alice, aud, Quantity::new(1_000), 0)
            .get()?;

        let result = Wrapper::push_from(&chain, alice)
            .path_pay(
                vec![hop(gary, aud), hop(steve, usd)],
                Quantity::new(1_000),
                Quantity::new(700),
            )
            .get();
        assert!(result.is_err());
        // Reverted: reverse deposit remains; no new path legs.
        assert_eq!(exp(&chain, alice, gary, aud), 1_000);
        assert_eq!(exp(&chain, gary, alice, aud), 0);
        assert_eq!(exp(&chain, steve, gary, usd), 0);
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
        Wrapper::push_from(&chain, alice)
            .st_cur_pol(aud, usd, Quantity::new(0), RATE_SCALE * 70 / 100, 0, never())
            .get()?;
        Wrapper::push_from(&chain, gary)
            .st_glb_fwd(usd, Quantity::new(0), 0, PPM_SCALE, never())
            .get()?;
        Wrapper::push_from(&chain, gary)
            .deposit(alice, aud, Quantity::new(400), 0)
            .get()?;

        Wrapper::push_from(&chain, alice)
            .path_pay(
                vec![hop(gary, aud), hop(steve, usd)],
                Quantity::new(1_000),
                Quantity::new(420),
            )
            .get()?;
        // 1000 draw nets 400 reverse → 600 AUD converts at 0.70 → 420 USD.
        assert_eq!(exp(&chain, gary, alice, aud), 0);
        assert_eq!(exp(&chain, gary, alice, usd), 420);
        assert_eq!(exp(&chain, steve, gary, usd), 420);
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
        assert!(Wrapper::push_from(&chain, alice)
            .st_crd_lne(account!("bob"), 99, Quantity::new(100), false, 0, 0)
            .get()
            .is_err());
        assert!(Wrapper::push_from(&chain, alice)
            .st_crd_lne(account!("bob"), usd, Quantity::new(100), false, PPM_SCALE + 1, 0)
            .get()
            .is_err());
        assert!(Wrapper::push_from(&chain, alice)
            .deposit(alice, usd, Quantity::new(1), 0)
            .get()
            .is_err());
        assert!(Wrapper::push_from(&chain, alice)
            .deposit(account!("bob"), usd, Quantity::new(0), 0)
            .get()
            .is_err());
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
            .deposit(alice, usd, Quantity::new(1_000_000), 100_000)
            .get()?;
        Wrapper::push_from(&chain, bob)
            .deposit(alice, usd, Quantity::new(1_000_000), 10_000)
            .get()?;

        chain.start_block_after(Seconds::new(SECONDS_PER_YEAR as i64).into());
        // Live interest — no accrue action needed.
        assert_eq!(exp(&chain, alice, bob, usd), 2_114_819);

        // Net the 10% bucket's interest first (highest rate).
        Wrapper::push_from(&chain, alice)
            .deposit(bob, usd, Quantity::new(104_964), 0)
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
            .deposit(alice, usd, Quantity::new(1_000_000), 100_000)
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
            .deposit(alice, usd, Quantity::new(1_000), 0)
            .get()?;
        Wrapper::push_from(&chain, peter)
            .st_crd_lne(bob, usd, Quantity::new(10_000), false, 0, 0)
            .get()?;
        Wrapper::push_from(&chain, peter)
            .st_glb_tko(
                usd, Quantity::new(0), PPM_SCALE * 5 / 100, never(),
            )
            .get()?;
        Wrapper::push_from(&chain, peter)
            .st_tko_ofr(bob, usd, Quantity::new(0), 0, never())
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
            .st_crd_lne(alice, usd, Quantity::new(10_000_000), false, 100_000, WEEK_SECS)
            .get()?;
        Wrapper::push_from(&chain, alice)
            .path_pay(
                vec![hop(bob, usd)],
                Quantity::new(1_000_000),
                Quantity::new(1_000_000),
            )
            .get()?;

        chain.start_block_after(Seconds::new(12 * 3600).into());
        assert_eq!(exp(&chain, bob, alice, usd), 1_000_000);

        // 8 days from origination (7d grace + 1d charged).
        chain.start_block_after(Seconds::new(8 * 86_400 - 12 * 3600).into());
        assert_eq!(exp(&chain, bob, alice, usd), 1_002_191);
        Ok(())
    }

    #[psibase::test_case(packages("Banx"))]
    fn test_grace_repay_to_zero_waives(
        chain: psibase::Chain,
    ) -> Result<(), psibase::Error> {
        Wrapper::push(&chain).init().get()?;
        let alice = account!("alice");
        let bob = account!("bob");
        chain.new_account(alice).unwrap();
        chain.new_account(bob).unwrap();
        let usd = Asset::get_by_symbol_assert(account!("usd")).id;

        Wrapper::push_from(&chain, bob)
            .st_crd_lne(alice, usd, Quantity::new(10_000_000), false, 100_000, WEEK_SECS)
            .get()?;
        Wrapper::push_from(&chain, alice)
            .path_pay(
                vec![hop(bob, usd)],
                Quantity::new(1_000_000),
                Quantity::new(1_000_000),
            )
            .get()?;

        chain.start_block_after(Seconds::new(86_400).into());
        assert_eq!(exp(&chain, bob, alice, usd), 1_000_000);
        Wrapper::push_from(&chain, bob)
            .deposit(alice, usd, Quantity::new(1_000_000), 0)
            .get()?;
        assert_eq!(exp(&chain, bob, alice, usd), 0);

        chain.start_block_after(Seconds::new(i64::from(WEEK_SECS)).into());
        assert_eq!(exp(&chain, bob, alice, usd), 0);
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
            .st_crd_lne(alice, usd, Quantity::new(10_000_000), false, 100_000, WEEK_SECS)
            .get()?;
        Wrapper::push_from(&chain, alice)
            .path_pay(
                vec![hop(bob, usd)],
                Quantity::new(1_000_000),
                Quantity::new(1_000_000),
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

    /// Same poster/asset: 5% path hop, 0% takeout. Each action uses its own row.
    #[psibase::test_case(packages("Banx"))]
    fn test_forward_and_takeout_fees_independent(
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
            )
            .get()?;
        Wrapper::push_from(&chain, gary)
            .st_glb_tko(usd, Quantity::new(0), 0, never())
            .get()?;

        Wrapper::push_from(&chain, alice)
            .path_pay(
                vec![hop(gary, usd), hop(steve, usd)],
                Quantity::new(1_000),
                Quantity::new(950),
            )
            .get()?;
        assert_eq!(exp(&chain, steve, gary, usd), 950);

        Wrapper::push_from(&chain, bob)
            .deposit(carol, usd, Quantity::new(1_000), 0)
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
    fn test_path_pay_unwinds_reverse_claims(
        chain: psibase::Chain,
    ) -> Result<(), psibase::Error> {
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
            .st_glb_fwd(usd, Quantity::new(0), 0, PPM_SCALE, never())
            .get()?;

        Wrapper::push_from(&chain, a)
            .path_pay(
                vec![hop(b, usd), hop(c, usd)],
                Quantity::new(1_000),
                Quantity::new(1_000),
            )
            .get()?;
        assert_eq!(exp(&chain, b, a, usd), 1_000);
        assert_eq!(exp(&chain, c, b, usd), 1_000);

        Wrapper::push_from(&chain, c)
            .path_pay(
                vec![hop(b, usd), hop(a, usd)],
                Quantity::new(1_000),
                Quantity::new(1_000),
            )
            .get()?;
        assert_eq!(exp(&chain, b, a, usd), 0);
        assert_eq!(exp(&chain, c, b, usd), 0);
        assert_eq!(exp(&chain, a, b, usd), 0);
        assert_eq!(exp(&chain, b, c, usd), 0);
        Ok(())
    }
}
