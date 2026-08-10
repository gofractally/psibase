#![allow(non_snake_case)]

#[cfg(test)]
mod tests {
    use crate::tables::interest::{accrue_delta, ACCRUAL_DENOM};
    use crate::tables::Obligation;
    use crate::Wrapper;
    use psibase::services::tokens::Quantity;
    use psibase::*;

    /// Frequent small accruals must match one accrual over the same interval.
    #[psibase::test_case(packages("Banx"))]
    fn test_interest_path_independence(_chain: psibase::Chain) -> Result<(), psibase::Error> {
        let principal = 1_000_000_000u64;
        let rate_ppm = 50_000u32; // 5% APR
        let steps = [1u64, 7, 60, 3_600, 86_400, 1_000_000];

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
        assert_eq!(
            interest_split, interest_once,
            "split accruals must equal one-shot over the same dt"
        );
        assert_eq!(rem_split, rem_once, "remainder must match after equivalent time");

        let (d0, r0) = accrue_delta(principal, rate_ppm, 0, rem_once);
        assert_eq!(d0, 0);
        assert_eq!(r0, rem_once);

        let expect = (principal as u128) * (rate_ppm as u128) * (total_dt as u128) / ACCRUAL_DENOM;
        assert_eq!(interest_once as u128, expect);

        Ok(())
    }

    /// Alice → Gary → Steve: Gary's routing + Steve's line; fee on second leg.
    #[psibase::test_case(packages("Banx"))]
    fn test_path_pay_alice_gary_steve(chain: psibase::Chain) -> Result<(), psibase::Error> {
        Wrapper::push(&chain).init().get()?;

        let alice = account!("alice");
        let gary = account!("gary");
        let steve = account!("steve");
        chain.new_account(alice).unwrap();
        chain.new_account(gary).unwrap();
        chain.new_account(steve).unwrap();

        let asset_id = 1u32;
        let amount = Quantity::new(500);

        // Gary extends line to Alice; Steve extends line to Gary.
        Wrapper::push_from(&chain, gary)
            .st_crd_lne(alice, asset_id, Quantity::new(10_000), false, 0)
            .get()?;
        Wrapper::push_from(&chain, steve)
            .st_crd_lne(gary, asset_id, Quantity::new(10_000), false, 0)
            .get()?;

        // Gary opts into path-drawing on Steve: 2% fee (20_000 ppm), accept any rate.
        Wrapper::push_from(&chain, gary)
            .st_rte_pol(steve, asset_id, Quantity::new(0), 20_000, 1_000_000)
            .get()?;

        // min_return 490: exact residual after 2% fee on 500.
        Wrapper::push_from(&chain, alice)
            .path_pay(vec![gary, steve], asset_id, amount, Quantity::new(490))
            .get()?;

        // Alice owes Gary 500; Gary owes Steve 490 (2% fee).
        assert_eq!(Obligation::exposure(gary, alice, asset_id).value, 500);
        assert_eq!(Obligation::exposure(steve, gary, asset_id).value, 490);
        assert_eq!(Obligation::exposure(steve, alice, asset_id).value, 0);

        Ok(())
    }

    /// min_return rejects path if intermediate fees leave too little for payee.
    #[psibase::test_case(packages("Banx"))]
    fn test_path_pay_min_return(chain: psibase::Chain) -> Result<(), psibase::Error> {
        Wrapper::push(&chain).init().get()?;

        let alice = account!("alice");
        let gary = account!("gary");
        let steve = account!("steve");
        chain.new_account(alice).unwrap();
        chain.new_account(gary).unwrap();
        chain.new_account(steve).unwrap();

        let asset_id = 1u32;
        Wrapper::push_from(&chain, gary)
            .st_crd_lne(alice, asset_id, Quantity::new(10_000), false, 0)
            .get()?;
        Wrapper::push_from(&chain, steve)
            .st_crd_lne(gary, asset_id, Quantity::new(10_000), false, 0)
            .get()?;
        // Fixed fee 50 on 100 → final 50.
        Wrapper::push_from(&chain, gary)
            .st_rte_pol(steve, asset_id, Quantity::new(50), 0, 1_000_000)
            .get()?;

        // UI expected ~100 but requires min 80 — fails after fee.
        let result = Wrapper::push_from(&chain, alice)
            .path_pay(
                vec![gary, steve],
                asset_id,
                Quantity::new(100),
                Quantity::new(80),
            )
            .get();
        assert!(result.is_err());

        // min_return 50 succeeds.
        Wrapper::push_from(&chain, alice)
            .path_pay(
                vec![gary, steve],
                asset_id,
                Quantity::new(100),
                Quantity::new(50),
            )
            .get()?;
        assert_eq!(Obligation::exposure(steve, gary, asset_id).value, 50);

        Ok(())
    }

    /// Steve's line alone is not enough — Gary must set routing toward Steve.
    #[psibase::test_case(packages("Banx"))]
    fn test_path_pay_requires_intermediate_routing(
        chain: psibase::Chain,
    ) -> Result<(), psibase::Error> {
        Wrapper::push(&chain).init().get()?;

        let alice = account!("alice");
        let gary = account!("gary");
        let steve = account!("steve");
        chain.new_account(alice).unwrap();
        chain.new_account(gary).unwrap();
        chain.new_account(steve).unwrap();

        let asset_id = 1u32;
        Wrapper::push_from(&chain, gary)
            .st_crd_lne(alice, asset_id, Quantity::new(1_000), false, 0)
            .get()?;
        Wrapper::push_from(&chain, steve)
            .st_crd_lne(gary, asset_id, Quantity::new(1_000), false, 0)
            .get()?;

        // No Gary st_rte_pol(steve) — second leg must fail.
        let result = Wrapper::push_from(&chain, alice)
            .path_pay(vec![gary, steve], asset_id, Quantity::new(100), Quantity::new(0))
            .get();
        assert!(result.is_err());

        Ok(())
    }

    /// Path fails if next hop line rate exceeds Gary's max_accept_rate.
    #[psibase::test_case(packages("Banx"))]
    fn test_path_pay_rejects_high_rate(chain: psibase::Chain) -> Result<(), psibase::Error> {
        Wrapper::push(&chain).init().get()?;

        let alice = account!("alice");
        let gary = account!("gary");
        let steve = account!("steve");
        chain.new_account(alice).unwrap();
        chain.new_account(gary).unwrap();
        chain.new_account(steve).unwrap();

        let asset_id = 1u32;
        Wrapper::push_from(&chain, gary)
            .st_crd_lne(alice, asset_id, Quantity::new(1_000), false, 0)
            .get()?;
        // Steve charges 40% APR on Gary's facility.
        Wrapper::push_from(&chain, steve)
            .st_crd_lne(gary, asset_id, Quantity::new(1_000), false, 400_000)
            .get()?;
        // Gary only accepts up to 5%.
        Wrapper::push_from(&chain, gary)
            .st_rte_pol(steve, asset_id, Quantity::new(0), 0, 50_000)
            .get()?;

        let result = Wrapper::push_from(&chain, alice)
            .path_pay(vec![gary, steve], asset_id, Quantity::new(100), Quantity::new(0))
            .get();
        assert!(result.is_err());

        Ok(())
    }

    /// Single-hop path_pay is credit-line only (no routing policy).
    #[psibase::test_case(packages("Banx"))]
    fn test_path_pay_single_hop_line_only(chain: psibase::Chain) -> Result<(), psibase::Error> {
        Wrapper::push(&chain).init().get()?;

        let alice = account!("alice");
        let steve = account!("steve");
        chain.new_account(alice).unwrap();
        chain.new_account(steve).unwrap();

        let asset_id = 1u32;
        Wrapper::push_from(&chain, steve)
            .st_crd_lne(alice, asset_id, Quantity::new(1_000), false, 0)
            .get()?;

        Wrapper::push_from(&chain, alice)
            .path_pay(vec![steve], asset_id, Quantity::new(50), Quantity::new(50))
            .get()?;

        assert_eq!(Obligation::exposure(steve, alice, asset_id).value, 50);

        Ok(())
    }

    /// Deposit auto-nets: full repay clears both directions.
    #[psibase::test_case(packages("Banx"))]
    fn test_deposit_auto_nets_full(chain: psibase::Chain) -> Result<(), psibase::Error> {
        Wrapper::push(&chain).init().get()?;

        let alice = account!("alice");
        let bob = account!("bob");
        chain.new_account(alice).unwrap();
        chain.new_account(bob).unwrap();

        let asset_id = 1u32;
        let amount = Quantity::new(100);

        Wrapper::push_from(&chain, bob)
            .st_crd_lne(alice, asset_id, Quantity::new(1_000), false, 0)
            .get()?;
        Wrapper::push_from(&chain, alice)
            .path_pay(vec![bob], asset_id, amount, amount)
            .get()?;

        assert_eq!(Obligation::exposure(bob, alice, asset_id).value, 100);

        Wrapper::push_from(&chain, bob)
            .deposit(alice, asset_id, amount, 0)
            .get()?;

        assert_eq!(Obligation::exposure(bob, alice, asset_id).value, 0);
        assert_eq!(Obligation::exposure(alice, bob, asset_id).value, 0);

        Ok(())
    }

    /// Partial deposit auto-nets only the overlapping exposure.
    #[psibase::test_case(packages("Banx"))]
    fn test_deposit_auto_nets_partial(chain: psibase::Chain) -> Result<(), psibase::Error> {
        Wrapper::push(&chain).init().get()?;

        let alice = account!("alice");
        let bob = account!("bob");
        chain.new_account(alice).unwrap();
        chain.new_account(bob).unwrap();

        let asset_id = 1u32;

        Wrapper::push_from(&chain, bob)
            .st_crd_lne(alice, asset_id, Quantity::new(10_000), false, 100_000)
            .get()?;
        Wrapper::push_from(&chain, alice)
            .path_pay(vec![bob], asset_id, Quantity::new(100), Quantity::new(100))
            .get()?;

        Wrapper::push_from(&chain, bob)
            .deposit(alice, asset_id, Quantity::new(40), 0)
            .get()?;

        assert_eq!(Obligation::exposure(bob, alice, asset_id).value, 60);
        assert_eq!(Obligation::exposure(alice, bob, asset_id).value, 0);

        Ok(())
    }
}
