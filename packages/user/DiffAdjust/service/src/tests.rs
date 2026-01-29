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
    fn test_asymmetric_ppm(mut chain: psibase::Chain) -> Result<(), psibase::Error> {
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

        let get_diff = |nft_id: u32| -> Result<u64, psibase::Error> {
            //
            Wrapper::push(&chain).get_diff(nft_id).get()
        };

        let get_diff_2 = |nft_id: u32| -> Result<u64, psibase::Error> {
            // So it's not seen as a duplicate tx
            Wrapper::push_from(&chain, alice).get_diff(nft_id).get()
        };

        // TEST START
        let nft_id = Wrapper::push_from(&chain, alice)
            .create(1000, 1, 5, 5, 1, 20_0000, 50_0000)
            .get()?;
        // Blocks: [0] [1] [2] [3] [4] [5] [6] [7] [8]
        //         ^current_block
        //              ^last_update (+1 second added to "round up" to the nearest block)

        assert_eq!(get_diff(nft_id)?, 1000);
        chain.start_block();
        // Blocks: [0] [1] [2] [3] [4] [5] [6] [7] [8]
        //              ^current_block
        //              ^last_update
        assert_eq!(get_diff(nft_id)?, 1000); // Does not decrease because a full second is not considered
                                             // to have passed yet (because of the rounding up)
        chain.start_block();
        // Blocks: [0] [1] [2] [3] [4] [5] [6] [7] [8]
        //                  ^current_block
        //              ^last_update
        //
        assert_eq!(get_diff(nft_id)?, 500); // A window passed, therefore difficulty has decreased
        chain.start_block();
        // Blocks: [0] [1] [2] [3] [4] [5] [6] [7] [8]
        //                      ^ current_block
        //              ^last_update
        assert_eq!(get_diff(nft_id)?, 250); // Last update hasn't actually changed because getting the window
                                            // doesn't update when the difficulty is checked
                                            // Therefore two windows have elapsed, and this shows difficulty
                                            // decreased twice.
        Wrapper::push_from(&chain, alice).increment(nft_id, 6);
        // Blocks: [0] [1] [2] [3] [4] [5] [6] [7] [8]
        //                      ^current_block
        //                          ^last_update
        assert_eq!(get_diff_2(nft_id)?, 300); // It increments immediately since counter exceeded target, which also
                                              // sets the last_update (window reset)
        chain.start_block();
        // Blocks: [0] [1] [2] [3] [4] [5] [6] [7] [8]
        //                          ^current_block
        //                          ^last_update
        assert_eq!(get_diff(nft_id)?, 300); // Still 300! Just like on creation, no window has yet elapsed because the
                                            // time of the last update rounds up.
        chain.start_block();
        chain.start_block();
        // Blocks: [0] [1] [2] [3] [4] [5] [6] [7] [8]
        //                                  ^current_block
        //                          ^last_update
        assert_eq!(get_diff(nft_id)?, 75); // Now two whole blocks, and therefore two whole windows have elapsed,
                                           // should decrease twice.

        // Increment back up a bit
        Wrapper::push_from(&chain, alice).increment(nft_id, 6);
        Wrapper::push_from(&chain, alice).increment(nft_id, 7);
        // Blocks: [0] [1] [2] [3] [4] [5] [6] [7] [8]
        //                                  ^current_block
        //                                      ^last_update
        assert_eq!(get_diff_2(nft_id)?, 108);

        chain.start_block();
        // Blocks: [0] [1] [2] [3] [4] [5] [6] [7] [8]
        //                                      ^current_block
        //                                      ^last_update

        Wrapper::push_from(&chain, alice).increment(nft_id, 3);
        // Blocks: [0] [1] [2] [3] [4] [5] [6] [7] [8]
        //                                      ^current_block
        //                                      ^last_update - window not reset because increment was below target
        assert_eq!(get_diff(nft_id)?, 108); // difficulty also not changed because increment was below target
        chain.start_block();
        // Blocks: [0] [1] [2] [3] [4] [5] [6] [7] [8]
        //                                          ^current_block
        //                                      ^last_update
        assert_eq!(get_diff(nft_id)?, 54); // Difficulty decreased because a window elapsed

        Ok(())
    }
}
