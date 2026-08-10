#![allow(non_snake_case)]

#[cfg(test)]
mod tests {
    use crate::tables::interest::{accrue_delta, ACCRUAL_DENOM};
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

        // Same second / zero dt does not move remainder or invent interest.
        let (d0, r0) = accrue_delta(principal, rate_ppm, 0, rem_once);
        assert_eq!(d0, 0);
        assert_eq!(r0, rem_once);

        // Sanity: interest units are principal * rate * t / denom (integer).
        let expect = (principal as u128) * (rate_ppm as u128) * (total_dt as u128) / ACCRUAL_DENOM;
        assert_eq!(interest_once as u128, expect);

        Ok(())
    }

    #[psibase::test_case(packages("Banx"))]
    fn test_hop_stacks_obligations(chain: psibase::Chain) -> Result<(), psibase::Error> {
        Wrapper::push(&chain).init().get()?;

        let alice = account!("alice");
        let bob = account!("bob");
        let carol = account!("carol");
        chain.new_account(alice).unwrap();
        chain.new_account(bob).unwrap();
        chain.new_account(carol).unwrap();

        let asset_id = 1u32;
        let limit = Quantity::new(1_000);
        let amount = Quantity::new(100);
        let rate = 0u32;

        // Bob extends credit to Alice; Carol extends credit to Bob.
        Wrapper::push_from(&chain, bob)
            .st_crd_lne(alice, asset_id, limit, false, rate)
            .get()?;
        Wrapper::push_from(&chain, carol)
            .st_crd_lne(bob, asset_id, limit, false, rate)
            .get()?;

        // Opt both edges into routing (no fixed / ppm fee).
        Wrapper::push_from(&chain, bob)
            .st_rte_pol(alice, asset_id, Quantity::new(0), 0)
            .get()?;
        Wrapper::push_from(&chain, carol)
            .st_rte_pol(bob, asset_id, Quantity::new(0), 0)
            .get()?;

        // Alice pays Carol via Bob: Alice → Bob → Carol.
        Wrapper::push_from(&chain, alice)
            .hop(vec![bob, carol], asset_id, amount)
            .get()?;

        Ok(())
    }

    #[psibase::test_case(packages("Banx"))]
    fn test_hop_requires_routing_policy(chain: psibase::Chain) -> Result<(), psibase::Error> {
        Wrapper::push(&chain).init().get()?;

        let alice = account!("alice");
        let bob = account!("bob");
        chain.new_account(alice).unwrap();
        chain.new_account(bob).unwrap();

        let asset_id = 1u32;
        Wrapper::push_from(&chain, bob)
            .st_crd_lne(alice, asset_id, Quantity::new(100), false, 0)
            .get()?;

        // Line exists but no routing policy — hop must fail.
        let result = Wrapper::push_from(&chain, alice)
            .hop(vec![bob], asset_id, Quantity::new(10))
            .get();
        assert!(result.is_err());

        Ok(())
    }
}
