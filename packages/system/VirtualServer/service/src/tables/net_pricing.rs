use crate::tables::pricing_common::*;
use crate::tables::tables::*;
use async_graphql::ComplexObject;
use psibase::services::diff_adjust::Wrapper as DiffAdjust;
use psibase::*;
use std::cell::Cell;

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

    fn update_net<F: FnOnce(&mut NetPricing)>(f: F) {
        let table = NetPricingTable::read_write();
        let mut net = check_some(
            table.get_index_pk().get(&()),
            "Network bandwidth not initialized",
        );
        f(&mut net);
        table.put(&net).unwrap();
    }

    fn get_assert() -> Self {
        check_some(Self::get(), "Network bandwidth not initialized")
    }

    pub fn get() -> Option<Self> {
        NetPricingTable::read().get_index_pk().get(&())
    }

    pub fn set_num_blocks_to_average(num_blocks: u8) {
        Self::update_net(|net| net.num_blocks_to_average = num_blocks);
    }

    pub fn consume(amount_bytes: u64) -> u64 {
        let amount_bits = check_some(amount_bytes.checked_mul(8), "network usage overflow");

        let price = Cell::new(0u64);
        let billable_unit = Cell::new(0u64);

        Self::update_net(|net| {
            net.current_usage_bps += amount_bits;

            price.set(net.price());
            billable_unit.set(net.billable_unit);
        });

        let billable_unit = billable_unit.get();
        let price = price.get();

        // Round up to the nearest billable unit
        let amount_units = (amount_bits + billable_unit - 1) / billable_unit;

        check_some(amount_units.checked_mul(price), "network usage overflow")
    }

    pub fn new_block() -> u32 {
        let last_block_usage_ppm = Cell::new(0u32);

        Self::update_net(|net| {
            last_block_usage_ppm.set(update_average_usage(
                &mut net.usage_history,
                &mut net.current_usage_bps,
                net.num_blocks_to_average,
                NetworkSpecs::get_assert().net_bps,
                net.diff_adjust_id,
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

        Self::update_net(|net| {
            net.doubling_time_sec = doubling_time_sec;
            net.halving_time_sec = halving_time_sec;
        });

        DiffAdjust::call().set_ppm(
            Self::get_assert().diff_adjust_id,
            time_to_rate_ppm(doubling_time_sec),
            time_to_rate_ppm(halving_time_sec),
        );
    }

    pub fn set_billable_unit(amount_bits: u64) {
        Self::update_net(|net| net.billable_unit = amount_bits);
    }

    pub fn get_billable_unit(&self) -> u64 {
        self.billable_unit
    }
}

#[ComplexObject]
impl NetPricing {
    /// The network usage as a percentage of the total network bandwidth capacity averaged
    ///  over the last `num_blocks_to_average` blocks
    pub async fn avg_usage_pct(&self) -> String {
        avg_usage_pct_str(&self.usage_history, NetworkSpecs::get_assert().net_bps)
    }

    /// The threshold percentages below/above which the network bandwidth price
    /// will decrease/increase
    pub async fn thresholds(&self) -> Thresholds {
        get_thresholds_pct(Self::get_assert().diff_adjust_id)
    }

    /// The price of network bandwidth per billable unit of network bandwidth
    pub async fn price_per_unit(&self) -> u64 {
        self.price()
    }

    /// The total number of available units of network bandwidth
    ///
    /// For example, if network bandwidth is billed in bytes per second, then this returns
    /// the total number of bytes per second that are available to transactions and
    ///  are therefore billable.
    pub async fn available_units(&self) -> u64 {
        NetworkSpecs::get_assert().net_bps / self.billable_unit
    }
}
