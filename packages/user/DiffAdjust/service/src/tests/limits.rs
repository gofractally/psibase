use super::ONE_MILLION;
use crate::Wrapper;
use psibase::*;

const MAX_DECREASE_PPM: u32 = 1_000_000;

#[psibase::test_case(packages("DiffAdjust"))]
fn test_max_ppm_unclamped(mut chain: psibase::Chain) -> Result<(), psibase::Error> {
    chain.set_auto_block_start(false);

    let alice = account!("alice");
    chain.new_account(alice).unwrap();

    let max_ppm = u32::MAX;

    // Max increase ppm (previously rejected above 1_000_000).
    let nft_id = Wrapper::push_from(&chain, alice)
        .create(1000, 60, 0, 0, 1, max_ppm, 50_000)
        .get()?;
    chain.start_block();

    Wrapper::push_from(&chain, alice).increment(nft_id, 1).get()?;
    let increase_factor = 1.0 + f64::from(max_ppm) / ONE_MILLION;
    let expected_increase = (1000.0 * increase_factor).min(u64::MAX as f64) as u64;
    assert_eq!(
        Wrapper::push(&chain).get_diff(nft_id).get()?,
        expected_increase
    );

    // Decrease ppm above 100% is clamped; u32::MAX behaves like 1_000_000 (full decay to floor).
    let nft_id = Wrapper::push_from(&chain, alice)
        .create(10_000, 60, 10, 10, 1, 50_000, max_ppm)
        .get()?;
    chain.start_block();
    chain.start_block_after(Seconds::new(60).into());

    assert_eq!(Wrapper::push(&chain).get_diff(nft_id).get()?, 1);

    // set_ppm also accepts values above the old 100% cap for increase; decrease is clamped on store.
    let nft_id = Wrapper::push_from(&chain, alice)
        .create(2000, 60, 0, 0, 1, 50_000, 50_000)
        .get()?;
    chain.start_block();
    Wrapper::push_from(&chain, alice).set_ppm(nft_id, max_ppm, max_ppm);
    Wrapper::push_from(&chain, alice).increment(nft_id, 1).get()?;
    let expected_set_ppm = (2000.0 * increase_factor).min(u64::MAX as f64) as u64;
    assert_eq!(
        Wrapper::push(&chain).get_diff(nft_id).get()?,
        expected_set_ppm
    );

    Ok(())
}

#[psibase::test_case(packages("DiffAdjust"))]
fn test_decrease_ppm_clamped_to_100_percent(
    mut chain: psibase::Chain,
) -> Result<(), psibase::Error> {
    chain.set_auto_block_start(false);

    let alice = account!("alice");
    chain.new_account(alice).unwrap();

    let at_cap = Wrapper::push_from(&chain, alice)
        .create(8000, 60, 10, 10, 500, 50_000, MAX_DECREASE_PPM)
        .get()?;
    let above_cap = Wrapper::push_from(&chain, alice)
        .create(8000, 60, 10, 10, 500, 50_000, u32::MAX)
        .get()?;
    chain.start_block();
    chain.start_block_after(Seconds::new(60).into());

    let at_cap_diff = Wrapper::push(&chain).get_diff(at_cap).get()?;
    let above_cap_diff = Wrapper::push(&chain).get_diff(above_cap).get()?;
    assert_eq!(at_cap_diff, 500);
    assert_eq!(above_cap_diff, at_cap_diff);

    Ok(())
}

#[psibase::test_case(packages("DiffAdjust"))]
fn test_saturated_difficulty_and_counter(mut chain: psibase::Chain) -> Result<(), psibase::Error> {
    chain.set_auto_block_start(false);

    let alice = account!("alice");
    chain.new_account(alice).unwrap();

    // At max difficulty, further increments are valid no-ops on difficulty.
    let nft_id = Wrapper::push_from(&chain, alice)
        .create(u64::MAX, 60, 0, 0, 1, 50_000, 50_000)
        .get()?;
    chain.start_block();

    assert_eq!(Wrapper::push(&chain).get_diff(nft_id).get()?, u64::MAX);
    assert_eq!(
        Wrapper::push_from(&chain, alice).increment(nft_id, 1).get()?,
        u64::MAX
    );
    chain.start_block();
    assert_eq!(Wrapper::push(&chain).get_diff(nft_id).get()?, u64::MAX);

    // Counter saturates at u32::MAX instead of wrapping; difficulty still caps at u64::MAX.
    let nft_id = Wrapper::push_from(&chain, alice)
        .create(1000, 60, 5, 5, 1, u32::MAX, 50_000)
        .get()?;
    chain.start_block();

    Wrapper::push_from(&chain, alice)
        .increment(nft_id, u32::MAX)
        .get()?;
    chain.start_block();
    assert_eq!(Wrapper::push(&chain).get_diff(nft_id).get()?, u64::MAX);

    Wrapper::push_from(&chain, alice).increment(nft_id, 1).get()?;
    chain.start_block();
    assert_eq!(Wrapper::push(&chain).get_diff(nft_id).get()?, u64::MAX);

    Ok(())
}
