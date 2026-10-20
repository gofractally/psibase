//! Capacity-limited resources: consumption cost is sent as a reserve into a relay. When freed, relay refund is split between
//! the user and the fee receiver.
//!
//! In rare cases (system writes or writes when billing is disabled), the relay may become under-collateralized.
//! An undercollateralized curve recollateralizes as users free bytes: a free sells bytes back to the relay,
//! reducing the required reserve. The user's refund is still paid (if collateral allows), but the fee portion
//! is retained in the curve rather than paid out. The fee receiver is paid only once the curve is fully
//! collateralized.

use super::is_system_user;
use crate::resource_type::ResourceType;
use crate::tables::capacity_limit_pricing::relay_sub_account;
use crate::tables::tables::CapacityPricing;
use crate::tx_cache::{balance_cache, drain_cache, with_cache};
use crate::Wrapper;
use psibase::AccountNumber;
use std::cell::RefCell;
use std::collections::HashMap;

#[derive(Default)]
pub struct Accrual {
    pub relay_delta: i128,
    pub fee: u64,
}

thread_local! {
    static STATE: RefCell<Option<HashMap<ResourceType, Accrual>>> =
        RefCell::new(Some(HashMap::new()));
}

fn with<R>(resource: ResourceType, f: impl FnOnce(&mut Accrual) -> R) -> R {
    with_cache(&STATE, |m| f(m.entry(resource).or_default()))
}

pub fn get_collateral(resource: ResourceType) -> u64 {
    let sub = relay_sub_account(resource);
    let actual = balance_cache::get_available(Wrapper::SERVICE, sub).value as i128;
    let pending = with(resource, |a| a.relay_delta);
    (actual + pending).max(0) as u64
}

pub fn consume(
    resource: ResourceType,
    user: AccountNumber,
    sub: Option<String>,
    cost: u64,
) {
    if is_system_user(user) || cost == 0 {
        return;
    }
    balance_cache::charge(user, sub, cost);
    with(resource, |a| a.relay_delta += cost as i128);
}

pub fn free(
    resource: ResourceType,
    user: AccountNumber,
    sub: Option<String>,
    user_refund: u64,
    fee: u64,
) -> u64 {
    let total_out = user_refund + fee;
    if is_system_user(user) || total_out == 0 {
        return 0;
    }
    let collateral = get_collateral(resource);
    let refund = user_refund.min(collateral);

    // Fee only comes from collateral beyond the refund and what the curve must keep.
    let required_reserve = CapacityPricing::get_assert(resource).required_reserve();
    let fee = fee.min(collateral.saturating_sub(refund + required_reserve));

    with(resource, |a| {
        a.relay_delta -= (refund + fee) as i128;
        a.fee += fee;
    });
    if refund > 0 {
        balance_cache::refund(user, sub, refund);
    }
    refund
}

pub fn drain() -> Vec<(ResourceType, Accrual)> {
    drain_cache(&STATE).into_iter().collect()
}
