use async_graphql::SimpleObject;
use psibase::services::diff_adjust::Wrapper as DiffAdjust;
use psibase::services::nft::Wrapper as Nft;
use psibase::services::tokens::{Decimal, Precision};
use psibase::*;

pub const PPM: u128 = 1_000_000;

pub fn ratio_to_ppm(num: u64, den: u64) -> u128 {
    (num as u128 * PPM) / (den as u128)
}

// In DiffAdjust, we use the discrete compounding equation to relate total change to a rate of change
//   over some interval.
//   ```
//   F = (1 + r)^t
//   ```
// To solve for a rate, therefore, given a total change and a time interval, we find:
//   ```
//   r = (F^(1/t)) - 1
//   ```
//
// Using the identity a^x = e^(x * ln(a)), we can rewrite the equation as:
//   ```
//   r = e^(ln(F) / t) - 1
//   ```
//
// The first term of the taylor series expansion of e^x -1 gives us the equation:
//   ```
//   r = ln(F) / t
//   ```
//
// ...Which is actually the same as the equation for rate of change in continuous compounding (F=e^(rt)).
//
// Precomputed ln(2) therefore encodes the target total change = 2x (rate needed to double a value
//   over some interval).
// ln(1/F) == -ln(F), so ln(2) can also be used to compute a halving rate.
//
// The error for this approximation drops off as t increases, so we can use it here given that we don't
//   expect to have small time intervals over which to double/halve.
pub const LN2_PPM: u32 = 693_147;
// The equation is therefore: `ln(2) / t`. Using `(ln(2) + t/2) / t` is a small adjustment to
//   round to the nearest solution instead of just truncation.
pub fn time_to_rate_ppm(t: u32) -> u32 {
    (LN2_PPM + t / 2) / t
}

#[derive(SimpleObject)]
pub struct Thresholds {
    /// The percentage of average consumption below which the price of the
    /// resource will decrease
    pub idle_pct: String,
    /// The percentage of average consumption above which the price of the
    /// resource will increase
    pub congested_pct: String,
}

pub fn create_diff_adjust(doubling_time_sec: u32, halving_time_sec: u32) -> u32 {
    const DEFAULT_INITIAL_DIFFICULTY: u64 = 1;
    const DEFAULT_FLOOR_DIFFICULTY: u64 = DEFAULT_INITIAL_DIFFICULTY;
    const DEFAULT_WINDOW_SECONDS: u32 = 1;
    const DEFAULT_TARGET_MIN: u32 = 45_0000;
    const DEFAULT_TARGET_MAX: u32 = 55_0000;

    let diff_adjust_id = DiffAdjust::call().create(
        DEFAULT_INITIAL_DIFFICULTY,
        DEFAULT_WINDOW_SECONDS,
        DEFAULT_TARGET_MIN,
        DEFAULT_TARGET_MAX,
        DEFAULT_FLOOR_DIFFICULTY,
        time_to_rate_ppm(doubling_time_sec),
        time_to_rate_ppm(halving_time_sec),
    );
    Nft::call().debit(diff_adjust_id, "".into());
    diff_adjust_id
}

fn average(list: &[u64]) -> u64 {
    if list.is_empty() {
        return 0;
    }
    // Use u128 internally to avoid overflow on the sum
    (list.iter().map(|&x| x as u128).sum::<u128>() / list.len() as u128) as u64
}

/// Updates the average_history with the specified current_usage, then zeroes out the current_usage.
/// Increments the specified diff_adjust by the amount of the average usage in PPM (of total capacity).
pub fn update_average_usage(
    usage_history: &mut Vec<u64>,
    last_block_usage: &mut u64,
    num_blocks_to_average: u8,
    capacity: u64,
    diff_adjust_id: u32,
) -> u32 {
    usage_history.insert(0, *last_block_usage);
    usage_history.truncate(num_blocks_to_average as usize);

    let avg = average(&usage_history);
    let ppm = ratio_to_ppm(avg, capacity);

    // We need to clamp this to fit in u32 which is a DiffAdjust constraint.
    // This clamps it at u32 max, which means that if the usage is more than 4,294x over capacity,
    //   then we lose the real multiple.
    let ppm = ppm.min(u32::MAX as u128) as u32;

    DiffAdjust::call().increment(diff_adjust_id, ppm);

    *last_block_usage = 0;

    ppm
}

pub fn validate_thresholds(idle_ppm: u32, congested_ppm: u32) {
    check(
        idle_ppm < congested_ppm,
        "idle ppm must be less than congested ppm",
    );
    check(idle_ppm > 0, "idle ppm must be greater than 0%");
    check(
        congested_ppm < PPM as u32,
        "congested ppm must be less than 100%",
    );
}

pub fn validate_change_rates(doubling_time_sec: u32, halving_time_sec: u32) {
    check(
        doubling_time_sec > 0,
        "doubling time must be greater than 0",
    );
    check(halving_time_sec > 0, "halving time must be greater than 0");
}

pub fn get_thresholds_pct(diff_adjust_id: u32) -> Thresholds {
    let (target_min, target_max) = DiffAdjust::call().get_targets(diff_adjust_id);
    let ppm_to_pct = Precision::new(4).unwrap();

    Thresholds {
        idle_pct: Decimal::new((target_min as u64).into(), ppm_to_pct).to_string(),
        congested_pct: Decimal::new((target_max as u64).into(), ppm_to_pct).to_string(),
    }
}

pub fn avg_usage_pct_str(usage_history: &[u64], capacity: u64) -> String {
    let avg = usage_history.iter().sum::<u64>() / usage_history.len() as u64;
    let ppm = ratio_to_ppm(avg, capacity) as u64;
    Decimal::new(ppm.into(), Precision::new(4).unwrap()).to_string()
}
