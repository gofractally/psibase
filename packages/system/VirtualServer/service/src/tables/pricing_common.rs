use async_graphql::SimpleObject;
use psibase::services::diff_adjust::Wrapper as DiffAdjust;
use psibase::services::nft::Wrapper as Nft;
use psibase::services::tokens::{Decimal, Precision};
use psibase::*;

pub const PPM: u128 = 1_000_000;

pub fn ratio_to_ppm(num: u64, den: u64) -> u128 {
    (num as u128 * PPM) / (den as u128)
}

pub const LN2_PPM: u32 = 693_147;

pub fn time_to_rate_ppm(t: u32) -> u32 {
    (LN2_PPM + t / 2) / t
}

#[derive(SimpleObject)]
pub struct Thresholds {
    pub idle_pct: String,
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

fn delta_squared(v: u64, average: u64) -> u128 {
    let d = v as i128 - average as i128;
    let d_abs = d.abs() as u128;
    d_abs * d_abs
}

fn var(list: &[u64], average: u64) -> u64 {
    if list.is_empty() {
        return 0;
    }
    let d_squared = |&x: &u64| -> u128 { delta_squared(x, average) };

    (list.iter().map(d_squared).sum::<u128>() / list.len() as u128) as u64
}

/// Updates the average_history with the specified current_usage, then zeroes out the current_usage.
/// Increments the specified diff_adjust by the amount of the average usage in PPM (of total capacity).
pub fn update_average_usage(
    usage_history: &mut Vec<u64>,
    current_usage: &mut u64,
    num_blocks_to_average: u8,
    capacity: u64,
    diff_adjust_id: u32,
) -> u32 {
    usage_history.insert(0, *current_usage);
    if usage_history.len() > num_blocks_to_average as usize {
        usage_history.pop();
    }

    // When rate-limiting resource usage, we want to include the usage of the current block
    // in the calculation, assuming that it is going to be full.
    let mut padded_usage = usage_history.clone();
    padded_usage.push(capacity); // Add a block of max capacity

    // Calculating the number of standard deviations we are over the average
    // Working in sigma-squared space to avoid square roots
    let avg = average(&padded_usage);
    let variance = var(&padded_usage, avg);
    let d2 = delta_squared(*current_usage, avg);
    let factor = d2 as u128 / variance as u128;

    let _sigma: u8 = if factor > 25 {
        5
    } else if factor > 16 {
        4
    } else if factor > 9 {
        3
    } else if factor > 4 {
        2
    } else if factor > 1 {
        1
    } else {
        0
    };

    let ppm = ratio_to_ppm(avg, capacity);

    // We need to clamp this to fit in u32 which is a DiffAdjust constraint.
    // This clamps it at u32 max, which means that if the usage is more than 4,294x over capacity,
    //   then we lose the real multiple. With this implementation, all that matters is that the PPM
    //   is over the target, the absolute value is not really relevant.
    let ppm = ppm.min(u32::MAX as u128) as u32;

    // Consider whether we should, in any circumstance (e.g. usage in multiples excess
    // of capacity), increment multiple times.
    DiffAdjust::call().increment(diff_adjust_id, ppm);

    *current_usage = 0;

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
