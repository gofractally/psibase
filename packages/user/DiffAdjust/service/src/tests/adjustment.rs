use crate::Wrapper;
use psibase::*;

#[psibase::test_case(packages("DiffAdjust"))]
fn test_diff_adjust_basic(mut chain: psibase::Chain) -> Result<(), psibase::Error> {
    chain.set_auto_block_start(false);

    let alice = account!("alice");
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

    let alice = account!("alice");
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
fn test_target_zero_increase_every_event(mut chain: psibase::Chain) -> Result<(), psibase::Error> {
    chain.set_auto_block_start(false);

    let alice = account!("alice");
    chain.new_account(alice).unwrap();

    let nft_id = Wrapper::push_from(&chain, alice)
        .create(1000, 60, 0, 0, 100, 50_000, 50_000)
        .get()?;
    chain.start_block();

    // With target=0, every increment triggers an adjustment (unlike target=1).
    let expected_paid = [1000, 1050, 1102];
    let expected_post_diff = [1050, 1102, 1157];

    for (paid, post_diff) in expected_paid.iter().zip(expected_post_diff.iter()) {
        let returned = Wrapper::push_from(&chain, alice)
            .increment(nft_id, 1)
            .get()?;
        chain.start_block();
        assert_eq!(returned, *paid);
        assert_eq!(Wrapper::push(&chain).get_diff(nft_id).get()?, *post_diff);
    }

    Ok(())
}
