//! In-memory per-transaction billing caches.

use std::cell::RefCell;
use std::thread::LocalKey;

pub mod billable;
pub mod disk;

pub mod accrual;
pub mod balance_cache;

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
