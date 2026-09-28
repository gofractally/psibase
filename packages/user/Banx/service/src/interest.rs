//! Daily compound APR on outstanding balance (principal + finalized interest).
//!
//! Path-independent: one evaluation from the last principal/rate change.
//! `interest_rate` is ppm per year (`10_000` = 1%). Year is 365 days (no leap).
//! Full days: `bal = bal * (365 * PPM + rate) / (365 * PPM)` (`1 + APR/365`).
//! Leftover seconds in the current day are pro-rata on that daily rate.
//! The represented balance caps at [`u64::MAX`] so a later settle can still
//! reduce the row.

use crate::math::PPM_SCALE;

/// 365 * 24 * 60 * 60 — fixed, no leap seconds / leap years.
pub const SECONDS_PER_YEAR: u128 = 31_536_000;
pub const SECONDS_PER_DAY: u128 = 86_400;
pub const DAYS_PER_YEAR: u128 = SECONDS_PER_YEAR / SECONDS_PER_DAY;
pub const RATE_PPM_DENOM: u128 = PPM_SCALE as u128;
pub const ACCRUAL_DENOM: u128 = RATE_PPM_DENOM * SECONDS_PER_YEAR;

/// Balance after `dt_seconds` of daily compound at `rate_ppm`.
///
/// Caps at [`u64::MAX`] instead of aborting. Callers accrue before they
/// forgive or net, so a panic here would freeze the pair.
pub fn compound_amount(principal: u64, rate_ppm: u32, dt_seconds: u64) -> u64 {
    if principal == 0 || dt_seconds == 0 || rate_ppm == 0 {
        return principal;
    }
    let ppm = PPM_SCALE as u128;
    let day = SECONDS_PER_DAY;
    let day_denom = DAYS_PER_YEAR * ppm;
    let day_factor = day_denom + rate_ppm as u128;
    let days = (dt_seconds as u128) / day;
    let rem = (dt_seconds as u128) % day;
    let mut acc = principal as u128;
    let cap = u64::MAX as u128;
    let mut d = 0u128;
    while d < days {
        acc = (acc.saturating_mul(day_factor) / day_denom).min(cap);
        if acc == cap {
            return u64::MAX;
        }
        d += 1;
    }
    if rem > 0 {
        let num = day * day_denom + (rate_ppm as u128) * rem;
        acc = (acc.saturating_mul(num) / ACCRUAL_DENOM).min(cap);
    }
    acc as u64
}

/// Growth over `dt_seconds`: `compound_amount - principal`.
pub fn interest_for(principal: u64, rate_ppm: u32, dt_seconds: u64) -> u64 {
    compound_amount(principal, rate_ppm, dt_seconds).saturating_sub(principal)
}
