//! Rate-limited resources: consumption cost is directly credited to the fee receiver.

use super::is_system_user;
use crate::resource_type::ResourceType;
use crate::tx_cache::{balance_cache, drain_cache, with_cache};
use psibase::AccountNumber;
use std::cell::RefCell;
use std::collections::HashMap;

#[derive(Default)]
pub struct Accrual {
    pub fee: u64,
}

thread_local! {
    static STATE: RefCell<Option<HashMap<ResourceType, Accrual>>> =
        RefCell::new(Some(HashMap::new()));
}

pub fn consume(
    resource: ResourceType,
    user: AccountNumber,
    sub: Option<String>,
    cost: u64,
) {
    if cost == 0 {
        return;
    }
    if is_system_user(user) {
        psibase::abort_message("System user consumes rate-limited resources!");
    }
    balance_cache::charge(user, sub, cost);
    with_cache(&STATE, |m| m.entry(resource).or_default().fee += cost);
}

pub fn drain() -> Vec<(ResourceType, Accrual)> {
    drain_cache(&STATE).into_iter().collect()
}
