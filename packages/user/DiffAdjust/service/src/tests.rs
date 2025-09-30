#![allow(non_snake_case)]

#[cfg(test)]
mod tests {
    use crate::Wrapper;
    use psibase::*;

    #[psibase::test_case(packages("DiffAdjust"))]
    fn test_set_thing(mut chain: psibase::Chain) -> Result<(), psibase::Error> {
        chain.set_auto_block_start(false);

        let alice = AccountNumber::from("alice");
        chain.new_account(alice).unwrap();

        let nft_id = Wrapper::push_from(&chain, alice)
            .create(3000, 60, 5, 6, 500, 50000)
            .get()?;

        // Price does not increase after 4
        for _ in 0..4 {
            Wrapper::push_from(&chain, alice).increment(nft_id, 1);
        }
        assert_eq!(Wrapper::push(&chain).get_diff(nft_id).get()?, 3000);

        // Reduces after a minute
        chain.start_block_after(Seconds::new(60).into());

        assert_eq!(Wrapper::push(&chain).get_diff(nft_id).get()?, 2850);

        chain.start_block_after(Seconds::new(5).into());

        Wrapper::push_from(&chain, alice).increment(nft_id, 7);

        // 6 sales increases the price by 5%
        assert_eq!(Wrapper::push(&chain).get_diff(nft_id).get()?, 2992);

        // 18 sales increases by 5% x 3
        chain.start_block_after(Seconds::new(5).into());

        Wrapper::push_from(&chain, alice).increment(nft_id, 18);

        assert_eq!(Wrapper::push(&chain).get_diff(nft_id).get()?, 3463);

        Ok(())
    }
}
