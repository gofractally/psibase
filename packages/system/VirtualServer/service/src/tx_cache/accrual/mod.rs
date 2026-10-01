//! Per-tx billing accrual, settled at end of tx

pub mod capacity_limited;
pub mod rate_limited;

fn is_system_user(user: psibase::AccountNumber) -> bool {
    user == psibase::AccountNumber::new(0)
}
