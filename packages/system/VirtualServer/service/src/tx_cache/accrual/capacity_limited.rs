//! Capacity-limited resources: consumption cost is sent as a reserve into a relay. When freed, relay refund is split between
//! the user and the fee receiver.
//!
//! In rare cases (system writes or writes when billing is disabled), the relay may become under-collateralized. In such cases,
//! tokens that would be sent to the fee receiver are instead used to recollateralize the relay.

use super::is_system_user;
use crate::resource_type::ResourceType;
use crate::tables::capacity_limit_pricing::relay_sub_account;
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

    let (gross, clamped_fee, refund) = if total_out > collateral {
        // Clamp the fee and the refund (keeping fee_ppm ratio)
        // if the payout exceeds available collateral.
        let clamped_fee = (fee as u128 * collateral as u128 / total_out as u128) as u64;
        (collateral, clamped_fee, collateral - clamped_fee)
    } else {
        (total_out, fee, user_refund)
    };

    with(resource, |a| {
        a.relay_delta -= gross as i128;
        a.fee += clamped_fee;
    });
    if refund > 0 {
        balance_cache::refund(user, sub, refund);
    }
    refund
}

pub fn drain() -> Vec<(ResourceType, Accrual)> {
    drain_cache(&STATE).into_iter().collect()
}
