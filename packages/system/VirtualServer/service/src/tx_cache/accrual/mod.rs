//! Per-tx billing accrual, settled at end of tx

pub mod rate_limited;
pub mod capacity_limited;

fn is_system_user(user: psibase::AccountNumber) -> bool {
    user == psibase::AccountNumber::new(0)
}
