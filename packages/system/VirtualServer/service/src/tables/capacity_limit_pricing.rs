//! # Capacity-limit pricing
//!
//! Resources in this category are limited by **total consumed capacity** relative to a maximum
//! (e.g. objective storage bytes). This module implements that pricing with a constant-product curve between
//!
//! - a **reserve token** (the unit used to pay for access to the resource), and
//! - a **resource share token** (representing a claim on remaining resource capacity).
//!
//! The relay is configured so that the entire resource capacity can be consumed (i.e. the pool can
//! reach 0 available resources) when a fixed budget of reserve tokens is sold into the pool.
//!
//! Offsets to the normal hyperbola are used in this design to avoid the price->infinity
//! behavior of the vanilla $x y = k$ curve.
//!
//! ## System goals
//!
//! 1. **Full resource consumption**
//! * Full consumption of the resource supply corresponds to the pool reaching $y = 0$.
//! * Selling the configured reserve-token budget into the pool is required.
//! * According to this system's perspective, full utilization of the resource is theoretically possible.
//!   But any necessary external uses for the reserve token imply that full utilization is impossible.
//!
//! 2. **Support resource-capacity increases**
//! * $y_{\max}$ must be increasable dynamically to allow capacity upgrades.
//! * Capacity decrease need not be supported.
//!
//! 3. **Support reserve-token supply decreases**
//! * When the reserve-token supply drops (e.g. burns), $x_{\max}$ must be reducible without changing
//!   $y_{\max}$.
//!
//! ## Solution
//!
//! **Real pool reserves** are distinguished from **virtual reserves**.
//!
//! Let:
//!
//! - $x$: pool reserve of **real** reserve tokens
//! - $y$: pool reserve of **real** resource-share tokens (remaining capacity)
//! - $x_{\max}$: total reserve-token budget that may be sold into the relay
//! - $y_{\max}$: total resource capacity
//! - $x_0$: an offset of **virtual** reserve tokens that cannot be withdrawn
//! - $y_0$: an offset of **virtual** resource-share tokens that cannot be withdrawn
//!
//! Interpretation:
//!
//! - At initialization, all resource capacity is held by the pool: $(x, y) = (0, y_{\max})$.
//! - As the resource is consumed, $x$ increases and $y$ decreases.
//! - Full consumption corresponds to $(x, y) = (x_{\max}, 0)$.
//!

use crate::math_utils::PPM;
use crate::resource_type::ResourceType;
use crate::tables::tables::*;
use async_graphql::ComplexObject;
use psibase::services::tokens::{Decimal, Precision, Quantity, Wrapper as Tokens};
use psibase::*;

// Note: `pub(crate)` is used so the functions are available for the unit tests

fn relay_sub(resource: ResourceType) -> String {
    UserSettings::to_sub_account_key(
        crate::Wrapper::SERVICE,
        Some(format!("{}:relay", resource.name().to_lowercase())),
    )
}

pub(crate) struct Curve {
    pub(crate) x0: u64,
    pub(crate) y0: u64,
    pub(crate) k: u128,
    max_reserve: u64,
}

#[allow(non_snake_case)]
pub(crate) struct CurvePosition {
    pub(crate) reserves: u64,

    X: u128,
    Y: u128,
    k: u128,
    max_reserve: u64,
}

/// This is a constant product curve, where the fundamental equation is XY = k. In this case,
/// we derive X = (x+x0) and Y = (y+y0) where x0 and y0 are virtual offsets.
///
/// Evaluating k = XY at each endpoint and equating yields:
/// x0(y_max+y0) = y0(x_max + x0)
///
/// Algebraically simplifying yields:
/// x_max / x0 = y_max / y0
///
/// We refer to this single constant as the "shape parameter", or `D`. D controls how "aggressive"
/// pricing is near the endpoints. Smaller D means larger offsets (flatter), larger D means
/// smaller offsets (steeper).
impl Curve {
    /// All parameters can be expressed in terms of x_max, y_max, and D.
    /// x0 = x_max / D
    /// y0 = y_max / D
    /// k = (x_max + x0) * y0
    ///
    /// Substituting yields:
    /// k = (x_max * y_max)(D+1) / D^2
    pub(crate) fn new(max_reserves: u64, max_resources: u64, curve_d: u64) -> Self {
        let xm = max_reserves as u128;
        let ym = max_resources as u128;
        let d = curve_d as u128;

        // `xm * ym * (d + 1)` stays within u128 because `check_curve_params`
        // bounds `max_reserve * max_capacity * (curve_d + 1)` whenever those
        // inputs are set.
        //
        // Flooring x0/y0 and ceiling k all bias `pos_from_resources`'
        // `ceil(k / (resources + y0)) - x0` upward, keeping the pool capitalized.
        Curve {
            x0: (max_reserves / curve_d),
            y0: (max_resources / curve_d),
            k: (xm * ym * (d + 1)).div_ceil(d * d),
            max_reserve: max_reserves,
        }
    }

    /// Positions the curve by solving for reserves from resources.
    /// reserves = ceil(k / (resources + y0)) - x0
    ///
    /// Rounds the required reserves up, keeping the pool fully capitalized.
    pub(crate) fn pos_from_resources(&self, resources: u64) -> CurvePosition {
        let Y = resources as u128 + self.y0 as u128;
        // True reserves never exceed `max_reserve`; clamp so the upward rounding
        // bias can't push past it and wrap the `as u64` cast.
        let reserves = (self.k.div_ceil(Y) - self.x0 as u128).min(self.max_reserve as u128) as u64;
        CurvePosition {
            reserves,
            X: reserves as u128 + self.x0 as u128,
            Y,
            k: self.k,
            max_reserve: self.max_reserve,
        }
    }
}

impl CurvePosition {
    // Cost of consuming `amount` units of resource.
    // delta_x = ceil(k / (Y - delta_y)) - X
    pub(crate) fn cost_of(&self, amount_consumed: u64) -> u64 {
        if amount_consumed == 0 {
            return 0;
        }
        let dy = amount_consumed as u128;

        check(self.Y > dy, "Insufficient capacity");

        let new_Y = self.Y - dy;
        let required_X = self.k.div_ceil(new_Y);
        let dx = check_some(required_X.checked_sub(self.X), "Excess reserve detected");

        // Cap the charge at the remaining reserve budget. Without this, cost
        // overflows u64 when `max_reserve == u64::MAX` and remaining capacity
        // is near zero (due to ceil(k) bias).
        let dx = dx.min((self.max_reserve - self.reserves) as u128);

        // `dx <= max_reserve <= u64::MAX` after the cap so this cannot fail
        u64::try_from(dx).expect("cost exceeds u64")
    }

    // Gross refund for freeing `amount` units of resource.
    // delta_x = X - ceil(k / (Y + delta_y))
    pub(crate) fn refund_of(&self, amount_freed: u64) -> u64 {
        if amount_freed == 0 {
            return 0;
        }
        let dy = amount_freed as u128;

        let new_Y = self.Y + dy;

        // Required reserve at the higher (freed) capacity level
        let new_X = self.k.div_ceil(new_Y);
        let dx = self.X.saturating_sub(new_X);

        dx as u64
    }

    // Spot price: X / Y
    pub(crate) fn spot_price(&self) -> u64 {
        (self.X / self.Y).min(u64::MAX as u128) as u64
    }
}

/// Ensures a valid curve parameterization
pub(crate) fn validate_curve_params(
    max_reserve: u64,
    max_capacity: u64,
    curve_d: u64,
) -> Result<(), &'static str> {
    if max_reserve == 0 {
        return Err("max_reserve must be > 0");
    }
    if max_capacity == 0 {
        return Err("max_capacity must be > 0");
    }
    // `curve_d` divides into the offsets; zero would divide by zero in `Curve::new`.
    if curve_d == 0 {
        return Err("curve_d must be > 0");
    }
    // Keeps `x0 = max_reserve / curve_d >= 1`; with `x0 = 0` the curve never reaches
    // `reserves = 0` at full capacity
    if max_reserve < curve_d {
        return Err("max_reserve must be >= curve_d");
    }
    // Keeps `y0 = max_capacity / curve_d >= 1`; with `y0 = 0`, `Y` reaches 0 at the
    // full-consumption endpoint and `k / Y` divides by zero.
    if max_capacity < curve_d {
        return Err("max_capacity must be >= curve_d");
    }
    // `Curve::new`'s `k` numerator `max_reserve * max_capacity * (curve_d + 1)` must fit
    // u128, otherwise the constant-product computation silently overflows.
    let fits_u128 = (max_reserve as u128)
        .checked_mul(max_capacity as u128)
        .and_then(|v| v.checked_mul(curve_d as u128 + 1))
        .is_some();
    if !fits_u128 {
        return Err("curve parameters too large: pricing math would overflow");
    }

    Ok(())
}

pub(crate) fn check_curve_params(max_reserve: u64, max_capacity: u64, curve_d: u64) {
    if let Err(msg) = validate_curve_params(max_reserve, max_capacity, curve_d) {
        abort_message(msg);
    }
}

impl CapacityPricing {
    pub(crate) fn resource(&self) -> ResourceType {
        ResourceType::from_id(self.resource_id)
    }

    fn update<F: FnOnce(&mut CapacityPricing)>(resource: ResourceType, f: F) {
        let id = resource.as_id();
        let table = CapacityPricingTable::read_write();
        let mut pricing = check_some(
            table.get_index_pk().get(&id),
            "Capacity pricing not initialized",
        );
        f(&mut pricing);
        table.put(&pricing).unwrap();
    }

    fn curve(&self) -> Curve {
        Curve::new(self.max_reserve, self.max_capacity, self.curve_d)
    }

    /// Reserve token backing required in the relay for the current curve position.
    pub(crate) fn required_reserve(&self) -> u64 {
        self.curve()
            .pos_from_resources(self.remaining_capacity)
            .reserves
    }

    fn cost_of(&self, amount_consumed: u64) -> u64 {
        if amount_consumed > self.remaining_capacity {
            abort_message(&format!("Insufficient {} capacity", self.resource().name()));
        }

        self.curve()
            .pos_from_resources(self.remaining_capacity)
            .cost_of(amount_consumed)
    }

    fn refund_of(&self, amount_freed: u64) -> u64 {
        let gross = self
            .curve()
            .pos_from_resources(self.remaining_capacity)
            .refund_of(amount_freed);
        let fee = (gross as u128 * self.fee_ppm as u128 / PPM) as u64;
        gross - fee
    }

    pub fn initialize(resource: ResourceType, max_capacity: u64, curve_d: u64, fee_ppm: u32) {
        // Since reducing the reserve (burning) is supported, we can initialize
        //   the reserve now at u64::MAX and then reduce it later (if needed) when
        //   the total system token supply is known.
        let max_reserve = u64::MAX;

        check(fee_ppm <= PPM as u32, "fee_ppm must be <= 1,000,000");
        check_curve_params(max_reserve, max_capacity, curve_d);

        let id = resource.as_id();
        let table = CapacityPricingTable::read_write();
        check(
            table.get_index_pk().get(&id).is_none(),
            &format!(
                "Capacity pricing already initialized for resource {}",
                resource.name()
            ),
        );

        table
            .put(&CapacityPricing {
                resource_id: id,
                remaining_capacity: max_capacity,
                max_reserve,
                max_capacity,
                curve_d,
                fee_ppm,
                prealloc_deficit: 0,
            })
            .unwrap();
    }

    /// Creates the relay sub-account that holds reserve tokens for `resource`.
    pub fn create_relay(resource: ResourceType) {
        Tokens::call().createSub(relay_sub(resource));
    }

    pub fn get(resource: ResourceType) -> Option<Self> {
        let id = resource.as_id();
        CapacityPricingTable::read().get_index_pk().get(&id)
    }

    pub fn get_assert(resource: ResourceType) -> Self {
        check_some(Self::get(resource), "Capacity pricing not initialized")
    }

    /// Live reserve-token balance held in the relay sub-account
    fn actual_relay_balance(&self) -> u64 {
        match BillingConfig::get() {
            Some(config) => {
                Tokens::call()
                    .getSubBal(config.sys, relay_sub(self.resource()))
                    .unwrap_or(0.into())
                    .value
            }
            None => 0,
        }
    }

    /// Signed relay discrepancy: the required reserve minus the actual relay
    /// balance.
    ///
    /// Returns a positive value if there is a shortfall (tokens owed to the relay),
    /// or returns a negative value if there is an excess (tokens beyond what the
    /// curve expects).
    pub(crate) fn relay_net(&self) -> i128 {
        self.required_reserve() as i128 - self.actual_relay_balance() as i128
    }

    pub fn get_cost(&self, amount_consumed: u64) -> Quantity {
        Quantity::new(self.cost_of(amount_consumed))
    }

    pub fn refund_quote(&self, amount_freed: u64) -> Quantity {
        Quantity::new(self.refund_of(amount_freed))
    }

    pub fn consume(&self, amount_consumed: u64) -> u64 {
        let resource = self.resource();
        let mut cost = 0u64;
        Self::update(resource, |p| {
            // Refilling a prealloc deficit is free; only the remainder is billed.
            let restored = amount_consumed.min(p.prealloc_deficit);
            p.prealloc_deficit -= restored;
            let billable = amount_consumed - restored;

            check(
                billable <= p.remaining_capacity,
                &format!("Insufficient {} capacity", resource.name()),
            );
            cost = p
                .curve()
                .pos_from_resources(p.remaining_capacity)
                .cost_of(billable);
            p.remaining_capacity -= billable;
        });
        cost
    }

    pub fn free(&self, amount_freed: u64) -> (u64, u64) {
        let resource = self.resource();
        let mut gross_refund = 0u64;
        let mut fee_ppm_val = 0u32;
        Self::update(resource, |p| {
            let consumed = p.max_capacity - p.remaining_capacity;

            // Freeing past `consumed` dips into prealloc: unrefundable, tracked as
            // a deficit that later writes refill for free.
            let refundable = amount_freed.min(consumed);
            p.prealloc_deficit += amount_freed - refundable;

            gross_refund = p
                .curve()
                .pos_from_resources(p.remaining_capacity)
                .refund_of(refundable);
            p.remaining_capacity += refundable;
            fee_ppm_val = p.fee_ppm;
        });

        let fee = (gross_refund as u128 * fee_ppm_val as u128 / PPM) as u64;
        let refund = gross_refund - fee;
        (refund, fee)
    }

    pub fn set_capacity(&self, new_max_capacity: u64) {
        check(
            new_max_capacity >= self.max_capacity,
            "Capacity can only increase",
        );
        check_curve_params(self.max_reserve, new_max_capacity, self.curve_d);
        let delta = new_max_capacity - self.max_capacity;
        if delta > 0 {
            self.increase_capacity(delta);
        }
    }

    fn increase_capacity(&self, delta_bytes: u64) {
        check(delta_bytes > 0, "invalid capacity increase");

        Self::update(self.resource(), |p| {
            let old_reserve = p.required_reserve();

            p.max_capacity += delta_bytes;
            p.remaining_capacity += delta_bytes;

            check(
                p.required_reserve() <= old_reserve,
                "required reserve rose after capacity increase",
            );
        });
    }

    pub fn reduce_reserve_budget(&self, delta_supply: u64) {
        check(delta_supply > 0, "invalid reserve budget decrease");
        let new_max_reserve = check_some(
            self.max_reserve.checked_sub(delta_supply),
            "reserve budget decrease exceeds max_reserve",
        );
        check_curve_params(new_max_reserve, self.max_capacity, self.curve_d);

        let mut to_remove = 0u64;
        Self::update(self.resource(), |p| {
            let old_reserve = p.required_reserve();

            p.max_reserve -= delta_supply;

            // ceil so pool requires >= ideal reserve, meaning we remove less
            to_remove = old_reserve.saturating_sub(p.required_reserve());
        });

        let consumed = self.max_capacity - self.remaining_capacity;
        check(
            consumed == 0 || to_remove > 0,
            "reserve budget decrease freed no reserves",
        );
    }

    /// Moves `delta` system tokens between vserver's primary balance and the relay
    /// subaccount (positive = into the relay, negative = out).
    pub(crate) fn settle_relay(resource: ResourceType, delta: i128) {
        let sys = BillingConfig::get_assert().sys;
        let sub = relay_sub(resource);
        if delta > 0 {
            Tokens::call().toSub(sys, sub, Quantity::new(delta as u64));
        } else if delta < 0 {
            Tokens::call().fromSub(sys, sub, Quantity::new((-delta) as u64));
        }
    }

    /// Settles the relay drift using up to `available` tokens, returning the leftover.
    pub(crate) fn settle_drift(resource: ResourceType, available: u64) -> u64 {
        let drift = Self::get_assert(resource).relay_net();
        let available = available as i128;

        let (relay_move, remaining): (i128, i128) = if drift > 0 {
            let covered = drift.min(available);
            (covered, available - covered)
        } else {
            (drift, available - drift)
        };

        Self::settle_relay(resource, relay_move);
        remaining as u64
    }

    pub fn utilization_ppm(&self) -> u32 {
        if self.max_capacity == 0 {
            return 0;
        }
        let consumed = self.max_capacity - self.remaining_capacity;
        ((consumed as u128 * PPM) / self.max_capacity as u128) as u32
    }
}

/// Returns the system-token precision, or precision 0 if billing has not yet
/// been initialized (in which case decimals fall back to displaying raw values).
fn sys_token_precision() -> Precision {
    BillingConfig::get()
        .map(|_| BillingConfig::get_sys_token().precision)
        .unwrap_or_else(|| Precision::new(0).unwrap())
}

fn sys_decimal(value: u64) -> Decimal {
    Decimal::new(Quantity::new(value), sys_token_precision())
}

#[ComplexObject]
impl CapacityPricing {
    /// Reserve tokens required by the current curve position, denominated in the system token.
    pub async fn reserve(&self) -> Decimal {
        sys_decimal(self.required_reserve())
    }

    /// Max reserve tokens that may be sold into the relay, denominated in the system token.
    pub async fn max_reserve(&self) -> Decimal {
        sys_decimal(self.max_reserve)
    }

    /// Spot price, denominated in the system token.
    pub async fn spot_price(&self) -> Decimal {
        let price = self
            .curve()
            .pos_from_resources(self.remaining_capacity)
            .spot_price();
        sys_decimal(price)
    }

    pub async fn utilization_pct(&self) -> String {
        let ppm = self.utilization_ppm() as u64;
        Decimal::new(ppm.into(), Precision::new(4).unwrap()).to_string()
    }

    pub async fn fee_pct(&self) -> String {
        let ppm = self.fee_ppm as u64;
        Decimal::new(ppm.into(), Precision::new(4).unwrap()).to_string()
    }

    /// Reserve tokens owed to the relay but not yet deposited,
    /// denominated in the system token.
    pub async fn relay_shortfall(&self) -> Decimal {
        sys_decimal(self.relay_net().max(0) as u64)
    }

    /// Reserve tokens in the relay beyond what the curve expects,
    /// denominated in the system token.
    pub async fn relay_excess(&self) -> Decimal {
        sys_decimal((-self.relay_net()).max(0) as u64)
    }
}
