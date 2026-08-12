#![allow(non_snake_case)]

#[cfg(test)]
mod tests {
    use crate::tables::interest::{accrue_delta, ACCRUAL_DENOM};
    use crate::tables::{Asset, Obligation, PathHop, PPM_SCALE, RATE_SCALE};
    use crate::Wrapper;
    use psibase::services::tokens::{Precision, Quantity};
    use psibase::*;

    fn hop(account: AccountNumber, asset_id: u16) -> PathHop {
        PathHop { account, asset_id }
    }

    fn never() -> TimePointSec {
        TimePointSec { seconds: 0 }
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
            "Gold; 1.000000 = 1 gram of gold"
        );

        let silver = Asset::get_by_symbol_assert(account!("silver"));
        assert_eq!(silver.id, 6);
        assert_eq!(silver.precision.value(), 6);
        assert_eq!(
            silver.description.to_string(),
            "Silver; 1.000000 = 1 gram of silver"
        );

        Ok(())
    }

    #[psibase::test_case(packages("Banx"))]
    fn test_add_asset_service_only(chain: psibase::Chain) -> Result<(), psibase::Error> {
        Wrapper::push(&chain).init().get()?;

        let alice = account!("alice");
        chain.new_account(alice).unwrap();

        let prec = Precision::new(2).unwrap();
        let id = Wrapper::push_from(&chain, Wrapper::SERVICE)
            .add_asset(account!("jpy"), prec, "Japanese yen".into())
            .get()?;
        assert_eq!(id, 7);
        let asset = Asset::get_assert(id);
        assert_eq!(asset.symbol, account!("jpy"));
        assert_eq!(asset.precision.value(), 2);

        // Non-service sender rejected.
        let result = Wrapper::push_from(&chain, alice)
            .add_asset(account!("cny"), prec, "Chinese yuan".into())
            .get();
        assert!(result.is_err());

        Ok(())
    }

    #[psibase::test_case(packages("Banx"))]
    fn test_interest_path_independence(_chain: psibase::Chain) -> Result<(), psibase::Error> {
        let principal = 1_000_000_000u64;
        let rate_ppm = 50_000u32;
        let steps = [1u64, 7, 60, 3_600, 86_400, PPM_SCALE as u64];

        let mut rem_split = 0u64;
        let mut interest_split = 0u64;
        let mut total_dt = 0u64;
        for dt in steps {
            let (d, r) = accrue_delta(principal, rate_ppm, dt, rem_split);
            interest_split = interest_split.checked_add(d).unwrap();
            rem_split = r;
            total_dt = total_dt.checked_add(dt).unwrap();
        }

        let (interest_once, rem_once) = accrue_delta(principal, rate_ppm, total_dt, 0);
        assert_eq!(interest_split, interest_once);
        assert_eq!(rem_split, rem_once);

        let expect = (principal as u128) * (rate_ppm as u128) * (total_dt as u128) / ACCRUAL_DENOM;
        assert_eq!(interest_once as u128, expect);

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
            .st_crd_lne(alice, usd, Quantity::new(10_000), false, 0)
            .get()?;
        Wrapper::push_from(&chain, steve)
            .st_crd_lne(gary, usd, Quantity::new(10_000), false, 0)
            .get()?;

        Wrapper::push_from(&chain, gary)
            .st_glb_rte(
                usd,
                Quantity::new(0),
                (PPM_SCALE * 2 / 100),
                PPM_SCALE,
                never(),
            )
            .get()?;

        Wrapper::push_from(&chain, alice)
            .path_pay(
                vec![hop(gary, usd), hop(steve, usd)],
                amount,
                Quantity::new(490),
            )
            .get()?;

        assert_eq!(Obligation::exposure(gary, alice, usd).value, 500);
        assert_eq!(Obligation::exposure(steve, gary, usd).value, 490);

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
            .st_crd_lne(alice, aud, Quantity::new(10_000), false, 0)
            .get()?;
        Wrapper::push_from(&chain, steve)
            .st_crd_lne(gary, usd, Quantity::new(10_000), false, 0)
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
            .st_glb_rte(
                usd,
                Quantity::new(0),
                0,
                PPM_SCALE,
                never(),
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
        assert_eq!(Obligation::exposure(gary, alice, aud).value, 0);
        assert_eq!(Obligation::exposure(gary, alice, usd).value, 700);
        assert_eq!(Obligation::exposure(steve, gary, usd).value, 700);

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
            .st_crd_lne(zac, aud, limit, false, 0)
            .get()?;
        // John ← Mitchell (AUD)
        Wrapper::push_from(&chain, john)
            .st_crd_lne(mitchell, aud, limit, false, 0)
            .get()?;
        // Mike ← John (USD) — capacity for AUD→USD hop
        Wrapper::push_from(&chain, mike)
            .st_crd_lne(john, usd, limit, false, 0)
            .get()?;
        // Brandon ← Mike (USD)
        Wrapper::push_from(&chain, brandon)
            .st_crd_lne(mike, usd, limit, false, 0)
            .get()?;

        // --- Routing (same-asset fees) ---
        // Mitchell → John, AUD, 5% hop fee
        Wrapper::push_from(&chain, mitchell)
            .st_glb_rte(
                aud,
                Quantity::new(0),
                PPM_SCALE * 5 / 100,
                PPM_SCALE,
                never(),
            )
            .get()?;
        // John → Mike, USD (after convert), no fee
        Wrapper::push_from(&chain, john)
            .st_glb_rte(
                usd,
                Quantity::new(0),
                0,
                PPM_SCALE,
                never(),
            )
            .get()?;
        // Mike → Brandon, USD, 1% hop fee
        Wrapper::push_from(&chain, mike)
            .st_glb_rte(
                usd,
                Quantity::new(0),
                PPM_SCALE * 1 / 100,
                PPM_SCALE,
                never(),
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
            Obligation::exposure(mitchell, zac, aud).value,
            10_000,
            "Zac owes Mitchell 10000 AUD"
        );
        // Mitchell→John claim converted to USD
        assert_eq!(
            Obligation::exposure(john, mitchell, aud).value,
            0,
            "Mitchell→John AUD cleared by convert"
        );
        assert_eq!(
            Obligation::exposure(john, mitchell, usd).value,
            6_175,
            "Mitchell owes John 6175 USD after convert"
        );
        // USD path
        assert_eq!(
            Obligation::exposure(mike, john, usd).value,
            6_175,
            "John owes Mike 6175 USD"
        );
        assert_eq!(
            Obligation::exposure(brandon, mike, usd).value,
            6_113,
            "Mike owes Brandon 6113 USD after 1% fee"
        );

        assert_eq!(Obligation::exposure(mike, john, aud).value, 0);
        assert_eq!(Obligation::exposure(brandon, mike, aud).value, 0);

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
            .st_crd_lne(zac, aud, limit, false, 0)
            .get()?;
        Wrapper::push_from(&chain, john)
            .st_crd_lne(mitchell, aud, limit, false, 0)
            .get()?;
        Wrapper::push_from(&chain, mike)
            .st_crd_lne(john, usd, limit, false, 0)
            .get()?;
        Wrapper::push_from(&chain, brandon)
            .st_crd_lne(mike, usd, limit, false, 0)
            .get()?;

        Wrapper::push_from(&chain, mitchell)
            .st_glb_rte(
                aud,
                Quantity::new(0),
                PPM_SCALE * 5 / 100,
                PPM_SCALE,
                never(),
            )
            .get()?;
        Wrapper::push_from(&chain, john)
            .st_glb_rte(
                usd,
                Quantity::new(0),
                0,
                PPM_SCALE,
                never(),
            )
            .get()?;
        Wrapper::push_from(&chain, mike)
            .st_glb_rte(
                usd,
                Quantity::new(0),
                PPM_SCALE * 1 / 100,
                PPM_SCALE,
                never(),
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

        assert_eq!(Obligation::exposure(mitchell, zac, aud).value, 0);
        assert_eq!(Obligation::exposure(john, mitchell, aud).value, 0);
        assert_eq!(Obligation::exposure(mike, john, usd).value, 0);
        assert_eq!(Obligation::exposure(brandon, mike, usd).value, 0);

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
            .st_crd_lne(alice, aud, Quantity::new(10_000), false, 0)
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

        assert_eq!(Obligation::exposure(gary, alice, aud).value, 0);
        assert_eq!(Obligation::exposure(gary, alice, usd).value, 50);

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
            .st_crd_lne(alice, usd, Quantity::new(1_000), false, 0)
            .get()?;
        Wrapper::push_from(&chain, steve)
            .st_crd_lne(gary, usd, Quantity::new(1_000), false, 0)
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
            .st_crd_lne(alice, usd, Quantity::new(10_000), false, 0)
            .get()?;
        Wrapper::push_from(&chain, steve)
            .st_crd_lne(gary, usd, Quantity::new(10_000), false, 0)
            .get()?;
        Wrapper::push_from(&chain, gary)
            .st_glb_rte(
                usd,
                Quantity::new(50),
                0,
                PPM_SCALE,
                never(),
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
        assert_eq!(Obligation::exposure(steve, gary, usd).value, 50);

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
            .st_crd_lne(alice, usd, Quantity::new(1_000), false, 0)
            .get()?;
        Wrapper::push_from(&chain, alice)
            .path_pay(vec![hop(bob, usd)], amount, amount)
            .get()?;

        Wrapper::push_from(&chain, bob)
            .deposit(alice, usd, amount, 0)
            .get()?;

        assert_eq!(Obligation::exposure(bob, alice, usd).value, 0);
        assert_eq!(Obligation::exposure(alice, bob, usd).value, 0);

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
            .st_crd_lne(alice, usd, Quantity::new(10_000), false, 0)
            .get()?;
        Wrapper::push_from(&chain, alice)
            .st_crd_lne(bob, usd, Quantity::new(10_000), false, 0)
            .get()?;

        // Alice draws 100 on Bob → Bob is creditor, Alice debtor.
        Wrapper::push_from(&chain, alice)
            .path_pay(
                vec![hop(bob, usd)],
                Quantity::new(100),
                Quantity::new(100),
            )
            .get()?;
        assert_eq!(Obligation::exposure(bob, alice, usd).value, 100);
        assert_eq!(Obligation::exposure(alice, bob, usd).value, 0);

        // Bob draws 100 on Alice → reverse claim auto-nets to zero.
        Wrapper::push_from(&chain, bob)
            .path_pay(
                vec![hop(alice, usd)],
                Quantity::new(100),
                Quantity::new(100),
            )
            .get()?;
        assert_eq!(Obligation::exposure(bob, alice, usd).value, 0);
        assert_eq!(Obligation::exposure(alice, bob, usd).value, 0);

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
        assert_eq!(Obligation::exposure(bob, alice, usd).value, 60);
        assert_eq!(Obligation::exposure(alice, bob, usd).value, 0);

        Ok(())
    }
}
