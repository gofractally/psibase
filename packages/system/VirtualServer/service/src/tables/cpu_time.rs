use crate::tables::tables::*;
use async_graphql::{ComplexObject, SimpleObject};
use psibase::services::diff_adjust::Wrapper as DiffAdjust;
use psibase::services::nft::Wrapper as Nft;
use psibase::services::tokens::{Decimal, Precision};
use psibase::*;

const PPM: u128 = 1_000_000;
fn ratio_to_ppm(num: u64, den: u64) -> u128 {
    (num as u128 * PPM) / (den as u128)
}

const LN2_PPM: u32 = 693_147;

fn time_to_rate_ppm(t: u32) -> u32 {
    (LN2_PPM + t / 2) / t
}

impl CpuPricing {
    pub fn initialize() {
        const DEFAULT_NUM_BLOCKS_TO_AVERAGE: u8 = 5;

        const DEFAULT_INITIAL_DIFFICULTY: u64 = 1;
        const DEFAULT_FLOOR_DIFFICULTY: u64 = DEFAULT_INITIAL_DIFFICULTY;
        const DEFAULT_WINDOW_SECONDS: u32 = 1;
        const DEFAULT_TARGET_MIN: u32 = 45_0000;
        const DEFAULT_TARGET_MAX: u32 = 55_0000;
        const DEFAULT_DOUBLING_TIME_SEC: u32 = 600;
        const DEFAULT_HALVING_TIME_SEC: u32 = 1800;

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
        let cpu_time = CpuPricing {
            num_blocks_to_average: DEFAULT_NUM_BLOCKS_TO_AVERAGE,
            usage_history: Vec::new(),
            current_usage_ns: 0,
            diff_adjust_id,
            doubling_time_sec: DEFAULT_DOUBLING_TIME_SEC,
            halving_time_sec: DEFAULT_HALVING_TIME_SEC,
        };
        CpuPricingTable::read_write().put(&cpu_time).unwrap();
    }

    fn get_check() -> Self {
        check_some(
            CpuPricingTable::read().get_index_pk().get(&()),
            "CPU time not initialized",
        )
    }

    pub fn get() -> Option<Self> {
        CpuPricingTable::read().get_index_pk().get(&())
    }

    pub fn set_num_blocks_to_average(num_blocks: u8) {
        let table = CpuPricingTable::read_write();
        let mut cpu_time = check_some(table.get_index_pk().get(&()), "CPU time not initialized");
        cpu_time.num_blocks_to_average = num_blocks;
        table.put(&cpu_time).unwrap();
    }

    pub fn consume(amount_ns: u64) -> u64 {
        let table = CpuPricingTable::read_write();
        let mut cpu_time = check_some(table.get_index_pk().get(&()), "Billing not yet initialized");
        cpu_time.current_usage_ns += amount_ns;
        table.put(&cpu_time).unwrap();

        let price = Self::price();

        let amount_ms = amount_ns / 1_000_000;
        let cost = amount_ms.saturating_mul(price);

        check(cost < u64::MAX, "CPU usage overflow");
        cost
    }

    pub fn new_block() -> u32 {
        let table = CpuPricingTable::read_write();
        let mut cpu_time = check_some(table.get_index_pk().get(&()), "CPU time not initialized");

        cpu_time.usage_history.insert(0, cpu_time.current_usage_ns);
        if cpu_time.usage_history.len() > cpu_time.num_blocks_to_average as usize {
            cpu_time.usage_history.pop();
        }

        let avg: u64 = if cpu_time.usage_history.is_empty() {
            0
        } else {
            cpu_time.usage_history.iter().sum::<u64>() / cpu_time.usage_history.len() as u64
        };

        let cpu_ns_capacity = NetworkSpecs::get().cpu_ns;
        let mut ppm = ratio_to_ppm(avg, cpu_ns_capacity);

        // Clamp to 10x "full capacity" If we are that far over our limit, I think we can just
        // lose the real multiple. (needs to be clamped somewhere because it can only be u32
        // to work with the diffadjust api)
        ppm = ppm.min(10_000_000);
        let ppm = ppm as u32;

        DiffAdjust::call().increment(cpu_time.diff_adjust_id, ppm);

        cpu_time.current_usage_ns = 0;
        table.put(&cpu_time).unwrap();

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

        let table = CpuPricingTable::read_write();
        let mut cpu_time = check_some(table.get_index_pk().get(&()), "CPU time not initialized");
        cpu_time.doubling_time_sec = doubling_time_sec;
        cpu_time.halving_time_sec = halving_time_sec;
        table.put(&cpu_time).unwrap();

        DiffAdjust::call().set_percent(
            Self::get_check().diff_adjust_id,
            time_to_rate_ppm(doubling_time_sec),
            time_to_rate_ppm(halving_time_sec),
        );
    }

    pub fn get_cpu_limit(_account: AccountNumber) -> u64 {
        200_000_000u64 // 200 milliseconds
    }
}

#[derive(SimpleObject)]
pub struct Thresholds {
    pub idle_pct: String,
    pub congested_pct: String,
}

#[ComplexObject]
impl CpuPricing {
    pub async fn avg_usage_pct(&self) -> String {
        let avg = self.usage_history.iter().sum::<u64>() / self.usage_history.len() as u64;
        let ppm = ratio_to_ppm(avg, NetworkSpecs::get().cpu_ns) as u64;
        Decimal::new(ppm.into(), Precision::new(4).unwrap()).to_string()
    }

    pub async fn thresholds(&self) -> Thresholds {
        let diff_adjust_id = Self::get_check().diff_adjust_id;
        let (target_min, target_max) = DiffAdjust::call().get_targets(diff_adjust_id);

        let ppm_to_pct = Precision::new(4).unwrap();

        Thresholds {
            idle_pct: Decimal::new((target_min as u64).into(), ppm_to_pct).to_string(),
            congested_pct: Decimal::new((target_max as u64).into(), ppm_to_pct).to_string(),
        }
    }

    pub async fn price_per_unit(&self) -> u64 {
        DiffAdjust::call().get_diff(self.diff_adjust_id)
    }
}
