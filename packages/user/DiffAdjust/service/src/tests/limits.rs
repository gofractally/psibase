use super::ONE_MILLION;
use crate::Wrapper;
use psibase::*;

const MAX_DECREASE_PPM: u32 = 1_000_000;
const DECREASE_PPM_ERROR: &str = "decrease_ppm must not exceed 1_000_000";

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

    Wrapper::push_from(&chain, alice)
        .increment(nft_id, 1)
        .get()?;
    let increase_factor = 1.0 + f64::from(max_ppm) / ONE_MILLION;
    let expected_increase = (1000.0 * increase_factor).min(u64::MAX as f64) as u64;
    assert_eq!(
        Wrapper::push(&chain).get_diff(nft_id).get()?,
        expected_increase
    );

    // set_ppm also accepts values above the old 100% cap for increase.
    let nft_id = Wrapper::push_from(&chain, alice)
        .create(2000, 60, 0, 0, 1, 50_000, 50_000)
        .get()?;
    chain.start_block();
    Wrapper::push_from(&chain, alice)
        .set_ppm(nft_id, max_ppm, 50_000)
        .get()?;
    Wrapper::push_from(&chain, alice)
        .increment(nft_id, 1)
        .get()?;
    let expected_set_ppm = (2000.0 * increase_factor).min(u64::MAX as f64) as u64;
    assert_eq!(
        Wrapper::push(&chain).get_diff(nft_id).get()?,
        expected_set_ppm
    );

    Ok(())
}

#[psibase::test_case(packages("DiffAdjust"))]
fn test_decrease_ppm_rejected_above_100_percent(
    mut chain: psibase::Chain,
) -> Result<(), psibase::Error> {
    chain.set_auto_block_start(false);

    let alice = account!("alice");
    chain.new_account(alice).unwrap();

    Wrapper::push_from(&chain, alice)
        .create(8000, 0, 10, 10, 500, 50_000, 50_000)
        .match_error("window seconds must be above 0")?;

    Wrapper::push_from(&chain, alice)
        .create(8000, 60, 10, 10, 500, 50_000, 1_000_001)
        .match_error(DECREASE_PPM_ERROR)?;

    let nft_id = Wrapper::push_from(&chain, alice)
        .create(8000, 60, 10, 10, 500, 50_000, MAX_DECREASE_PPM)
        .get()?;
    chain.start_block();

    Wrapper::push_from(&chain, alice)
        .set_ppm(nft_id, 50_000, u32::MAX)
        .match_error(DECREASE_PPM_ERROR)?;

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
        Wrapper::push_from(&chain, alice)
            .increment(nft_id, 1)
            .get()?,
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

    Wrapper::push_from(&chain, alice)
        .increment(nft_id, 1)
        .get()?;
    chain.start_block();
    assert_eq!(Wrapper::push(&chain).get_diff(nft_id).get()?, u64::MAX);

    Ok(())
}
