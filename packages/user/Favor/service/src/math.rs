//! Shared fee / FX integer math.
//!
//! On-chain wrappers panic; path search uses the `try_*` `Option` forms.

/// Parts-per-million scale: `PPM_SCALE` = 100%.
///
/// Used for fees, spreads, and FX/`fx_rate` (`10_000` = 1%).
pub const PPM_SCALE: u32 = 1_000_000;

/// Scale for rates/takes: `out = in * rate / RATE_SCALE`.
/// Equal to [`PPM_SCALE`]; `RATE_SCALE` = identity (1:1).
pub const RATE_SCALE: u64 = PPM_SCALE as u64;

/// Amount the curve prices. The rest of `amount_in` is the fee, and does
/// not enter the reserve.
pub fn priced_input(amount_in: u64, fee_ppm: u32) -> Option<u64> {
    if amount_in == 0 || fee_ppm >= PPM_SCALE {
        return None;
    }
    let keep = (PPM_SCALE - fee_ppm) as u128;
    let priced = (amount_in as u128)
        .checked_mul(keep)?
        .checked_div(PPM_SCALE as u128)?;
    let priced = u64::try_from(priced).ok()?;
    (priced > 0).then_some(priced)
}

/// Constant-product output of the priced input.
///
/// `out = reserve_out * priced / (reserve_in + priced)`.
/// The output is always less than `reserve_out`. The fee is not added to
/// `reserve_in`; that is a smaller trade, not extra weight.
pub fn try_swap_out(
    reserve_in: u64,
    reserve_out: u64,
    amount_in: u64,
    fee_ppm: u32,
) -> Option<u64> {
    if reserve_in == 0 || reserve_out == 0 {
        return None;
    }
    let priced = priced_input(amount_in, fee_ppm)?;
    let denom = reserve_in.checked_add(priced)?;
    let out = (reserve_out as u128)
        .checked_mul(priced as u128)?
        .checked_div(denom as u128)?;
    let out = u64::try_from(out).ok()?;
    (out > 0 && out < reserve_out).then_some(out)
}

/// One constant-product trade. Input reserve grows by the priced amount only.
pub fn move_curve(
    reserve_in: u64,
    reserve_out: u64,
    amount_in: u64,
    fee_ppm: u32,
) -> Option<(u64, u64, u64)> {
    let out = try_swap_out(reserve_in, reserve_out, amount_in, fee_ppm)?;
    let priced = priced_input(amount_in, fee_ppm)?;
    let reserve_in = reserve_in.checked_add(priced)?;
    let reserve_out = reserve_out.checked_sub(out)?;
    Some((out, reserve_in, reserve_out))
}

/// Smallest input such that [`try_swap_out`] is at least `amount_out`.
pub fn try_swap_in(
    reserve_in: u64,
    reserve_out: u64,
    amount_out: u64,
    fee_ppm: u32,
) -> Option<u64> {
    if reserve_in == 0
        || reserve_out == 0
        || amount_out == 0
        || amount_out >= reserve_out
        || fee_ppm >= PPM_SCALE
    {
        return None;
    }
    let keep = (PPM_SCALE - fee_ppm) as u128;
    if keep == 0 {
        return None;
    }
    let denom = (reserve_out - amount_out) as u128;
    let num = (amount_out as u128).checked_mul(reserve_in as u128)?;
    let after_fee = num.checked_add(denom - 1)?.checked_div(denom)?;
    let amount_in = after_fee
        .checked_mul(PPM_SCALE as u128)?
        .checked_add(keep - 1)?
        .checked_div(keep)?;
    let mut amount_in = u64::try_from(amount_in).ok()?;
    let mut out = try_swap_out(reserve_in, reserve_out, amount_in, fee_ppm)?;
    if out < amount_out {
        amount_in = amount_in.checked_add(1)?;
        out = try_swap_out(reserve_in, reserve_out, amount_in, fee_ppm)?;
    }
    (out >= amount_out).then_some(amount_in)
}

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

/// Smallest positive input for which `probe` returns at least `target`.
///
/// `None` before any positive output means the input still rounds to nothing,
/// so the search keeps growing. `None` after a short positive output is a
/// ceiling (an FX-offer cap, or a swap that cannot price a larger
/// input). The feasible send may sit strictly between those two probes, so
/// the search does not require a power of two to succeed. `probe` is monotone
/// up to that ceiling: a larger input does not start pricing again after `None`.
pub fn smallest_input_for_output(
    target: u64,
    mut probe: impl FnMut(u64) -> Option<u64>,
) -> Option<u64> {
    if target == 0 {
        return None;
    }
    let mut lo = 0u64;
    let mut hi = 1u64;
    let mut saw = false;
    let mut bounded = false;
    for _ in 0..64 {
        match probe(hi) {
            Some(out) if out >= target => {
                bounded = true;
                break;
            }
            Some(out) if out > 0 => {
                saw = true;
                if hi > u64::MAX / 2 {
                    return None;
                }
                lo = hi;
                hi *= 2;
            }
            _ if !saw => {
                if hi > u64::MAX / 2 {
                    return None;
                }
                hi *= 2;
            }
            // A short output already priced. This probe is past the cap.
            _ => {
                bounded = true;
                break;
            }
        }
    }
    if !bounded {
        return None;
    }
    while lo + 1 < hi {
        let mid = lo + (hi - lo) / 2;
        match probe(mid) {
            Some(out) if out >= target => hi = mid,
            Some(out) if out > 0 => lo = mid,
            _ => hi = mid,
        }
    }
    match probe(hi) {
        Some(out) if out >= target => Some(hi),
        _ => None,
    }
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
    fn constant_product_prices_the_input_after_the_fee() {
        assert_eq!(try_swap_out(10_000, 15_000, 1_000, 0), Some(1_363));
        assert_eq!(try_swap_in(10_000, 15_000, 1_363, 0), Some(1_000));
        assert_eq!(try_swap_out(10_000, 15_000, 1_000, 100_000), Some(1_238));
        assert_eq!(try_swap_out(15_000, 10_000, 1_000, 0), Some(625));
        assert_eq!(try_swap_out(10_000, 15_000, 1_000, PPM_SCALE), None);
        assert_eq!(try_swap_in(10_000, 15_000, 15_000, 0), None);
    }

    #[test]
    fn invert_fixed_hop_fee() {
        assert_eq!(try_invert_hop_fee(100, 10, 0), Some(110));
        assert_eq!(try_apply_hop_fee(110, 10, 0), Some(100));
    }
}
