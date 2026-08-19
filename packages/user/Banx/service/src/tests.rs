#![allow(non_snake_case)]

#[cfg(test)]
mod tests {
    use crate::interest::{compound_amount, interest_for, SECONDS_PER_DAY, SECONDS_PER_YEAR};
    use crate::tables::{
        Asset, CreditLine, Obligation, PairCycle, PathHop, PayRequest, PPM_SCALE, RATE_SCALE,
    };
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
        assert_eq!(gold.description.to_string(), "1.000000 = 1 gram of gold");

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
        assert_eq!(
            compound_amount(p, 100_000, SECONDS_PER_DAY as u64),
            1_000_273
        );
        // $5.0000 at 20% for 12h: half a daily tick, floor to 0.0013.
        assert_eq!(interest_for(50_000, 200_000, 12 * 3600), 13);

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
        // John prices AUD→USD but does not rebook Mitchell's AUD tab.
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

    /// path_pay / CreditLine::path_debit auto-nets mutual claims on the pair.
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
            .st_glb_buy(usd, Quantity::new(0), (PPM_SCALE * 5 / 100) as i32, never())
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
            .st_buy_clm(steve, usd, Quantity::new(0), 0, never())
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

        // Leftover grant is 40, not 40-after-shrunk-cap.
        Wrapper::push_from(&chain, alice)
            .path_pay(vec![hop(bob, usd)], Quantity::new(40), Quantity::new(40), 0)
            .get()?;
        assert_eq!(exp(&chain, bob, alice, usd), 100);
        assert_eq!(CreditLine::get_assert(bob, alice, usd).remaining.value, 0);

        // Repay does not restore grant.
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
            .deposit(alice, usd, Quantity::new(50), 0, 0)
            .get()?;
        Wrapper::push_from(&chain, peter)
            .st_crd_lne(bob, usd, Quantity::new(100), true, 0, 0)
            .get()?;
        Wrapper::push_from(&chain, peter)
            .st_glb_buy(usd, Quantity::new(0), 0, never())
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
            .st_glb_buy(usd, Quantity::new(0), 0, never())
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
            .st_glb_buy(usd, Quantity::new(0), 0, never())
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
                never(),
            )
            .get()?;

        // Gary holds the claim; his 0.80 quote wins. Alice's 0.50 is ignored.
        Wrapper::push_from(&chain, gary)
            .convert(alice, aud, usd, Quantity::new(100), Quantity::new(80))
            .get()?;
        assert_eq!(exp(&chain, gary, alice, aud), 0);
        assert_eq!(exp(&chain, gary, alice, usd), 80);
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
        assert_eq!(exp(&chain, steve, gary, usd), 700, "Gary keeps USD claim on the hop");
        assert_eq!(exp(&chain, steve, gary, gbp), 0, "Steve prices GBP; does not rebook USD");
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
        assert_eq!(exp(&chain, gary, alice, usd), 0, "Alice is not rebooked to USD");
        assert_eq!(exp(&chain, steve, gary, usd), 700, "Gary's 0.70, not Alice's 0.50");
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
            .st_crd_lne(
                account!("bob"),
                usd,
                Quantity::new(100),
                false,
                PPM_SCALE + 1,
                0
            )
            .get()
            .is_err());
        assert!(Wrapper::push_from(&chain, alice)
            .deposit(alice, usd, Quantity::new(1), 0, 0)
            .get()
            .is_err());
        assert!(Wrapper::push_from(&chain, alice)
            .deposit(account!("bob"), usd, Quantity::new(0), 0, 0)
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
            .st_glb_buy(usd, Quantity::new(0), (PPM_SCALE * 5 / 100) as i32, never())
            .get()?;
        Wrapper::push_from(&chain, peter)
            .st_buy_clm(bob, usd, Quantity::new(0), 0, never())
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
            .st_glb_buy(usd, Quantity::new(0), 0, never())
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
        assert_eq!(PayRequest::get_assert(id).remaining.value, 0);
        assert_eq!(exp(&chain, steve, gary, usd), 400);
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

        // Gary is not the named payer.
        assert!(Wrapper::push_from(&chain, gary)
            .path_pay(
                vec![hop(steve, usd)],
                Quantity::new(100),
                Quantity::new(100),
                id,
            )
            .get()
            .is_err());
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
        assert_eq!(PayRequest::get_assert(id).remaining.value, 0);
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

    #[psibase::test_case(packages("Banx"))]
    fn test_settle_auth_debtor_pulls_capped(chain: psibase::Chain) -> Result<(), psibase::Error> {
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

        let id = Wrapper::push_from(&chain, bob)
            .st_req(
                PayRequest::SETTLE_AUTH,
                alice,
                usd,
                Quantity::new(2_000),
                "tab".into(),
                never(),
            )
            .get()?;

        // Creditor cannot pull their own settle-auth.
        assert!(Wrapper::push_from(&chain, bob)
            .fl_stl(id, Quantity::new(100))
            .get()
            .is_err());

        Wrapper::push_from(&chain, alice)
            .fl_stl(id, Quantity::new(2_000))
            .get()?;
        // Capped at live exposure 1000, not the 2000 auth.
        assert_eq!(exp(&chain, bob, alice, usd), 0);
        assert_eq!(exp(&chain, alice, bob, usd), 0);
        assert_eq!(PayRequest::get_assert(id).remaining.value, 1_000);

        // Nothing left to settle; leftover auth cannot mint a claim on Bob.
        assert!(Wrapper::push_from(&chain, alice)
            .fl_stl(id, Quantity::new(1_000))
            .get()
            .is_err());
        assert_eq!(exp(&chain, alice, bob, usd), 0);
        Ok(())
    }

    #[psibase::test_case(packages("Banx"))]
    fn test_settle_auth_partial(chain: psibase::Chain) -> Result<(), psibase::Error> {
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
        let id = Wrapper::push_from(&chain, bob)
            .st_req(
                PayRequest::SETTLE_AUTH,
                alice,
                usd,
                Quantity::new(1_000),
                "".into(),
                never(),
            )
            .get()?;
        Wrapper::push_from(&chain, alice)
            .fl_stl(id, Quantity::new(400))
            .get()?;
        assert_eq!(exp(&chain, bob, alice, usd), 600);
        assert_eq!(PayRequest::get_assert(id).remaining.value, 600);
        Ok(())
    }

    /// Only the claim holder may exercise `convert`. Debtor-posted FX is a
    /// quote the creditor accepts — not a self-serve write-down / APR reset.
    #[psibase::test_case(packages("Banx"))]
    fn test_want_convert_rejects_debtor(chain: psibase::Chain) -> Result<(), psibase::Error> {
        Wrapper::push(&chain).init().get()?;
        let alice = account!("alice");
        let gary = account!("gary");
        chain.new_account(alice).unwrap();
        chain.new_account(gary).unwrap();
        let aud = Asset::get_by_symbol_assert(account!("aud")).id;
        let usd = Asset::get_by_symbol_assert(account!("usd")).id;

        // gary extends a line to alice for $1 AUD, 20% interest APR.
        Wrapper::push_from(&chain, gary)
            .st_crd_lne(alice, aud, Quantity::new(10000), false, 200_000, 0)
            .get()?;
        // Alice sends 100 to gary in australian dollars, creating a debt.
        Wrapper::push_from(&chain, alice)
            .path_pay(vec![hop(gary, aud)], 100.into(), 100.into(), 0)
            .get()?;
        // Alice sets up a USD policy with herself, at 1:1 scale
        Wrapper::push_from(&chain, alice)
            .st_cur_pol(aud, usd, 0.into(), RATE_SCALE, 0, never())
            .get()?;

        let stolen =
            Wrapper::push_from(&chain, alice).convert(gary, aud, usd, 100.into(), 100.into());
        let err = stolen
            .trace
            .error
            .as_deref()
            .unwrap_or("(no error — convert succeeded)");
        assert!(
            err.contains("only the creditor can convert"),
            "test_want_convert_rejects_debtor: want \"only the creditor can convert\", got {err}"
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

    /// Editing a depleting line (APR / limit) must not refill a spent grant.
    #[psibase::test_case(packages("Banx"))]
    fn test_want_deplete_edit_does_not_refill_grant(
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
            "test_want_deplete_edit_does_not_refill_grant: APR-only upsert reset remaining \
             to the limit; spent grant must stay 40"
        );

        Wrapper::push_from(&chain, bob)
            .st_crd_lne(alice, usd, Quantity::new(200), true, 10_000, 0)
            .get()?;
        assert_eq!(
            CreditLine::get_assert(bob, alice, usd).remaining.value,
            40,
            "test_want_deplete_edit_does_not_refill_grant: raising the limit refilled remaining"
        );
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
}
