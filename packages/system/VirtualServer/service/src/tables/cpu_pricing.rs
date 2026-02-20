use crate::tables::pricing_common::*;
use crate::tables::tables::*;
use async_graphql::ComplexObject;
use psibase::services::diff_adjust::Wrapper as DiffAdjust;
use psibase::*;
use std::cell::Cell;

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

    fn update_cpu<F: FnOnce(&mut CpuPricing)>(f: F) {
        let table = CpuPricingTable::read_write();
        let mut cpu = check_some(table.get_index_pk().get(&()), "CPU time not initialized");
        f(&mut cpu);
        table.put(&cpu).unwrap();
    }

    pub fn get_assert() -> Self {
        check_some(Self::get(), "CPU time not initialized")
    }

    pub fn get() -> Option<Self> {
        CpuPricingTable::read().get_index_pk().get(&())
    }

    pub fn set_num_blocks_to_average(num_blocks: u8) {
        Self::update_cpu(|cpu| cpu.num_blocks_to_average = num_blocks);
    }

    pub fn consume(amount_ns: u64) -> u64 {
        let price = Cell::new(0u64);
        let billable_unit = Cell::new(0u64);

        Self::update_cpu(|cpu_time| {
            cpu_time.current_usage_ns += amount_ns;

            price.set(cpu_time.price());
            billable_unit.set(cpu_time.billable_unit);
        });

        let billable_unit = billable_unit.get();
        let price = price.get();

        // Round up to the nearest billable unit
        let amount_units = (amount_ns + billable_unit - 1) / billable_unit;

        check_some(amount_units.checked_mul(price), "CPU usage overflow")
    }

    pub fn new_block() -> u32 {
        let last_block_usage_ppm = Cell::new(0u32);

        Self::update_cpu(|cpu_time| {
            last_block_usage_ppm.set(update_average_usage(
                &mut cpu_time.usage_history,
                &mut cpu_time.current_usage_ns,
                cpu_time.num_blocks_to_average,
                NetworkSpecs::get_assert().cpu_ns,
                cpu_time.diff_adjust_id,
            ));
        });

        last_block_usage_ppm.get()
    }

    pub fn price(&self) -> u64 {
        DiffAdjust::call().get_diff(self.diff_adjust_id)
    }

    pub fn set_thresholds(idle_ppm: u32, congested_ppm: u32) {
        validate_thresholds(idle_ppm, congested_ppm);
        DiffAdjust::call().set_targets(Self::get_assert().diff_adjust_id, idle_ppm, congested_ppm);
    }

    pub fn set_change_rates(doubling_time_sec: u32, halving_time_sec: u32) {
        validate_change_rates(doubling_time_sec, halving_time_sec);

        Self::update_cpu(|cpu| {
            cpu.doubling_time_sec = doubling_time_sec;
            cpu.halving_time_sec = halving_time_sec;
        });

        DiffAdjust::call().set_ppm(
            Self::get_assert().diff_adjust_id,
            time_to_rate_ppm(doubling_time_sec),
            time_to_rate_ppm(halving_time_sec),
        );
    }

    pub fn set_billable_unit(amount_ns: u64) {
        Self::update_cpu(|cpu| cpu.billable_unit = amount_ns);
    }

    pub fn get_billable_unit(&self) -> u64 {
        self.billable_unit
    }
}

#[ComplexObject]
impl CpuPricing {
    /// The CPU usage as a percentage of the total CPU capacity averaged over the
    ///  last `num_blocks_to_average` blocks
    pub async fn avg_usage_pct(&self) -> String {
        avg_usage_pct_str(&self.usage_history, NetworkSpecs::get_assert().cpu_ns)
    }

    /// The threshold percentages below/above which the CPU price will decrease/increase
    pub async fn thresholds(&self) -> Thresholds {
        get_thresholds_pct(Self::get_assert().diff_adjust_id)
    }

    /// The price of CPU per billable unit of CPU
    pub async fn price_per_unit(&self) -> u64 {
        self.price()
    }

    /// The total number of available units of CPU time
    ///
    /// For example, if CPU time is billed in milliseconds, then this returns
    /// the total number of milliseconds per second that are made available to
    /// transactions and are therefore billable.
    pub async fn available_units(&self) -> u64 {
        NetworkSpecs::get_assert().cpu_ns / self.billable_unit
    }
}
