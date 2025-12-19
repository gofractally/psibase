use crate::tables::tables::*;
use psibase::services::diff_adjust::Wrapper as DiffAdjust;
use psibase::services::nft::Wrapper as Nft;
use psibase::*;

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

impl NetworkBandwidth {
    pub fn initialize() {
        const DEFAULT_NUM_BLOCKS_TO_AVERAGE: u8 = 5;

        const DEFAULT_INITIAL_DIFFICULTY: u64 = 1;
        const DEFAULT_FLOOR_DIFFICULTY: u64 = DEFAULT_INITIAL_DIFFICULTY;
        const DEFAULT_WINDOW_SECONDS: u32 = 1;
        const DEFAULT_TARGET_MIN: u32 = 45_0000; // 45% usage
        const DEFAULT_TARGET_MAX: u32 = 55_0000; // 55% usage
        const DEFAULT_INCREASE_PPM: u32 = 0_1156; // 0.1156% = 10-minute doubling rate
        const DEFAULT_DECREASE_PPM: u32 = 0_0385; // 0.0385% = 30 minute halving rate

        let diff_adjust_id = DiffAdjust::call().create(
            DEFAULT_INITIAL_DIFFICULTY,
            DEFAULT_WINDOW_SECONDS,
            DEFAULT_TARGET_MIN,
            DEFAULT_TARGET_MAX,
            DEFAULT_FLOOR_DIFFICULTY,
            DEFAULT_INCREASE_PPM,
            DEFAULT_DECREASE_PPM,
        );
        Nft::call().debit(diff_adjust_id, "".into());
        let network_bandwidth = NetworkBandwidth {
            num_blocks_to_average: DEFAULT_NUM_BLOCKS_TO_AVERAGE,
            usage_history: Vec::new(),
            current_usage_bps: 0,
            diff_adjust_id,
        };
        NetworkBandwidthTable::read_write()
            .put(&network_bandwidth)
            .unwrap();
    }

    fn get() -> Self {
        check_some(
            NetworkBandwidthTable::read().get_index_pk().get(&()),
            "Network bandwidth not initialized",
        )
    }

    pub fn set_num_blocks_to_average(num_blocks: u8) {
        let table = NetworkBandwidthTable::read_write();
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

        let table = NetworkBandwidthTable::read_write();
        let mut bandwidth =
            check_some(table.get_index_pk().get(&()), "Billing not yet initialized");
        bandwidth.current_usage_bps += amount_bits;
        table.put(&bandwidth).unwrap();

        let price_per_byte = Self::price(); // Maybe this should be price per 100 bytes?
        let price = amount_bytes.saturating_mul(price_per_byte);
        check(price < u64::MAX, "network usage overflow");
        price
    }

    pub fn new_block() -> u32 {
        let table = NetworkBandwidthTable::read_write();
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
        DiffAdjust::call().get_diff(Self::get().diff_adjust_id)
    }

    pub fn set_thresholds(idle_ppm: u32, congested_ppm: u32) {
        DiffAdjust::call().set_targets(Self::get().diff_adjust_id, idle_ppm, congested_ppm);
    }

    pub fn set_price_rates(doubling_time_sec: u32, halving_time_sec: u32) {
        check(
            doubling_time_sec > 0,
            "doubling time must be greater than 0",
        );
        check(halving_time_sec > 0, "halving time must be greater than 0");
        let increase_ppm = time_to_rate_ppm(doubling_time_sec);
        let decrease_ppm = time_to_rate_ppm(halving_time_sec);
        DiffAdjust::call().set_percent(Self::get().diff_adjust_id, increase_ppm, decrease_ppm);
    }
}
