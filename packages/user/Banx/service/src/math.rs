//! Shared fee / FX integer math.
//!
//! On-chain wrappers panic; path search uses the `try_*` `Option` forms.

/// Parts-per-million scale: `PPM_SCALE` = 100%.
///
/// Used for interest APR, FX/`fx_rate`, and max accept rates (`10_000` = 1%).
pub const PPM_SCALE: u32 = 1_000_000;

/// Scale for rates/takes: `out = in * rate / RATE_SCALE`.
/// Equal to [`PPM_SCALE`]; `RATE_SCALE` = identity (1:1).
pub const RATE_SCALE: u64 = PPM_SCALE as u64;

/// `out = (in - fee_fixed) * rate / RATE_SCALE`.
pub fn try_apply_rate(amount_in: u64, fee_fixed: u64, rate: u64) -> Option<u64> {
    if fee_fixed >= amount_in || rate == 0 {
        return None;
    }
    let after = amount_in - fee_fixed;
    let out = (after as u128)
        .checked_mul(rate as u128)?
        .checked_div(RATE_SCALE as u128)?;
    let out = u64::try_from(out).ok()?;
    (out > 0).then_some(out)
}

/// Two FX rates around a market rate, each worse for the taker by `spread_ppm`.
///
/// `market_fx` is to-asset per from-asset (`out = in * market_fx / RATE_SCALE`).
/// The forward rate is that market rate with the percent taken off.
/// The back rate is the fair inverse (`RATE_SCALE^2 / market_fx`) with the
/// same percent taken off. A 5% spread on 1.20 (`market_fx` 1_200_000 when
/// both assets share a precision) is forward 1_140_000 and back 791_666.
/// `spread_ppm` of 0 posts the market and its inverse. `spread_ppm` of 100%
/// or a rate that rounds to zero returns `None`.
pub fn try_exchange_rates(market_fx: u64, spread_ppm: u32) -> Option<(u64, u64)> {
    if market_fx == 0 || spread_ppm >= PPM_SCALE {
        return None;
    }
    let keep = (PPM_SCALE - spread_ppm) as u128;
    let forward = (market_fx as u128)
        .checked_mul(keep)?
        .checked_div(PPM_SCALE as u128)?;
    let forward = u64::try_from(forward).ok()?;
    if forward == 0 {
        return None;
    }
    let back = (RATE_SCALE as u128)
        .checked_mul(RATE_SCALE as u128)?
        .checked_mul(keep)?
        .checked_div((market_fx as u128).checked_mul(PPM_SCALE as u128)?)?;
    let back = u64::try_from(back).ok()?;
    (back > 0).then_some((forward, back))
}

/// `out = in * (1 - spread_ppm) - fee_fixed`.
///
/// `spread_ppm > 0` haircuts. `spread_ppm < 0` is a premium.
/// Must be in `(-PPM_SCALE, PPM_SCALE)`.
pub fn try_apply_spread(amount_in: u64, fee_fixed: u64, spread_ppm: i32) -> Option<u64> {
    let scale = PPM_SCALE as i64;
    if (spread_ppm as i64) <= -scale || (spread_ppm as i64) >= scale {
        return None;
    }
    let keep_ppm = (scale - spread_ppm as i64) as u128;
    let after_pct = (amount_in as u128)
        .checked_mul(keep_ppm)?
        .checked_div(PPM_SCALE as u128)?;
    let after_pct = u64::try_from(after_pct).ok()?;
    if fee_fixed >= after_pct {
        return None;
    }
    let out = after_pct - fee_fixed;
    (out > 0).then_some(out)
}

/// Stripe-style hop fee: `out = in * (PPM_SCALE - percent) / PPM_SCALE - fixed`.
pub fn try_apply_hop_fee(amount_in: u64, fee_fixed: u64, fee_percent_ppm: u32) -> Option<u64> {
    if fee_percent_ppm >= PPM_SCALE {
        return None;
    }
    try_apply_spread(amount_in, fee_fixed, fee_percent_ppm as i32)
}

fn invert_until(amount_out: u64, mut inn: u64, f: impl Fn(u64) -> Option<u64>) -> Option<u64> {
    if amount_out == 0 {
        return None;
    }
    loop {
        let got = f(inn)?;
        if got >= amount_out {
            return Some(inn);
        }
        inn = inn.checked_add(1)?;
    }
}

/// Smallest `in` such that [`try_apply_rate`] ≥ `amount_out`.
pub fn try_invert_rate(amount_out: u64, fee_fixed: u64, rate: u64) -> Option<u64> {
    if amount_out == 0 || rate == 0 {
        return None;
    }
    let num = (amount_out as u128).checked_mul(RATE_SCALE as u128)?;
    let after = u64::try_from((num + rate as u128 - 1) / (rate as u128)).ok()?;
    let inn = after.checked_add(fee_fixed)?;
    invert_until(amount_out, inn, |x| try_apply_rate(x, fee_fixed, rate))
}

/// Smallest `in` such that [`try_apply_hop_fee`] ≥ `amount_out`.
pub fn try_invert_hop_fee(amount_out: u64, fee_fixed: u64, fee_percent_ppm: u32) -> Option<u64> {
    if amount_out == 0 || fee_percent_ppm >= PPM_SCALE {
        return None;
    }
    let keep = (PPM_SCALE - fee_percent_ppm) as u128;
    let need = amount_out.checked_add(fee_fixed)?;
    let num = (need as u128).checked_mul(PPM_SCALE as u128)?;
    let inn = u64::try_from((num + keep - 1) / keep).ok()?;
    invert_until(amount_out, inn, |x| {
        try_apply_hop_fee(x, fee_fixed, fee_percent_ppm)
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hop_fee_five_percent() {
        assert_eq!(
            try_apply_hop_fee(10_000, 0, PPM_SCALE * 5 / 100),
            Some(9_500)
        );
        assert_eq!(
            try_invert_hop_fee(9_500, 0, PPM_SCALE * 5 / 100),
            Some(10_000)
        );
    }

    #[test]
    fn rate_identity_and_fx() {
        assert_eq!(try_apply_rate(1_000, 0, RATE_SCALE), Some(1_000));
        assert_eq!(
            try_apply_rate(10_000, 0, RATE_SCALE * 65 / 100),
            Some(6_500)
        );
        assert_eq!(
            try_invert_rate(6_500, 0, RATE_SCALE * 65 / 100),
            Some(10_000)
        );
    }

    #[test]
    fn exchange_spread_five_percent_on_one_point_two() {
        let (forward, back) = try_exchange_rates(1_200_000, PPM_SCALE * 5 / 100).unwrap();
        assert_eq!(forward, 1_140_000);
        assert_eq!(back, 791_666);
        let (fair_fwd, fair_back) = try_exchange_rates(1_200_000, 0).unwrap();
        assert_eq!(fair_fwd, 1_200_000);
        assert_eq!(fair_back, 833_333);
        assert_eq!(try_exchange_rates(1_200_000, PPM_SCALE), None);
        assert_eq!(try_exchange_rates(0, 0), None);
        // 1 * (PPM_SCALE - 1) / PPM_SCALE truncates to 0.
        assert_eq!(try_exchange_rates(1, PPM_SCALE - 1), None);
        // RATE_SCALE^2 / market_fx truncates to 0.
        assert_eq!(try_exchange_rates(1_000_000_000_001, 0), None);
    }

    #[test]
    fn spread_premium_and_haircut() {
        assert_eq!(try_apply_spread(10_000, 0, 50_000), Some(9_500));
        assert_eq!(try_apply_spread(10_000, 0, -50_000), Some(10_500));
        assert_eq!(try_apply_spread(100, 100, 0), None);
        assert_eq!(try_apply_rate(50, 50, RATE_SCALE), None);
    }

    #[test]
    fn invert_fixed_hop_fee() {
        assert_eq!(try_invert_hop_fee(100, 10, 0), Some(110));
        assert_eq!(try_apply_hop_fee(110, 10, 0), Some(100));
    }
}
