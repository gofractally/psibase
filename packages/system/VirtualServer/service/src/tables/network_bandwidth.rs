use crate::tables::tables::*;
use async_graphql::{ComplexObject, SimpleObject};
use psibase::services::diff_adjust::Wrapper as DiffAdjust;
use psibase::services::nft::Wrapper as Nft;
use psibase::services::tokens::{Decimal, Precision};
use psibase::*;

// A percentage expressed as ppm, e.g. 100% = 1_000_000 ppm
const PPM: u128 = 1_000_000;
fn ratio_to_ppm(num: u64, den: u64) -> u128 {
    (num as u128 * PPM) / (den as u128)
}

const LN2_PPM: u32 = 693_147; // floor(ln(2) * 1_000_000)

// This is an approximation of the per-second rate r that satisfies:
//
//   (1 + r)^t = 2
//
// so:
//
//   r = 2^(1/t) - 1
//
// 2 is the target factor (doubling/halving), and assuming it lets me precompute
// the ln(2) term.
fn time_to_rate_ppm(t: u32) -> u32 {
    (LN2_PPM + t / 2) / t // round(ln(2)_ppm / t)
}

impl NetPricing {
    pub fn initialize() {
        const DEFAULT_NUM_BLOCKS_TO_AVERAGE: u8 = 5;

        const DEFAULT_INITIAL_DIFFICULTY: u64 = 1;
        const DEFAULT_FLOOR_DIFFICULTY: u64 = DEFAULT_INITIAL_DIFFICULTY;
        const DEFAULT_WINDOW_SECONDS: u32 = 1;
        const DEFAULT_TARGET_MIN: u32 = 45_0000; // 45% usage
        const DEFAULT_TARGET_MAX: u32 = 55_0000; // 55% usage
        const DEFAULT_DOUBLING_TIME_SEC: u32 = 600; // 10 minutes
        const DEFAULT_HALVING_TIME_SEC: u32 = 1800; // 30 minutes

        let diff_adjust_id = DiffAdjust::call().create(
            DEFAULT_INITIAL_DIFFICULTY,
            DEFAULT_WINDOW_SECONDS,
            DEFAULT_TARGET_MIN,
            DEFAULT_TARGET_MAX,
            DEFAULT_FLOOR_DIFFICULTY,
            time_to_rate_ppm(DEFAULT_DOUBLING_TIME_SEC),
            time_to_rate_ppm(DEFAULT_HALVING_TIME_SEC),
        );
        Nft::call().debit(diff_adjust_id, "".into());
        let network_bandwidth = NetPricing {
            num_blocks_to_average: DEFAULT_NUM_BLOCKS_TO_AVERAGE,
            usage_history: Vec::new(),
            current_usage_bps: 0,
            diff_adjust_id,
            doubling_time_sec: DEFAULT_DOUBLING_TIME_SEC,
            halving_time_sec: DEFAULT_HALVING_TIME_SEC,
        };
        NetPricingTable::read_write()
            .put(&network_bandwidth)
            .unwrap();
    }

    fn get_check() -> Self {
        check_some(
            NetPricingTable::read().get_index_pk().get(&()),
            "Network bandwidth not initialized",
        )
    }

    pub fn get() -> Option<Self> {
        NetPricingTable::read().get_index_pk().get(&())
    }

    pub fn set_num_blocks_to_average(num_blocks: u8) {
        let table = NetPricingTable::read_write();
        let mut bandwidth = check_some(
            table.get_index_pk().get(&()),
            "Network bandwidth not initialized",
        );
        bandwidth.num_blocks_to_average = num_blocks;
        table.put(&bandwidth).unwrap();
    }

    pub fn consume(amount_bytes: u64) -> u64 {
        let amount_bits = amount_bytes.saturating_mul(8);
        check(amount_bits < u64::MAX, "network usage overflow");

        let table = NetPricingTable::read_write();
        let mut bandwidth =
            check_some(table.get_index_pk().get(&()), "Billing not yet initialized");
        bandwidth.current_usage_bps += amount_bits;
        table.put(&bandwidth).unwrap();

        // TODO: Consider adding a state var to track the minimum billable bits (for bw) and ns (for cpu)

        let price = Self::price();
        let cost = amount_bytes.saturating_mul(price);
        check(cost < u64::MAX, "network usage overflow");
        cost
    }

    pub fn new_block() -> u32 {
        let table = NetPricingTable::read_write();
        let mut bandwidth = check_some(
            table.get_index_pk().get(&()),
            "Network bandwidth not initialized123",
        );

        bandwidth
            .usage_history
            .insert(0, bandwidth.current_usage_bps);
        if bandwidth.usage_history.len() > bandwidth.num_blocks_to_average as usize {
            bandwidth.usage_history.pop();
        }

        let avg: u64 = if bandwidth.usage_history.is_empty() {
            0
        } else {
            bandwidth.usage_history.iter().sum::<u64>() / bandwidth.usage_history.len() as u64
        };

        let net_bps_capacity = NetworkSpecs::get().net_bps;
        let mut ppm = ratio_to_ppm(avg, net_bps_capacity);

        // Clamp to 10x "full capacity" If we are that far over our bandwidth limit, I think we can just
        // lose the real multiple. (needs to be clamped somewhere because it can only be u32
        // to work with the diffadjust api)
        ppm = ppm.min(10_000_000);
        let ppm = ppm as u32;

        // The increment amount is actually the ratio of the average usage to the total available
        DiffAdjust::call().increment(bandwidth.diff_adjust_id, ppm);

        bandwidth.current_usage_bps = 0;
        table.put(&bandwidth).unwrap();

        ppm
    }

    pub fn price() -> u64 {
        DiffAdjust::call().get_diff(Self::get_check().diff_adjust_id)
    }

    pub fn set_thresholds(idle_ppm: u32, congested_ppm: u32) {
        check(
            idle_ppm < congested_ppm,
            "idle ppm must be less than congested ppm",
        );
        check(idle_ppm > 0, "idle ppm must be greater than 0%");
        check(
            congested_ppm < PPM as u32,
            "congested ppm must be less than 100%",
        );

        DiffAdjust::call().set_targets(Self::get_check().diff_adjust_id, idle_ppm, congested_ppm);
    }

    pub fn set_change_rates(doubling_time_sec: u32, halving_time_sec: u32) {
        check(
            doubling_time_sec > 0,
            "doubling time must be greater than 0",
        );
        check(halving_time_sec > 0, "halving time must be greater than 0");

        // Store the doubling/halving times for the benefit of queries
        let table = NetPricingTable::read_write();
        let mut bw = check_some(
            table.get_index_pk().get(&()),
            "Network bandwidth not initialized123",
        );
        bw.doubling_time_sec = doubling_time_sec;
        bw.halving_time_sec = halving_time_sec;
        table.put(&bw).unwrap();

        DiffAdjust::call().set_percent(
            Self::get_check().diff_adjust_id,
            time_to_rate_ppm(doubling_time_sec),
            time_to_rate_ppm(halving_time_sec),
        );
    }
}

#[derive(SimpleObject)]
pub struct Thresholds {
    /// The idle threshold, as a percentage of total capacity
    pub idle_pct: String,
    /// The congested threshold, as a percentage of total capacity
    pub congested_pct: String,
}

#[ComplexObject]
impl NetPricing {
    /// The average usage of network bandwidth as a percentage of total capacity
    pub async fn avg_usage_pct(&self) -> String {
        let avg = self.usage_history.iter().sum::<u64>() / self.usage_history.len() as u64;
        let ppm = ratio_to_ppm(avg, NetworkSpecs::get().net_bps) as u64;
        Decimal::new(ppm.into(), Precision::new(4).unwrap()).to_string()
    }

    /// The idle/congested thresholds, as percentages of total capacity
    pub async fn thresholds(&self) -> Thresholds {
        let diff_adjust_id = Self::get_check().diff_adjust_id;
        let (target_min, target_max) = DiffAdjust::call().get_targets(diff_adjust_id);

        let ppm_to_pct = Precision::new(4).unwrap();

        Thresholds {
            idle_pct: Decimal::new((target_min as u64).into(), ppm_to_pct).to_string(),
            congested_pct: Decimal::new((target_max as u64).into(), ppm_to_pct).to_string(),
        }
    }

    /// The price per smallest billable unit of network bandwidth
    pub async fn price_per_unit(&self) -> u64 {
        DiffAdjust::call().get_diff(self.diff_adjust_id)
    }
}
