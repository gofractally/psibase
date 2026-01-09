use crate::tables::pricing_common::*;
use crate::tables::tables::*;
use async_graphql::ComplexObject;
use psibase::services::diff_adjust::Wrapper as DiffAdjust;
use psibase::*;

impl CpuPricing {
    pub fn initialize() {
        const DEFAULT_NUM_BLOCKS_TO_AVERAGE: u8 = 5;
        const DEFAULT_DOUBLING_TIME_SEC: u32 = 600;
        const DEFAULT_HALVING_TIME_SEC: u32 = 1800;

        let cpu_diff = CpuPricing {
            num_blocks_to_average: DEFAULT_NUM_BLOCKS_TO_AVERAGE,
            usage_history: Vec::new(),
            current_usage_ns: 0,
            diff_adjust_id: create_diff_adjust(DEFAULT_DOUBLING_TIME_SEC, DEFAULT_HALVING_TIME_SEC),
            doubling_time_sec: DEFAULT_DOUBLING_TIME_SEC,
            halving_time_sec: DEFAULT_HALVING_TIME_SEC,
            billable_unit: 1_000_000, // Bill per-millisecond
        };
        CpuPricingTable::read_write().put(&cpu_diff).unwrap();
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

        // Round up to the nearest billable unit
        let amount_units = (amount_ns + cpu_time.billable_unit - 1) / cpu_time.billable_unit;

        let cost = amount_units.saturating_mul(price);
        check(cost < u64::MAX, "CPU usage overflow");
        cost
    }

    pub fn new_block() -> u32 {
        let table = CpuPricingTable::read_write();
        let mut cpu_time = check_some(table.get_index_pk().get(&()), "CPU time not initialized");

        let last_block_usage_ppm = update_average_usage(
            &mut cpu_time.usage_history,
            &mut cpu_time.current_usage_ns,
            cpu_time.num_blocks_to_average,
            NetworkSpecs::get().cpu_ns,
            cpu_time.diff_adjust_id,
        );
        table.put(&cpu_time).unwrap();

        last_block_usage_ppm
    }

    pub fn price() -> u64 {
        DiffAdjust::call().get_diff(Self::get_check().diff_adjust_id)
    }

    pub fn set_thresholds(idle_ppm: u32, congested_ppm: u32) {
        validate_thresholds(idle_ppm, congested_ppm);
        DiffAdjust::call().set_targets(Self::get_check().diff_adjust_id, idle_ppm, congested_ppm);
    }

    pub fn set_change_rates(doubling_time_sec: u32, halving_time_sec: u32) {
        validate_change_rates(doubling_time_sec, halving_time_sec);

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

    pub fn set_billable_unit(amount_ns: u64) {
        let table = CpuPricingTable::read_write();
        let mut cpu_time = check_some(table.get_index_pk().get(&()), "CPU time not initialized");
        cpu_time.billable_unit = amount_ns;
        table.put(&cpu_time).unwrap();
    }
}

#[ComplexObject]
impl CpuPricing {
    /// The CPU usage as a percentage of the total CPU capacity averaged over the
    ///  last `num_blocks_to_average` blocks
    pub async fn avg_usage_pct(&self) -> String {
        avg_usage_pct_str(&self.usage_history, NetworkSpecs::get().cpu_ns)
    }

    /// The threshold percentages below/above which the CPU price will decrease/increase
    pub async fn thresholds(&self) -> Thresholds {
        get_thresholds_pct(Self::get_check().diff_adjust_id)
    }

    /// The price of CPU per billable unit of CPU
    pub async fn price_per_unit(&self) -> u64 {
        DiffAdjust::call().get_diff(self.diff_adjust_id)
    }
}
