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

    // Cumulative steps = floor((events - 1) / target_max). The 7 sales above left a
    // remainder of 1, so these 18 sales bring the counter to 19 -> floor(18/6) = 3 steps.
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

/// Verifies the core rule across targets: for `events` accumulated in a window, the number
/// of difficulty steps is `floor((events - 1) / target)`, or `events` when `target == 0`.
///
/// This reproduces the PremAccounts / Symbol usage pattern (`increment(nft, 1)` once per
/// purchase). For example with `target = 3` the steps land on events 4, 7, 10, ... :
///   events 1-3 -> 0 steps, event 4 -> 1, events 5-6 -> 1, event 7 -> 2, events 8-9 -> 2,
///   event 10 -> 3.
#[psibase::test_case(packages("DiffAdjust"))]
fn test_adjustment_count_matches_floor_events_minus_one_over_target(
    mut chain: psibase::Chain,
) -> Result<(), psibase::Error> {
    chain.set_auto_block_start(false);

    let alice = account!("alice");
    chain.new_account(alice).unwrap();

    const INITIAL: u64 = 10_000;
    const WINDOW: u32 = 86_400; // large enough that no window elapses during the test
    const FLOOR: u64 = 1;
    const PPM: u32 = 50_000; // 5%

    // Matches DiffAdjust's per-step math exactly (factor^1 then truncate to u64), so the
    // expected value after `k` single steps is deterministic.
    let factor = 1.0_f64 + (PPM as f64 / 1_000_000_f64);
    let diff_after_steps = |k: u32| -> u64 {
        let mut d = INITIAL;
        for _ in 0..k {
            d = (d as f64 * factor) as u64;
        }
        d
    };
    let expected_steps = |target: u32, events: u32| -> u32 {
        if target == 0 {
            events
        } else {
            (events - 1) / target
        }
    };

    for target in [0u32, 1, 2, 3, 5] {
        let nft_id = Wrapper::push_from(&chain, alice)
            .create(INITIAL, WINDOW, target, target, FLOOR, PPM, PPM)
            .get()?;
        chain.start_block();

        let total_events = target.max(1) * 3 + 1;
        for events in 1..=total_events {
            Wrapper::push_from(&chain, alice)
                .increment(nft_id, 1)
                .get()?;
            chain.start_block();
            assert_eq!(
                Wrapper::push(&chain).get_diff(nft_id).get()?,
                diff_after_steps(expected_steps(target, events)),
                "target={target}: wrong difficulty after {events} events"
            );
        }
    }

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
