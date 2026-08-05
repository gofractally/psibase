//! Cache of account resource balances.
//! We track updates to user resources in the cache so we can do a settlement of the actual token
//! balances once at the end of the transaction.

use crate::tables::tables::UserSettings;
use crate::tx_cache::{drain_cache, with_cache};
use psibase::services::tokens::Quantity;
use psibase::{abort_message, AccountNumber};
use std::cell::RefCell;
use std::collections::HashMap;

type Payer = (AccountNumber, Option<String>);

#[derive(Clone, Copy)]
struct Balance {
    available: i128,
    initial: i128,
}

impl Balance {
    fn from_live((account, sub): &Payer) -> Self {
        let value = UserSettings::get_resource_balance(*account, sub.clone()).value as i128;
        Balance {
            available: value,
            initial: value,
        }
    }

    // The amount to settle
    fn delta(self) -> i128 {
        self.available - self.initial
    }
}

thread_local! {
    static BALANCES: RefCell<Option<HashMap<Payer, Balance>>> =
        RefCell::new(Some(HashMap::new()));
}

fn with<R>(f: impl FnOnce(&mut HashMap<Payer, Balance>) -> R) -> R {
    with_cache(&BALANCES, f)
}

/// Applies `delta` to the payer's balance, aborts on overdraft.
fn adjust(account: AccountNumber, sub: Option<String>, delta: i128) {
    with(|m| {
        let bal = m
            .entry((account, sub.clone()))
            .or_insert_with_key(Balance::from_live);
        bal.available += delta;
        if bal.available < 0 {
            let who = UserSettings::to_sub_account_key(account, sub);
            abort_message(&format!("{} has insufficient resource balance", who));
        }
    });
}

pub fn charge(account: AccountNumber, sub: Option<String>, cost: u64) {
    adjust(account, sub, -(cost as i128));
}

pub fn refund(account: AccountNumber, sub: Option<String>, amount: u64) {
    adjust(account, sub, amount as i128);
}

/// Returns whether the payer already has a pending accrual in this tx.
pub fn has_pending(account: AccountNumber, sub: Option<String>) -> bool {
    with(|m| m.contains_key(&(account, sub)))
}

/// The current resource balance for the specified account.
///
/// Caches on cache-miss.
pub fn get_available(account: AccountNumber, sub: Option<String>) -> Quantity {
    with(|m| {
        let bal = m
            .entry((account, sub))
            .or_insert_with_key(Balance::from_live);
        Quantity::new(bal.available.max(0) as u64)
    })
}

/// Handles mid-tx resource purchase/deletion.
/// Shifts available+initial together so the delta is unchanged but the new balance is spendable.
/// No-op if the account hasn't yet been touched for billing.
pub fn update_balance(account: AccountNumber, sub: Option<String>, delta: i128) {
    with(|m| {
        if let Some(bal) = m.get_mut(&(account, sub)) {
            bal.available += delta;
            bal.initial += delta;
        }
    });
}

pub fn drain_balances() -> Vec<(Payer, i128)> {
    drain_cache(&BALANCES)
        .into_iter()
        .map(|(payer, b)| (payer, b.delta()))
        .collect()
}
