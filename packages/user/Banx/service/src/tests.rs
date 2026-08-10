#![allow(non_snake_case)]

#[cfg(test)]
mod tests {
    use crate::Wrapper;
    use psibase::services::tokens::Quantity;
    use psibase::*;

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
