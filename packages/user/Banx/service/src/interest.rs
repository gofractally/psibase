//! Annual compound APR on outstanding balance (principal + finalized interest).
//!
//! Path-independent: one evaluation from the last principal/rate change.
//! `interest_rate` is ppm per year (`10_000` = 1%). Year length is
//! [`SECONDS_PER_YEAR`] (365 days, no leap). Full years:
//! `bal = bal * (PPM_SCALE + rate) / PPM_SCALE`. Leftover fraction of a year:
//! `bal * (YEAR * PPM + rate * rem) / (YEAR * PPM)`.

use crate::tables::PPM_SCALE;

/// 365 * 24 * 60 * 60 — fixed, no leap seconds / leap years.
pub const SECONDS_PER_YEAR: u128 = 31_536_000;
pub const RATE_PPM_DENOM: u128 = PPM_SCALE as u128;
pub const ACCRUAL_DENOM: u128 = RATE_PPM_DENOM * SECONDS_PER_YEAR;

/// Balance after `dt_seconds` of annual compound at `rate_ppm`.
pub fn compound_amount(principal: u64, rate_ppm: u32, dt_seconds: u64) -> u64 {
    if principal == 0 || dt_seconds == 0 || rate_ppm == 0 {
        return principal;
    }
    let ppm = PPM_SCALE as u128;
    let year = SECONDS_PER_YEAR;
    let factor = ppm
        .checked_add(rate_ppm as u128)
        .expect("interest: rate overflow");
    let years = (dt_seconds as u128) / year;
    let rem = (dt_seconds as u128) % year;
    let mut acc = principal as u128;
    let mut y = 0u128;
    while y < years {
        acc = acc
            .checked_mul(factor)
            .expect("interest: compound overflow")
            / ppm;
        y += 1;
    }
    if rem > 0 {
        let num = year
            .checked_mul(ppm)
            .expect("interest: year*ppm overflow")
            .checked_add(
                (rate_ppm as u128)
                    .checked_mul(rem)
                    .expect("interest: rate*rem overflow"),
            )
            .expect("interest: pro-rata overflow");
        acc = acc
            .checked_mul(num)
            .expect("interest: pro-rata mul overflow")
            / ACCRUAL_DENOM;
    }
    u64::try_from(acc).expect("interest: balance exceeds u64")
}

/// Growth over `dt_seconds`: `compound_amount - principal`.
pub fn interest_for(principal: u64, rate_ppm: u32, dt_seconds: u64) -> u64 {
    compound_amount(principal, rate_ppm, dt_seconds).saturating_sub(principal)
}
