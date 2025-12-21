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

pub fn calculate_new_block_ppm(
    usage_history: &mut Vec<u64>,
    current_usage: u64,
    num_blocks_to_average: u8,
    capacity: u64,
    diff_adjust_id: u32,
) -> u32 {
    usage_history.insert(0, current_usage);
    if usage_history.len() > num_blocks_to_average as usize {
        usage_history.pop();
    }

    let avg: u64 = if usage_history.is_empty() {
        0
    } else {
        usage_history.iter().sum::<u64>() / usage_history.len() as u64
    };

    let mut ppm = ratio_to_ppm(avg, capacity);

    // Clamp to 10x "full capacity" If we are that far over our limit, I think we can just
    // lose the real multiple. (needs to be clamped somewhere because it can only be u32
    // to work with the diffadjust api)
    ppm = ppm.min(10_000_000);
    let ppm = ppm as u32;

    DiffAdjust::call().increment(diff_adjust_id, ppm);

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
