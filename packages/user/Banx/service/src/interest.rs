//! Daily compound APR on outstanding balance (principal + finalized interest).
//!
//! Path-independent: one evaluation from the last principal/rate change.
//! `interest_rate` is ppm per year (`10_000` = 1%). Year is 365 days (no leap).
//! Positive full days: `bal = bal * (365 * PPM + rate) / (365 * PPM)` (`1 + APR/365`).
//! A negative rate subtracts the truncated daily fee `bal * |rate| / (365 * PPM)`
//! and stops when that fee is zero.
//! Leftover seconds in the current day are pro-rata on that daily rate.
//! The represented balance caps at [`u64::MAX`] so a later settle can still
//! reduce the row. Decay stops when the fee truncates to zero.

use crate::math::PPM_SCALE;

/// 365 * 24 * 60 * 60 — fixed, no leap seconds / leap years.
pub const SECONDS_PER_YEAR: u128 = 31_536_000;
pub const SECONDS_PER_DAY: u128 = 86_400;
pub const DAYS_PER_YEAR: u128 = SECONDS_PER_YEAR / SECONDS_PER_DAY;
pub const RATE_PPM_DENOM: u128 = PPM_SCALE as u128;
pub const ACCRUAL_DENOM: u128 = RATE_PPM_DENOM * SECONDS_PER_YEAR;

/// Balance after `dt_seconds` of daily compound at `rate_ppm`.
///
/// Positive rates cap at [`u64::MAX`] instead of aborting. Callers accrue
/// before they forgive or net, so a panic here would freeze the pair.
/// Negative rates subtract a truncated fee and stop when that fee is zero.
pub fn compound_amount(principal: u64, rate_ppm: i32, dt_seconds: u64) -> u64 {
    if principal == 0 || dt_seconds == 0 || rate_ppm == 0 {
        return principal;
    }
    if rate_ppm > 0 {
        compound_positive(principal, rate_ppm as u32, dt_seconds)
    } else {
        compound_negative(principal, rate_ppm, dt_seconds)
    }
}

fn compound_positive(principal: u64, rate_ppm: u32, dt_seconds: u64) -> u64 {
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

/// `rate_ppm` is negative. A factor that would not stay positive wipes the balance.
fn compound_negative(principal: u64, rate_ppm: i32, dt_seconds: u64) -> u64 {
    let Some(rate_abs) = rate_ppm.checked_neg() else {
        return 0;
    };
    let rate_abs = rate_abs as u128;
    let day = SECONDS_PER_DAY;
    let day_denom = DAYS_PER_YEAR * PPM_SCALE as u128;
    if rate_abs >= day_denom {
        return 0;
    }
    let days = (dt_seconds as u128) / day;
    let rem = (dt_seconds as u128) % day;
    let mut acc = principal as u128;
    let mut d = 0u128;
    while d < days {
        // Floor the fee. Flooring `acc * (denom - rate) / denom` charges a fraction as one unit.
        let fee = acc * rate_abs / day_denom;
        if fee == 0 {
            break;
        }
        acc -= fee;
        d += 1;
    }
    if rem > 0 {
        // Truncate the fee, not the balance, so a fraction of a unit is not
        // charged as a whole unit.
        let fee = acc * rate_abs * rem / ACCRUAL_DENOM;
        acc = acc.saturating_sub(fee);
    }
    acc as u64
}

/// Growth over `dt_seconds`: `compound_amount - principal`. Decay yields 0.
pub fn interest_for(principal: u64, rate_ppm: i32, dt_seconds: u64) -> u64 {
    compound_amount(principal, rate_ppm, dt_seconds).saturating_sub(principal)
}
