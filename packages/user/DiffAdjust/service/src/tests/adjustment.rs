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

    // Adjustments = floor(events / (target_max + 1)). The 7 sales above left no remainder
    // (7 % 7 == 0), so these 18 sales give floor(18 / 7) = 2 steps (5% x 2 on top of 2992).
    chain.start_block_after(Seconds::new(5).into());

    Wrapper::push_from(&chain, alice).increment(nft_id, 18);

    assert_eq!(Wrapper::push(&chain).get_diff(nft_id).get()?, 3298);

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

/// Verifies the core rule across targets: `target` events accumulate with no adjustment and
/// the next event triggers one, so the number of difficulty steps for `events` accumulated in
/// a window is `floor(events / (target + 1))` (which makes `target == 0` adjust every event).
///
/// This reproduces the NameMarket / Symbol usage pattern (`increment(nft, 1)` once per
/// purchase). For example with `target = 3` the steps land on events 4, 8, 12, ... :
///   events 1-3 -> 0 steps, events 4-7 -> 1, events 8-11 -> 2, event 12 -> 3.
#[psibase::test_case(packages("DiffAdjust"))]
fn test_adjustment_count_matches_floor_events_over_target_plus_one(
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
    let expected_steps = |target: u32, events: u32| -> u32 { events / (target + 1) };

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

/// The counter remainder must be CARRIED across increments (not reset to 0). A series of
/// individually-below-threshold batches must still earn the adjustments that their
/// cumulative event count deserves, and a batched increment must match the same events fed
/// one at a time.
///
/// With `target = 3` (one adjustment per `target + 1 = 4` events), four increments of 3
/// (12 events) trace the counter as: 3 (no step) -> 6 (1 step, carry 2) -> 5 (1 step,
/// carry 1) -> 4 (1 step, carry 0), i.e. 3 steps. A reset-to-0 implementation would instead
/// fire only on the 2nd and 4th batch (2 steps) and silently drop the carried remainder.
#[psibase::test_case(packages("DiffAdjust"))]
fn test_remainder_carries_across_batches(mut chain: psibase::Chain) -> Result<(), psibase::Error> {
    chain.set_auto_block_start(false);

    let alice = account!("alice");
    chain.new_account(alice).unwrap();

    const INITIAL: u64 = 10_000;
    const WINDOW: u32 = 86_400; // large enough that no window elapses during the test
    const TARGET: u32 = 3;
    const PPM: u32 = 50_000; // 5%

    let batched = Wrapper::push_from(&chain, alice)
        .create(INITIAL, WINDOW, TARGET, TARGET, 1, PPM, PPM)
        .get()?;
    // Separate block so this identical-argument create isn't seen as a duplicate transaction.
    chain.start_block();
    let individual = Wrapper::push_from(&chain, alice)
        .create(INITIAL, WINDOW, TARGET, TARGET, 1, PPM, PPM)
        .get()?;
    chain.start_block();

    // Each batch is below the per-step threshold (3 < 4), but the carried remainder makes
    // the 2nd, 3rd and 4th batch each trigger one step. Dropping the remainder would leave
    // the difficulty stuck at 11_025 (only 2 steps).
    let expected_after_each_batch = [10_000u64, 10_500, 11_025, 11_576];
    for expected in expected_after_each_batch {
        Wrapper::push_from(&chain, alice)
            .increment(batched, 3)
            .get()?;
        chain.start_block();
        assert_eq!(Wrapper::push(&chain).get_diff(batched).get()?, expected);
    }

    // The same 12 events, one at a time, must land on the identical difficulty (11_576).
    let mut individual_diff = INITIAL;
    for _ in 0..12 {
        Wrapper::push_from(&chain, alice)
            .increment(individual, 1)
            .get()?;
        chain.start_block();
        individual_diff = Wrapper::push(&chain).get_diff(individual).get()?;
    }
    assert_eq!(
        individual_diff, 11_576,
        "batched increments must equal the same events fed one at a time"
    );

    Ok(())
}
