use psibase::{abort_message, AccountNumber};
use std::cell::RefCell;
use std::collections::HashMap;

thread_local! {
    static DISK_NET: RefCell<Option<HashMap<AccountNumber, (i64, i64)>>> = const { RefCell::new(None) };
}

pub fn add_disk_usage(user: AccountNumber, amount_bytes: i64, cost: i64) {
    DISK_NET.with_borrow_mut(|map| {
        let entry = map
            .get_or_insert_with(HashMap::new)
            .entry(user)
            .or_insert((0, 0));
        entry.0 = entry
            .0
            .checked_add(amount_bytes)
            .unwrap_or_else(|| abort_message("disk usage amount overflow"));
        entry.1 = entry
            .1
            .checked_add(cost)
            .unwrap_or_else(|| abort_message("disk usage cost overflow"));
    });
}

pub fn drain_disk_usage() -> Vec<(AccountNumber, i64, i64)> {
    DISK_NET.with_borrow_mut(|map| {
        map.take()
            .map(|m| m.into_iter().map(|(k, (a, c))| (k, a, c)).collect())
            .unwrap_or_default()
    })
}
