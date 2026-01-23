use crate::tables::pricing_common::*;
use crate::tables::tables::*;
use async_graphql::ComplexObject;
use psibase::services::diff_adjust::Wrapper as DiffAdjust;
use psibase::*;

impl NetPricing {
    pub fn initialize() {
        const DEFAULT_NUM_BLOCKS_TO_AVERAGE: u8 = 5;
        const DEFAULT_DOUBLING_TIME_SEC: u32 = 600;
        const DEFAULT_HALVING_TIME_SEC: u32 = 1800;

        let net_diff = NetPricing {
            num_blocks_to_average: DEFAULT_NUM_BLOCKS_TO_AVERAGE,
            usage_history: Vec::new(),
            current_usage_bps: 0,
            diff_adjust_id: create_diff_adjust(DEFAULT_DOUBLING_TIME_SEC, DEFAULT_HALVING_TIME_SEC),
            doubling_time_sec: DEFAULT_DOUBLING_TIME_SEC,
            halving_time_sec: DEFAULT_HALVING_TIME_SEC,
            billable_unit: 8, // Bill per-byte
        };
        NetPricingTable::read_write().put(&net_diff).unwrap();
    }

    fn get_assert() -> Self {
        check_some(Self::get(), "Network bandwidth not initialized")
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

        let price = Self::price();

        // Round up to the nearest billable unit
        let amount_units = (amount_bits + bandwidth.billable_unit - 1) / bandwidth.billable_unit;

        let cost = amount_units.saturating_mul(price);
        check(cost < u64::MAX, "network usage overflow");
        cost
    }

    pub fn new_block() -> u32 {
        let table = NetPricingTable::read_write();
        let mut bandwidth = check_some(
            table.get_index_pk().get(&()),
            "Network bandwidth not initialized",
        );

        let last_block_usage_ppm = update_average_usage(
            &mut bandwidth.usage_history,
            &mut bandwidth.current_usage_bps,
            bandwidth.num_blocks_to_average,
            NetworkSpecs::get().net_bps,
            bandwidth.diff_adjust_id,
        );
        table.put(&bandwidth).unwrap();

        last_block_usage_ppm
    }

    pub fn price() -> u64 {
        DiffAdjust::call().get_diff(Self::get_assert().diff_adjust_id)
    }

    pub fn set_thresholds(idle_ppm: u32, congested_ppm: u32) {
        validate_thresholds(idle_ppm, congested_ppm);
        DiffAdjust::call().set_targets(Self::get_assert().diff_adjust_id, idle_ppm, congested_ppm);
    }

    pub fn set_change_rates(doubling_time_sec: u32, halving_time_sec: u32) {
        validate_change_rates(doubling_time_sec, halving_time_sec);

        let table = NetPricingTable::read_write();
        let mut bw = check_some(
            table.get_index_pk().get(&()),
            "Network bandwidth not initialized",
        );
        bw.doubling_time_sec = doubling_time_sec;
        bw.halving_time_sec = halving_time_sec;
        table.put(&bw).unwrap();

        DiffAdjust::call().set_percent(
            Self::get_assert().diff_adjust_id,
            time_to_rate_ppm(doubling_time_sec),
            time_to_rate_ppm(halving_time_sec),
        );
    }

    pub fn set_billable_unit(amount_bits: u64) {
        let table = NetPricingTable::read_write();
        let mut bandwidth = check_some(
            table.get_index_pk().get(&()),
            "Network bandwidth not initialized",
        );
        bandwidth.billable_unit = amount_bits;
        table.put(&bandwidth).unwrap();
    }
}

#[ComplexObject]
impl NetPricing {
    /// The network usage as a percentage of the total network bandwidth capacity averaged
    ///  over the last `num_blocks_to_average` blocks
    pub async fn avg_usage_pct(&self) -> String {
        avg_usage_pct_str(&self.usage_history, NetworkSpecs::get().net_bps)
    }

    /// The threshold percentages below/above which the network bandwidth price
    /// will decrease/increase
    pub async fn thresholds(&self) -> Thresholds {
        get_thresholds_pct(Self::get_assert().diff_adjust_id)
    }

    /// The price of network bandwidth per billable unit of network bandwidth
    pub async fn price_per_unit(&self) -> u64 {
        DiffAdjust::call().get_diff(self.diff_adjust_id)
    }

    /// The total number of available units of network bandwidth
    ///
    /// For example, if network bandwidth is billed in bytes per second, then this returns
    /// the total number of bytes per second that are available to transactions and
    ///  are therefore billable.
    pub async fn available_units(&self) -> u64 {
        NetworkSpecs::get().net_bps / self.billable_unit
    }
}
