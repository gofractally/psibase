use crate::Wrapper;
use psibase::*;

#[psibase::test_case(packages("DiffAdjust"))]
fn test_one_second_window(mut chain: psibase::Chain) -> Result<(), psibase::Error> {
    chain.set_auto_block_start(false);

    let alice = account!("alice");
    chain.new_account(alice).unwrap();

    let get_diff = |nft_id: u32| -> Result<u64, psibase::Error> {
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
    assert_eq!(get_diff_2(nft_id)?, 300); // It increments immediately since activity_count exceeded target, which also
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

    // The 6 + 7 = 13 activity above gave floor(13 / (5 + 1)) = 2 steps and leave a carried
    // activity_count of 1 (13 % 6 == 1), so a single extra unit keeps the activity_count below the next
    // step threshold (target_max + 1 = 6).
    Wrapper::push_from(&chain, alice).increment(nft_id, 1);
    // Blocks: [0] [1] [2] [3] [4] [5] [6] [7] [8]
    //                                      ^current_block
    //                                      ^last_update - window not reset because the activity_count stayed below target
    assert_eq!(get_diff(nft_id)?, 108); // difficulty also not changed: activity_count (2) did not exceed target_max
    chain.start_block();
    // Blocks: [0] [1] [2] [3] [4] [5] [6] [7] [8]
    //                                          ^current_block
    //                                      ^last_update
    assert_eq!(get_diff(nft_id)?, 54); // Difficulty decreased because a window elapsed

    Ok(())
}
