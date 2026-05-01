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

use crate::resource_type::ResourceType;
use crate::tables::tables::*;
use async_graphql::{ComplexObject, Object};
use psibase::services::tokens::{Decimal, Precision, Quantity, Wrapper as Tokens};
use psibase::*;
use std::cell::Cell;

use crate::math_utils::PPM;

// Note: `pub(crate)` is used so the functions are available for the unit tests

fn relay_sub(resource: ResourceType) -> String {
    format!("{}.relay", resource.name().to_lowercase())
}

fn is_billing_active() -> bool {
    BillingConfig::get().map(|c| c.enabled).unwrap_or(false)
}

impl VirtualBalance {
    pub fn net(&self) -> i128 {
        self.shortfall as i128 - self.excess as i128
    }

    pub fn add(&mut self, delta: i128) {
        let current = self.net() + delta;
        if current >= 0 {
            self.shortfall = current as u64;
            self.excess = 0;
        } else {
            self.shortfall = 0;
            self.excess = (-current) as u64;
        }
    }

    pub fn is_zero(&self) -> bool {
        self.shortfall == 0 && self.excess == 0
    }

    pub fn settle(&mut self) -> i128 {
        let net = self.net();
        self.shortfall = 0;
        self.excess = 0;
        net
    }
}

pub(crate) struct Curve {
    pub(crate) x0: u64,
    pub(crate) y0: u64,
    pub(crate) k: u128,
}

pub(crate) struct CurvePosition {
    pub(crate) reserves: u64,

    x: u128,
    y: u128,
    k: u128,
}

/// This is a constant product curve, where the fundamental equation is XY = k. In this case,
/// we derive X = (x+x0) and Y = (y+y0) where x0 and y0 are virtual offsets.
///
/// Plugging in our curve endpoints yields:
/// k = x0(y_max+y0) = y0(x_max + x0)
///
/// Algebraically simplifying yields:
/// k = x_max / x0 = y_max / y0
///
/// We refer to this single constant as the "shape parameter", or `D`. D controls how "aggressive"
/// pricing is near the endpoints. Smaller D means larger offsets (smoother), larger D means
/// smaller offsets (more aggressive).
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
        Curve {
            x0: (max_reserves / curve_d),
            y0: (max_resources / curve_d),
            k: (xm * ym * (d + 1)).div_ceil(d * d),
        }
    }

    /// Positions the curve by solving for reserves from resources.
    /// reserves = ceil(k / (resources + y0)) - x0
    ///
    /// Rounds the required reserves up, keeping the pool fully capitalized.
    pub(crate) fn pos_from_resources(&self, resources: u64) -> CurvePosition {
        let y = resources as u128 + self.y0 as u128;
        let reserves = (self.k.div_ceil(y) - self.x0 as u128) as u64;
        CurvePosition {
            reserves,
            x: reserves as u128 + self.x0 as u128,
            y,
            k: self.k,
        }
    }
}

impl CurvePosition {
    // Cost of consuming `amount` units of resource.
    // delta_x = ceil(k / (Y - delta_y)) - X
    // Rounds UP (user pays more).
    pub(crate) fn cost_of(&self, amount_consumed: u64) -> u64 {
        if amount_consumed == 0 {
            return 0;
        }
        let dy = amount_consumed as u128;

        check(self.y > dy, "Insufficient disk capacity");

        let new_y = self.y - dy;
        let required_x = self.k.div_ceil(new_y);
        let dx = check_some(required_x.checked_sub(self.x), "Excess reserve detected");

        dx as u64
    }

    // Gross refund for freeing `amount` units of resource.
    // delta_x = X - ceil(k / (Y + delta_y))
    // Rounds down (user receives less).
    pub(crate) fn refund_of(&self, amount_freed: u64) -> u64 {
        if amount_freed == 0 {
            return 0;
        }
        let dy = amount_freed as u128;

        let new_y = self.y + dy;

        // ceil division here makes the subtracted term larger, so dx is smaller
        let new_x = self.k.div_ceil(new_y);
        let dx = self.x.saturating_sub(new_x);

        dx as u64
    }

    // Spot price: X / Y
    pub(crate) fn spot_price(&self) -> u64 {
        (self.x / self.y) as u64
    }
}

fn is_system(user: AccountNumber) -> bool {
    user == AccountNumber::from("system")
}

impl CapacityPricing {
    fn resource(&self) -> ResourceType {
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

    fn cost_of(&self, amount_consumed: u64) -> u64 {
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

        check(max_capacity > 0, "max_capacity must be > 0");
        check(curve_d > 0, "curve_d must be > 0");
        check(fee_ppm > 0, "fee_ppm must be > 0");
        check(fee_ppm <= PPM as u32, "fee_ppm must be <= 1,000,000");

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
                reserve: 0,
                remaining_capacity: max_capacity,
                max_reserve,
                max_capacity,
                curve_d,
                fee_ppm,
                virtual_balance: VirtualBalance::default(),
            })
            .unwrap();

        Tokens::call().createSub(relay_sub(resource));
    }

    pub fn get(resource: ResourceType) -> Option<Self> {
        let id = resource.as_id();
        CapacityPricingTable::read().get_index_pk().get(&id)
    }

    pub fn get_assert(resource: ResourceType) -> Self {
        check_some(Self::get(resource), "Capacity pricing not initialized")
    }

    pub fn get_cost(&self, amount_consumed: u64) -> Quantity {
        Quantity::new(self.cost_of(amount_consumed))
    }

    pub fn refund_quote(&self, amount_freed: u64) -> Quantity {
        Quantity::new(self.refund_of(amount_freed))
    }

    pub fn consume(
        &self,
        amount_consumed: u64,
        user: AccountNumber,
        sub_account: Option<String>,
    ) -> u64 {
        let resource = self.resource();
        let cost = Cell::new(0u64);
        let billing_active = is_billing_active();
        let system_write = is_system(user);
        Self::update(resource, |p| {
            check(
                amount_consumed <= p.remaining_capacity,
                "Insufficient disk capacity",
            );
            let c = p
                .curve()
                .pos_from_resources(p.remaining_capacity)
                .cost_of(amount_consumed);
            p.reserve += c;
            p.remaining_capacity -= amount_consumed;
            cost.set(c);

            if !billing_active || system_write {
                p.virtual_balance.add(c as i128);
            }
        });

        let cost = cost.get();
        if cost > 0 && billing_active && !system_write {
            let config = BillingConfig::get_assert();
            let sys = config.sys;
            let balance = UserSettings::get_resource_balance(user, sub_account.clone());
            let amt = Quantity::new(cost);

            if balance < amt {
                abort_message(&format!(
                    "{} has insufficient resource balance for disk",
                    user
                ));
            }

            let sub_key = UserSettings::to_sub_account_key(user, sub_account);
            Tokens::call().fromSub(sys, sub_key, amt);
            Tokens::call().toSub(sys, relay_sub(resource), amt);
        }

        if !billing_active {
            return 0;
        }

        cost
    }

    pub fn free(&self, amount_freed: u64, user: AccountNumber, sub_account: Option<String>) -> u64 {
        let resource = self.resource();
        let gross_refund = Cell::new(0u64);
        let fee_ppm_val = Cell::new(0u32);
        let billing_active = is_billing_active();
        let system_write = is_system(user);
        Self::update(resource, |p| {
            let consumed = p.max_capacity - p.remaining_capacity;

            // Technically `amount_freed > consumed` could happen if any preallocated
            //   space was freed. Clamp to `consumed` to keep accounting consistent.
            let amount_freed = amount_freed.min(consumed);

            let r = p
                .curve()
                .pos_from_resources(p.remaining_capacity)
                .refund_of(amount_freed);
            p.reserve -= r;
            p.remaining_capacity += amount_freed;
            gross_refund.set(r);
            fee_ppm_val.set(p.fee_ppm);

            if !billing_active || system_write {
                p.virtual_balance.add(-(r as i128));
            }
        });

        let gross_refund = gross_refund.get();
        let fee = (gross_refund as u128 * fee_ppm_val.get() as u128 / PPM) as u64;
        let user_refund = gross_refund - fee;

        if gross_refund > 0 && billing_active && !system_write {
            let config = BillingConfig::get_assert();
            let sys = config.sys;

            Tokens::call().fromSub(sys, relay_sub(resource), Quantity::new(gross_refund));

            if user_refund > 0 {
                let sub_key = UserSettings::to_sub_account_key(user, sub_account);
                Tokens::call().toSub(sys, sub_key, Quantity::new(user_refund));
            }

            if fee > 0 {
                Self::credit_fee_receiver(resource, fee);
            }
        }

        if !billing_active {
            return 0;
        }

        user_refund
    }

    pub fn set_capacity(&self, new_max_capacity: u64) {
        check(
            new_max_capacity >= self.max_capacity,
            "Capacity can only increase",
        );
        let delta = new_max_capacity - self.max_capacity;
        if delta > 0 {
            self.increase_capacity(delta);
        }
    }

    fn increase_capacity(&self, delta_bytes: u64) {
        check(delta_bytes > 0, "invalid capacity increase");

        let resource = self.resource();
        let delta_reserve = Cell::new(0i64);
        let billing_active = is_billing_active();
        Self::update(resource, |p| {
            let old_reserve = p.reserve;

            p.max_capacity += delta_bytes;
            p.remaining_capacity += delta_bytes;

            p.reserve = p.curve().pos_from_resources(p.remaining_capacity).reserves;

            let dr = p.reserve as i64 - old_reserve as i64;
            delta_reserve.set(dr);

            if !billing_active {
                p.virtual_balance.add(dr as i128);
            }
        });
        let delta_reserve = delta_reserve.get();
        if delta_reserve != 0 && billing_active {
            let config = BillingConfig::get_assert();
            let amt = Quantity::new(delta_reserve.unsigned_abs());
            let sub = relay_sub(resource);

            check(delta_reserve < 0, "Reserves drop after capacity increase");

            Tokens::call().fromSub(config.sys, sub, amt);
            Self::credit_fee_receiver(resource, delta_reserve.unsigned_abs());
        }
    }

    pub fn reduce_reserve_budget(&self, delta_supply: u64) {
        check(delta_supply > 0, "invalid reserve budget decrease");

        let resource = self.resource();
        let to_remove = Cell::new(0u64);
        let billing_active = is_billing_active();
        Self::update(resource, |p| {
            check(
                delta_supply < p.max_reserve,
                "Cannot reduce max_reserve to 0",
            );
            let old_reserve = p.reserve;

            p.max_reserve -= delta_supply;

            // ceil so pool requires >= ideal reserve, meaning we remove less
            p.reserve = p.curve().pos_from_resources(p.remaining_capacity).reserves;

            let removed = old_reserve.saturating_sub(p.reserve);
            to_remove.set(removed);

            if !billing_active && removed > 0 {
                p.virtual_balance.add(-(removed as i128));
            }
        });
        let to_remove = to_remove.get();

        let consumed = self.max_capacity - self.remaining_capacity;
        check(
            consumed == 0 || to_remove > 0,
            "Reserves drop after reserve budget decrease",
        );

        if to_remove > 0 && billing_active {
            let config = BillingConfig::get_assert();
            let amt = Quantity::new(to_remove);
            Tokens::call().fromSub(config.sys, relay_sub(resource), amt);
            Self::credit_fee_receiver(resource, to_remove);
        }
    }

    /// Credits `fee_receiver`, settling any outstanding virtual balance first.
    ///
    /// If the relay has a shortfall, redirects some/all of the fee payment into the
    /// relay to cover it. If the relay has excess, pulls the extra out and adds it
    /// to the fee_receiver payment.
    ///
    /// A virtual balance may accumulate while billing is enabled only if system services
    /// write to databases outside of any user action/transaction contexts.
    fn credit_fee_receiver(resource: ResourceType, amount: u64) {
        if amount == 0 {
            return;
        }
        let config = BillingConfig::get_assert();
        let sys = config.sys;
        let to_relay = Cell::new(0u64);
        let from_relay = Cell::new(0u64);
        let to_fee = Cell::new(amount);

        Self::update(resource, |p| {
            let net = p.virtual_balance.net();
            if net > 0 {
                let settle = (net as u64).min(amount);
                to_relay.set(settle);
                to_fee.set(amount - settle);
                p.virtual_balance.add(-(settle as i128));
            } else if net < 0 {
                let extra = (-net) as u64;
                from_relay.set(extra);
                to_fee.set(amount + extra);
                p.virtual_balance.add(extra as i128);
            }
        });

        let sub = relay_sub(resource);
        if to_relay.get() > 0 {
            Tokens::call().toSub(sys, sub, Quantity::new(to_relay.get()));
        } else if from_relay.get() > 0 {
            Tokens::call().fromSub(sys, sub, Quantity::new(from_relay.get()));
        }
        if to_fee.get() > 0 {
            Tokens::call().credit(
                sys,
                config.fee_receiver,
                Quantity::new(to_fee.get()),
                "".into(),
            );
        }
    }

    /// Settles the virtual balance by moving real tokens to match the curve state.
    ///
    /// If the relay is short (net > 0), debits `payer` and deposits into relay sub.
    /// If the relay has excess (net < 0), withdraws from relay sub to fee_receiver.
    pub fn settle_virtual_balance(&self, payer: AccountNumber) {
        let resource = self.resource();
        let net = Cell::new(0i128);
        Self::update(resource, |p| {
            net.set(p.virtual_balance.settle());
        });
        let net = net.get();
        if net == 0 {
            return;
        }
        let config = BillingConfig::get_assert();
        let sys = config.sys;
        let sub = relay_sub(resource);
        if net > 0 {
            let amt = Quantity::new(net as u64);
            let service = get_service();
            let shared = Tokens::call().getSharedBal(sys, payer, service);
            if shared < amt {
                let required = Decimal::new(amt, BillingConfig::get_sys_token().precision);
                abort_message(&format!(
                    "Enabling billing requires a payment of {required} tokens"
                ));
            }
            Tokens::call().debit(sys, payer, amt, "".into());
            Tokens::call().toSub(sys, sub, amt);
            Tokens::call().reject(sys, payer, "Change".into());
        } else {
            let amt = Quantity::new((-net) as u64);
            Tokens::call().fromSub(sys, sub, amt);
            Tokens::call().credit(sys, config.fee_receiver, amt, "".into());
        }
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
    /// Reserve tokens held in relay, denominated in the system token.
    pub async fn reserve(&self) -> Decimal {
        sys_decimal(self.reserve)
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
}

#[Object]
impl VirtualBalance {
    /// Relay shortfall, denominated in the system token.
    pub async fn shortfall(&self) -> Decimal {
        sys_decimal(self.shortfall)
    }

    /// Relay excess, denominated in the system token.
    pub async fn excess(&self) -> Decimal {
        sys_decimal(self.excess)
    }
}
