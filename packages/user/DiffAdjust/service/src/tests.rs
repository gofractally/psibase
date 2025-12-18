#![allow(non_snake_case)]

#[cfg(test)]
mod tests {
    use crate::Wrapper;
    use psibase::*;

    #[psibase::test_case(packages("DiffAdjust"))]
    fn test_diff_adjust_basic(mut chain: psibase::Chain) -> Result<(), psibase::Error> {
        chain.set_auto_block_start(false);

        let alice = AccountNumber::from("alice");
        chain.new_account(alice).unwrap();

        let nft_id = Wrapper::push_from(&chain, alice)
            .create(3000, 60, 5, 6, 500, 50000, 50000)
            .get()?;
        chain.start_block();

        // Difficulty does not increase after 4
        Wrapper::push_from(&chain, alice)
            .increment(nft_id, 4)
            .get()?;

        assert_eq!(Wrapper::push(&chain).get_diff(nft_id).get()?, 3000);

        // Reduces after a minute
        chain.start_block_after(Seconds::new(60).into());

        assert_eq!(Wrapper::push(&chain).get_diff(nft_id).get()?, 2850);

        chain.start_block_after(Seconds::new(5).into());

        Wrapper::push_from(&chain, alice)
            .increment(nft_id, 7)
            .get()?;

        // 7 sales increases the Difficulty by 5%
        assert_eq!(Wrapper::push(&chain).get_diff(nft_id).get()?, 2992);

        // 18 sales increases by 5% x 3
        chain.start_block_after(Seconds::new(5).into());

        Wrapper::push_from(&chain, alice).increment(nft_id, 18);

        assert_eq!(Wrapper::push(&chain).get_diff(nft_id).get()?, 3463);

        Ok(())
    }

    #[psibase::test_case(packages("DiffAdjust"))]
    fn test_asymmetric_percent(mut chain: psibase::Chain) -> Result<(), psibase::Error> {
        chain.set_auto_block_start(false);

        let alice = AccountNumber::from("alice");
        chain.new_account(alice).unwrap();

        let nft_id = Wrapper::push_from(&chain, alice)
            .create(10000, 60, 5, 6, 1000, 100000, 50000)
            .get()?;
        chain.start_block();

        assert_eq!(Wrapper::push(&chain).get_diff(nft_id).get()?, 10000);

        Wrapper::push_from(&chain, alice).increment(nft_id, 7);

        chain.start_block();

        assert_eq!(Wrapper::push(&chain).get_diff(nft_id).get()?, 11000);

        chain.start_block_after(Seconds::new(60).into());

        assert_eq!(Wrapper::push(&chain).get_diff(nft_id).get()?, 10450);

        Ok(())
    }

    #[psibase::test_case(packages("DiffAdjust"))]
    fn test_one_second_window(mut chain: psibase::Chain) -> Result<(), psibase::Error> {
        chain.set_auto_block_start(false);

        let alice = AccountNumber::from("alice");
        chain.new_account(alice).unwrap();

        let nft_id = Wrapper::push_from(&chain, alice)
            .create(1000, 1, 5, 5, 1, 20_0000, 50_0000)
            .get()?;

        let get_diff = || -> Result<u64, psibase::Error> {
            //
            Wrapper::push(&chain).get_diff(nft_id).get()
        };

        let get_diff_2 = || -> Result<u64, psibase::Error> {
            // So it's not seen as a duplicate tx
            Wrapper::push_from(&chain, alice).get_diff(nft_id).get()
        };

        assert_eq!(get_diff()?, 1000);
        chain.start_block();
        assert_eq!(get_diff()?, 1000); // Does not decrease because a full second is not considered to have passed yet, even though it's
                                       //  a new block. Because when the diffadjust was created, it's considered to be created "mid block"
                                       // which rounds up to the next second.
        chain.start_block();
        assert_eq!(get_diff()?, 500);
        chain.start_block();
        assert_eq!(get_diff()?, 250);
        Wrapper::push_from(&chain, alice).increment(nft_id, 6);
        assert_eq!(get_diff_2()?, 300); // It increments immediately.
        chain.start_block();
        assert_eq!(get_diff()?, 300); // Still 300! Because it was just incremented at the end of the last block, so
                                      // we don't consider a window to have elapsed yet.
        chain.start_block();
        chain.start_block();
        assert_eq!(get_diff()?, 75); // Now two whole blocks, and therefore two whole windows have elapsed,
                                     // should decrease twice.

        Ok(())
    }
}
