use crate::math::PPM_SCALE;
use crate::tables::tables::Asset;
use psibase::{
    services::accounts::Wrapper as Accounts,
    services::tokens::{Decimal, Quantity},
    AccountNumber, ServiceWrapper, TimePointSec,
};

/// AccountNumber 0: global next-hop / debtor on standing offers.
pub const GLOBAL: AccountNumber = AccountNumber::new(0);

/// Returns what is left after `amount`, or panics with `over`.
pub(crate) fn spend_budget(remaining: Quantity, amount: Quantity, over: &str) -> Quantity {
    assert!(amount.value <= remaining.value, "{over}");
    Quantity::new(remaining.value - amount.value)
}

/// Abort unless `who` is a live chain account (not the reserved 0).
pub fn assert_account_exists(who: AccountNumber) {
    assert!(Accounts::call().exists(who), "account {who} does not exist");
}

/// Live specific row, else live global. Panics with `missing` if neither is live.
pub(crate) fn live_specific_or_global<T>(
    specific: Option<T>,
    global: Option<T>,
    is_live: impl Fn(&T) -> bool,
    missing: &str,
) -> T {
    if let Some(row) = specific {
        if is_live(&row) {
            return row;
        }
    }
    if let Some(row) = global {
        if is_live(&row) {
            return row;
        }
    }
    panic!("{missing}");
}

/// Time of the current block.
pub(crate) fn now() -> TimePointSec {
    psibase::services::transact::Wrapper::call()
        .currentBlock()
        .time
        .seconds()
}

pub(crate) fn expires_live(expires_at: TimePointSec) -> bool {
    if expires_at.seconds == 0 {
        return true;
    }
    now().seconds <= expires_at.seconds
}

/// `out = (in - fee_fixed) * rate / RATE_SCALE`.
pub(crate) fn apply_rate(amount_in: Quantity, fee_fixed: Quantity, rate: u64) -> Quantity {
    crate::math::try_apply_rate(amount_in.value, fee_fixed.value, rate)
        .map(Quantity::new)
        .unwrap_or_else(|| {
            assert!(
                fee_fixed.value < amount_in.value,
                "fixed fee consumes entire amount"
            );
            panic!("rate conversion failed")
        })
}

/// Same-asset hop fee (Stripe-style): percent of gross, then fixed.
pub(crate) fn apply_hop_fee(
    amount_in: Quantity,
    fee_fixed: Quantity,
    fee_percent_ppm: u32,
) -> Quantity {
    assert!(fee_percent_ppm < PPM_SCALE, "hop fee must be under 100%");
    apply_spread(amount_in, fee_fixed, fee_percent_ppm as i32)
}

/// Claim-sale spread: `out = in * (1 - spread_ppm) - fee_fixed`.
pub(crate) fn apply_spread(amount_in: Quantity, fee_fixed: Quantity, spread_ppm: i32) -> Quantity {
    crate::math::try_apply_spread(amount_in.value, fee_fixed.value, spread_ppm)
        .map(Quantity::new)
        .unwrap_or_else(|| {
            let scale = PPM_SCALE as i64;
            assert!(
                (spread_ppm as i64) > -scale && (spread_ppm as i64) < scale,
                "spread must be between -100% and 100%"
            );
            panic!("spread reduced amount to zero")
        })
}

/// Smallest `in` such that [`apply_rate`] ≥ `amount_out`.
pub(crate) fn invert_rate(amount_out: Quantity, fee_fixed: Quantity, rate: u64) -> Quantity {
    crate::math::try_invert_rate(amount_out.value, fee_fixed.value, rate)
        .map(Quantity::new)
        .unwrap_or_else(|| {
            assert!(amount_out.value > 0, "invert rate output must be positive");
            assert!(rate > 0, "fx_rate must be positive");
            panic!("invert fx overflow")
        })
}

/// Smallest `in` such that [`apply_hop_fee`] ≥ `amount_out`.
pub(crate) fn invert_hop_fee(
    amount_out: Quantity,
    fee_fixed: Quantity,
    fee_percent_ppm: u32,
) -> Quantity {
    crate::math::try_invert_hop_fee(amount_out.value, fee_fixed.value, fee_percent_ppm)
        .map(Quantity::new)
        .unwrap_or_else(|| {
            assert!(amount_out.value > 0, "invert hop output must be positive");
            assert!(fee_percent_ppm < PPM_SCALE, "hop fee must be under 100%");
            panic!("invert hop overflow")
        })
}

/// Tokens sub-account on Favor for one cashier + token.
///
/// Tokens already keys balances by `token_id`; the string names the
/// poster so cashiers do not share Favor's primary balance.
pub fn cash_sub(poster: AccountNumber, token_id: u32) -> String {
    format!("{poster}/{token_id}")
}

/// Tokens sub-account for one owner's pool. The pair is the Favor asset and the token,
/// so two IOUs do not share a balance.
pub fn relay_sub(owner: AccountNumber, asset_id: u16, token_id: u32) -> String {
    format!("{owner}/{asset_id}/{token_id}")
}

/// Emit history once for each party as `account`.
///
/// The caller passes `actor`. A `path_draw` is not "you" from `actor` alone.
///
/// `amount` / `netted` are stored as human decimals. `netted` uses
/// `other_asset_id` when that amount is a different asset, as on a path hop.
/// The same account on both sides is one row.
pub fn emit_pair_activity(
    actor: AccountNumber,
    party_a: AccountNumber,
    party_b: AccountNumber,
    asset_id: u16,
    kind: &str,
    amount: Quantity,
    netted: Quantity,
    other_asset_id: u16,
    request_id: u32,
    memo: &str,
) {
    let asset_precision = Asset::get_assert(asset_id).precision;
    let other_asset_precision = if asset_id == other_asset_id {
        asset_precision
    } else {
        Asset::get_assert(other_asset_id).precision
    };
    let amount = Decimal::new(amount, asset_precision);
    let netted = Decimal::new(netted, other_asset_precision);
    // A return to the sender names one account twice. The second order is
    // the same row, so a sum of those payments would count one payment twice.
    let write = |account: AccountNumber, counterparty: AccountNumber| {
        crate::Wrapper::emit().history().activity(
            account,
            counterparty,
            asset_id,
            kind.to_string(),
            amount.to_string(),
            netted.to_string(),
            other_asset_id,
            actor,
            request_id,
            memo.to_string(),
        );
    };
    write(party_a, party_b);
    if party_a != party_b {
        write(party_b, party_a);
    }
}

/// One path hop. `payer` started the path. Memo is the hop debtor.
pub(crate) fn emit_path_draw(
    payer: AccountNumber,
    creditor: AccountNumber,
    counterparty: AccountNumber,
    asset_id: u16,
    amount: Quantity,
    netted: Quantity,
) {
    emit_pair_activity(
        payer,
        creditor,
        counterparty,
        asset_id,
        "path_draw",
        amount,
        netted,
        asset_id,
        0,
        &counterparty.to_string(),
    );
}
