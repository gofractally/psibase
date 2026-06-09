use crate::math_utils::*;
use crate::resource_type::ResourceType;
use crate::tables::tables::*;
use async_graphql::{ComplexObject, SimpleObject};
use psibase::services::diff_adjust::Wrapper as DiffAdjust;
use psibase::services::nft::Wrapper as Nft;
use psibase::services::tokens::{Quantity, Wrapper as Tokens};
use psibase::*;
use std::cell::Cell;

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

fn create_diff_adjust(doubling_time_sec: u32, halving_time_sec: u32) -> u32 {
    const DEFAULT_INITIAL_DIFFICULTY: u64 = 1;
    const DEFAULT_FLOOR_DIFFICULTY: u64 = DEFAULT_INITIAL_DIFFICULTY;
    const DEFAULT_WINDOW_SECONDS: u32 = 1;
    // Target utilization band: 45%-55% (in ppm). Below 45% the price decreases,
    //   above 55% it increases; in between it holds steady.
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

// Updates avg_usage with an exponentially-weighted average, then zeroes out current_usage.
// Increments the specified diff_adjust by the amount of the average usage in PPM (of total capacity).
fn update_average_usage(
    avg_usage: &mut u64,
    last_block_usage: &mut u64,
    num_blocks_to_average: u8,
    capacity: u64,
    diff_adjust_id: u32,
) -> u32 {
    let n = num_blocks_to_average as u64;

    // Exponential moving average (https://en.wikipedia.org/wiki/Exponential_smoothing):
    //   avg = α * sample + (1 − α) * avg_prev
    // Setting α = 1/N and multiplying through by N to keep everything in integer arithmetic:
    //   avg = (sample + (N − 1) * avg_prev) / N
    *avg_usage = (*last_block_usage + (n - 1) * *avg_usage) / n;

    let ppm = ratio_to_ppm(*avg_usage, capacity);

    // We need to clamp this to fit in u32 which is a DiffAdjust constraint.
    // This clamps it at u32 max, which means that if the usage is more than 4,294x over capacity,
    //   then we lose the real multiple.
    let ppm = ppm.min(u32::MAX as u128) as u32;

    DiffAdjust::call().increment(diff_adjust_id, ppm);

    *last_block_usage = 0;

    ppm
}

pub fn bill_user(user: AccountNumber, cost: u64, sub_account: Option<String>) {
    if cost == 0 {
        return;
    }
    let config = BillingConfig::get_assert();
    let sys = config.sys;

    let balance = UserSettings::get_resource_balance(user, sub_account.clone());
    let amt = Quantity::new(cost);

    if balance < amt {
        abort_message(&format!("{} has insufficient resource balance", user));
    }

    let user_key = UserSettings::to_sub_account_key(user, sub_account);

    Tokens::call().fromSub(sys, user_key, amt);
    Tokens::call().credit(sys, config.fee_receiver, amt, "".into());
}

fn capacity(resource: ResourceType) -> u64 {
    let specs = NetworkSpecs::get_assert();
    match resource {
        ResourceType::Net => specs.net_bps,
        ResourceType::Cpu => specs.cpu_ns,
        ResourceType::Disk => abort_message("Disk is not a rate-limited resource"),
    }
}

impl RateLimitPricing {
    pub fn initialize(
        resource: ResourceType,
        num_blocks_to_average: u8,
        doubling_time_sec: u32,
        halving_time_sec: u32,
        billable_unit: u64,
    ) {
        let row = RateLimitPricing {
            resource_id: resource.as_id(),
            num_blocks_to_average,
            avg_usage: 0,
            current_usage: 0,
            diff_adjust_id: create_diff_adjust(doubling_time_sec, halving_time_sec),
            doubling_time_sec,
            halving_time_sec,
            billable_unit,
        };
        RateLimitPricingTable::read_write().put(&row).unwrap();
    }

    fn update<F: FnOnce(&mut RateLimitPricing)>(resource: ResourceType, f: F) {
        let id = resource.as_id();
        let table = RateLimitPricingTable::read_write();
        let mut row = check_some(
            table.get_index_pk().get(&id),
            &format!("resource {} not initialized", resource.name()),
        );
        f(&mut row);
        table.put(&row).unwrap();
    }

    pub fn get_assert(resource: ResourceType) -> Self {
        check_some(
            Self::get(resource),
            &format!("resource {} not initialized", resource.name()),
        )
    }

    pub fn get(resource: ResourceType) -> Option<Self> {
        let id = resource.as_id();
        RateLimitPricingTable::read().get_index_pk().get(&id)
    }

    fn resource(&self) -> ResourceType {
        ResourceType::from_id(self.resource_id)
    }

    pub fn set_num_blocks_to_average(&self, num_blocks: u8) {
        Self::update(self.resource(), |r| r.num_blocks_to_average = num_blocks);
    }

    pub fn consume(
        &self,
        amount: u64,
        user: AccountNumber,
        sub_account: Option<String>,
        billing_enabled: bool,
    ) -> u64 {
        let resource = self.resource();
        let price = Cell::new(0u64);
        let billable_unit = Cell::new(0u64);

        Self::update(resource, |r| {
            r.current_usage += amount;
            price.set(r.price());
            billable_unit.set(r.billable_unit);
        });

        let billable_unit = billable_unit.get();
        let price = price.get();

        // Round up to the nearest billable unit
        let amount_units = amount.div_ceil(billable_unit);

        let mut cost = check_some(
            amount_units.checked_mul(price),
            &format!("{} usage overflow", resource.name()),
        );

        if !billing_enabled {
            cost = 0;
        }

        bill_user(user, cost, sub_account);

        cost
    }

    pub fn new_block(&self) -> u32 {
        let resource = self.resource();
        let last_block_usage_ppm = Cell::new(0u32);

        Self::update(resource, |r| {
            last_block_usage_ppm.set(update_average_usage(
                &mut r.avg_usage,
                &mut r.current_usage,
                r.num_blocks_to_average,
                capacity(resource),
                r.diff_adjust_id,
            ));
        });

        last_block_usage_ppm.get()
    }

    pub fn price(&self) -> u64 {
        DiffAdjust::call().get_diff(self.diff_adjust_id)
    }

    pub fn set_thresholds(&self, idle_ppm: u32, congested_ppm: u32) {
        check(
            idle_ppm < congested_ppm,
            "idle ppm must be less than congested ppm",
        );
        check(idle_ppm > 0, "idle ppm must be greater than 0%");
        check(
            congested_ppm < PPM as u32,
            "congested ppm must be less than 100%",
        );

        DiffAdjust::call().set_targets(self.diff_adjust_id, idle_ppm, congested_ppm);
    }

    pub fn set_change_rates(&self, doubling_time_sec: u32, halving_time_sec: u32) {
        check(
            doubling_time_sec > 0,
            "doubling time must be greater than 0",
        );
        check(halving_time_sec > 0, "halving time must be greater than 0");

        Self::update(self.resource(), |r| {
            r.doubling_time_sec = doubling_time_sec;
            r.halving_time_sec = halving_time_sec;
        });

        DiffAdjust::call().set_ppm(
            self.diff_adjust_id,
            time_to_rate_ppm(doubling_time_sec),
            time_to_rate_ppm(halving_time_sec),
        );
    }

    pub fn set_billable_unit(&self, unit: u64) {
        Self::update(self.resource(), |r| r.billable_unit = unit);
    }

    pub fn get_billable_unit(&self) -> u64 {
        self.billable_unit
    }
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

#[ComplexObject]
impl RateLimitPricing {
    /// The resource usage as a percentage of total capacity averaged over the
    /// last `num_blocks_to_average` blocks
    pub async fn avg_usage_pct(&self) -> String {
        let ppm = ratio_to_ppm(self.avg_usage, capacity(self.resource())) as u64;
        ppm_to_pct(ppm).to_string()
    }

    /// The threshold percentages below/above which the price will decrease/increase
    pub async fn thresholds(&self) -> Thresholds {
        let (target_min, target_max) = DiffAdjust::call().get_targets(self.diff_adjust_id);
        Thresholds {
            idle_pct: ppm_to_pct(target_min as u64).to_string(),
            congested_pct: ppm_to_pct(target_max as u64).to_string(),
        }
    }

    /// The price per billable unit
    pub async fn price_per_unit(&self) -> u64 {
        self.price()
    }

    /// The total number of available billable units
    pub async fn available_units(&self) -> u64 {
        capacity(self.resource()) / self.billable_unit
    }
}
