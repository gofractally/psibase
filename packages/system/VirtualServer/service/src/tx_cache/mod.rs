//! In-memory per-transaction billing caches.

use std::cell::RefCell;
use std::thread::LocalKey;

mod billable;
mod disk;

pub use billable::{get_billable_account, get_sub, set_billable_account, set_sub};
pub use disk::{add_disk_usage, drain_disk_usage};

/// Mutably access a billing cache
pub(crate) fn with_cache<T: 'static, R>(
    cache: &'static LocalKey<RefCell<Option<T>>>,
    f: impl FnOnce(&mut T) -> R,
) -> R {
    cache.with_borrow_mut(|m| match m.as_mut() {
        Some(inner) => f(inner),
        None => psibase::abort_message("resource billing attempted during end-of-tx settlement"),
    })
}

/// Drain a billing cache, subsequent access panics.
pub(crate) fn drain_cache<T: 'static>(cache: &'static LocalKey<RefCell<Option<T>>>) -> T {
    cache.with_borrow_mut(|m| match m.take() {
        Some(inner) => inner,
        None => psibase::abort_message("resource billing attempted during end-of-tx settlement"),
    })
}

/// Cache of account resource balances.
/// We track updates to user resources in the cache so we can do a settlement of the actual token
/// balances once at the end of the transaction.
pub mod balance_cache {
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
}

/// Per-tx billing accrual, settled at end of tx
pub mod accrual {
    fn is_system_user(user: psibase::AccountNumber) -> bool {
        user == psibase::AccountNumber::new(0)
    }

    /// Rate-limited resources: consumption cost is directly credited to the fee receiver.
    pub mod rate_limited {
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
    }

    /// Capacity-limited resources: consumption cost is sent as a reserve into a relay. When freed, relay refund is split between
    /// the user and the fee receiver.
    ///
    /// In rare cases (system writes or writes when billing is disabled), the relay may become under-collateralized. In such cases,
    /// tokens that would be sent to the fee receiver are instead used to recollateralize the relay.
    pub mod capacity_limited {
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
    }
}
