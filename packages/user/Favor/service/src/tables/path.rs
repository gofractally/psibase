use std::collections::{HashMap, HashSet};

use psibase::{services::tokens::Quantity, AccountNumber};

use super::{emit_pair_activity, invert_hop_fee, invert_rate, Connection};
use crate::math::{smallest_input_for_output, try_apply_hop_fee, try_apply_rate};
use crate::tables::tables::{FavorRelay, ForwardOffer, FxOffer, PathHop, PayRequest};

/// Exact-out send: walk hops backward from `target_out` at the last hop
/// (undo hop fees, then FX). A relay used twice is priced forward, because
/// the second touch has to see the reserves the first touch already moved.
pub fn path_required_send(hops: &[PathHop], target_out: Quantity) -> Quantity {
    assert!(!hops.is_empty(), "path_pay must include at least one hop");
    if relay_used_twice(hops) {
        return sequential_required_send(hops, target_out);
    }
    let mut need = target_out;
    for i in (1..hops.len()).rev() {
        let prev = hops[i - 1];
        let hop = hops[i];
        let offer = ForwardOffer::get_live(prev.account, hop.account, hop.asset_id);
        need = invert_hop_fee(need, offer.fee_fixed, offer.fee_percent);
        if hop.asset_id != prev.asset_id {
            if let Some(relay) = FavorRelay::get(prev.account, prev.asset_id, hop.asset_id) {
                need = relay.swap_in(prev.asset_id, need);
            } else {
                let pol = FxOffer::get_assert(prev.account, prev.asset_id, hop.asset_id, true);
                pol.assert_live();
                need = invert_rate(need, pol.fee_fixed, pol.fx_rate);
                assert!(
                    need.value <= pol.remaining.value,
                    "fx offer amount exceeds remaining"
                );
            }
        }
    }
    need
}

fn relay_used_twice(hops: &[PathHop]) -> bool {
    let mut seen = HashSet::new();
    for i in 1..hops.len() {
        let prev = hops[i - 1];
        let hop = hops[i];
        if hop.asset_id == prev.asset_id {
            continue;
        }
        let Some(relay) = FavorRelay::get(prev.account, prev.asset_id, hop.asset_id) else {
            continue;
        };
        if !seen.insert((relay.owner, relay.asset_lo, relay.asset_hi)) {
            return true;
        }
    }
    false
}

/// Smallest send whose forward pricing, with reserves updated in order, meets `target_out`.
fn sequential_required_send(hops: &[PathHop], target_out: Quantity) -> Quantity {
    assert!(target_out.value > 0, "path amount must be positive");
    smallest_input_for_output(target_out.value, |amount| forward_amount(hops, amount))
        .expect("relay cannot produce that output")
        .into()
}

/// Same pricing as [`execute_path`], on local relay copies. Does not draw or save.
fn forward_amount(hops: &[PathHop], amount: u64) -> Option<u64> {
    let mut pools: HashMap<(AccountNumber, u16, u16), FavorRelay> = HashMap::new();
    let mut spent: HashMap<(AccountNumber, u16, u16), u64> = HashMap::new();
    let mut forward = amount;
    for i in 1..hops.len() {
        let prev = hops[i - 1];
        let hop = hops[i];
        if hop.asset_id != prev.asset_id {
            if let Some(stored) = FavorRelay::get(prev.account, prev.asset_id, hop.asset_id) {
                let key = (stored.owner, stored.asset_lo, stored.asset_hi);
                let relay = pools.entry(key).or_insert(stored);
                forward = relay.apply_out(prev.asset_id, forward)?;
            } else {
                let pol = FxOffer::get_assert(prev.account, prev.asset_id, hop.asset_id, true);
                pol.assert_live();
                let key = (prev.account, prev.asset_id, hop.asset_id);
                let used = spent.get(&key).copied().unwrap_or(0);
                if forward > pol.remaining.value.saturating_sub(used) {
                    return None;
                }
                spent.insert(key, used + forward);
                forward = try_apply_rate(forward, pol.fee_fixed.value, pol.fx_rate)?;
            }
        }
        let offer = ForwardOffer::get_live(prev.account, hop.account, hop.asset_id);
        forward = try_apply_hop_fee(forward, offer.fee_fixed.value, offer.fee_percent)?;
    }
    (forward > 0).then_some(forward)
}

const PRICE_CHANGED: &str = "path price changed since the quote";

/// Run a path draw. Returns the last-hop amount.
///
/// `expected[i]` is what hop `i` was quoted to draw, in that hop's asset and
/// after fees. Each hop is priced live and must draw exactly that. A fee, FX
/// rate or relay reserve replaced since the quote changes a draw and aborts
/// here, rather than filling at a worse price inside `min_return`.
pub(crate) fn execute_path(
    sender: AccountNumber,
    hops: Vec<PathHop>,
    expected: &[u64],
    amount: Quantity,
) -> Quantity {
    assert!(!hops.is_empty(), "path must include at least one hop");
    assert!(amount.value > 0, "path amount must be positive");
    assert!(
        hops.len() == expected.len(),
        "route amounts do not match its hops"
    );
    let mut path_debtor = sender;
    let mut forward = amount;
    let first_asset = hops[0].asset_id;
    let mut prev_asset = first_asset;
    let last_index = hops.len() - 1;
    // The same account once per asset. The sender may be the last hop only
    // when that asset differs from the first: those two claims do not net
    // away. A same-asset return spends a depleting line and then unwinds
    // the draw. A return that continues draws the sender a second time.
    let mut seen: Vec<(AccountNumber, u16)> = Vec::new();

    for (i, hop) in hops.into_iter().enumerate() {
        let PathHop {
            account: next_creditor,
            asset_id,
        } = hop;
        assert!(next_creditor != path_debtor, "path cannot draw on self");
        assert!(
            next_creditor != sender || (i == last_index && asset_id != first_asset),
            "path cannot route back through the sender"
        );
        assert!(
            !seen.contains(&(next_creditor, asset_id)),
            "path cannot revisit an account in the same asset"
        );
        seen.push((next_creditor, asset_id));

        if i == 0 {
            Connection::get_live(next_creditor, path_debtor, asset_id).draw(forward, sender);
            assert!(forward.value == expected[0], "{PRICE_CHANGED}");
            prev_asset = asset_id;
            path_debtor = next_creditor;
            continue;
        }

        if asset_id != prev_asset {
            if let Some(mut relay) = FavorRelay::get(path_debtor, prev_asset, asset_id) {
                forward = relay.swap_out(prev_asset, forward);
            } else {
                let mut pol = FxOffer::get_assert(path_debtor, prev_asset, asset_id, true);
                pol.spend(forward);
                forward = pol.apply(forward);
            }
        }
        assert!(forward.value > 0, "path hop produced nothing to forward");
        forward = ForwardOffer::get_live(path_debtor, next_creditor, asset_id).path_draw(
            next_creditor,
            forward,
            sender,
        );
        assert!(forward.value == expected[i], "{PRICE_CHANGED}");
        prev_asset = asset_id;
        path_debtor = next_creditor;
    }
    forward
}

/// Execute hops, optionally tick an invoice, emit sender↔payee activity.
/// Returns last-hop amount. Panics if `forward < min_return`.
///
/// `memo` is stored on the `path_pay` activity. A direct hop emits that
/// activity only when `memo` is set, so a normal one-hop `path_pay` stays
/// a `path_draw` and a repeating payment still shows up. The actor is the
/// drawer (`sender`), not whoever submitted the transaction.
pub fn run_path(
    sender: AccountNumber,
    hops: Vec<PathHop>,
    expected: &[u64],
    amount: Quantity,
    min_return: Quantity,
    request_id: u32,
    memo: &str,
) -> Quantity {
    let hop_count = hops.len();
    let first_asset = hops[0].asset_id;
    let last_hop = hops[hops.len() - 1];
    let forward = execute_path(sender, hops, expected, amount);
    assert!(
        forward.value >= min_return.value,
        "path_pay final amount below min_return"
    );
    if request_id != 0 {
        PayRequest::fulfill_invoice(
            request_id,
            sender,
            last_hop.account,
            last_hop.asset_id,
            forward,
        );
    }
    if hop_count >= 2 || !memo.is_empty() {
        emit_pair_activity(
            sender,
            sender,
            last_hop.account,
            first_asset,
            "path_pay",
            amount,
            forward,
            last_hop.asset_id,
            request_id,
            memo,
        );
    }
    forward
}

/// What each hop of `hops` draws for a send of `amount`, as far as the path
/// can be priced, and whether all of it could. Never panics. A hop that
/// cannot be priced and every hop after it read 0.
///
/// Test-only: a chain test seals a route the way the query service would. It
/// mirrors [`execute_path`], which asserts the same numbers on every hop, so
/// a drift between the two fails the payment tests.
#[cfg(test)]
pub(crate) fn peek_hop_amounts(hops: &[PathHop], amount: u64, now: i64) -> (Vec<u64>, bool) {
    let mut out = vec![0_u64; hops.len()];
    if hops.is_empty() {
        return (out, false);
    }
    out[0] = amount;
    let mut pools: HashMap<(AccountNumber, u16, u16), FavorRelay> = HashMap::new();
    let mut spent: HashMap<(AccountNumber, u16, u16), u64> = HashMap::new();
    let mut forward = amount;
    for i in 1..hops.len() {
        let prev = hops[i - 1];
        let hop = hops[i];
        if hop.asset_id != prev.asset_id {
            if let Some(stored) = FavorRelay::get(prev.account, prev.asset_id, hop.asset_id) {
                let key = (stored.owner, stored.asset_lo, stored.asset_hi);
                let relay = pools.entry(key).or_insert(stored);
                let Some(next) = relay.apply_out(prev.asset_id, forward) else {
                    return (out, false);
                };
                forward = next;
            } else {
                let Some(pol) = FxOffer::get(prev.account, prev.asset_id, hop.asset_id, true)
                else {
                    return (out, false);
                };
                let key = (prev.account, prev.asset_id, hop.asset_id);
                let used = spent.get(&key).copied().unwrap_or(0);
                let live = pol.expires_at.seconds == 0 || now <= pol.expires_at.seconds;
                if !live || forward > pol.remaining.value.saturating_sub(used) {
                    return (out, false);
                }
                spent.insert(key, used + forward);
                let Some(next) = try_apply_rate(forward, pol.fee_fixed.value, pol.fx_rate) else {
                    return (out, false);
                };
                forward = next;
            }
        }
        let Some(offer) = ForwardOffer::find_live(prev.account, hop.account, hop.asset_id, now)
        else {
            return (out, false);
        };
        let Some(next) = try_apply_hop_fee(forward, offer.fee_fixed.value, offer.fee_percent)
        else {
            return (out, false);
        };
        forward = next;
        out[i] = forward;
    }
    (out, true)
}

/// [`path_required_send`] without the panics, for a path that may be broken.
#[cfg(test)]
pub(crate) fn peek_required_send(hops: &[PathHop], target_out: u64, now: i64) -> Option<u64> {
    if hops.is_empty() {
        return None;
    }
    if relay_used_twice(hops) {
        return smallest_input_for_output(target_out, |a| {
            let (amounts, complete) = peek_hop_amounts(hops, a, now);
            complete
                .then(|| amounts[amounts.len() - 1])
                .filter(|v| *v > 0)
        });
    }
    let mut need = Quantity::new(target_out);
    for i in (1..hops.len()).rev() {
        let prev = hops[i - 1];
        let hop = hops[i];
        let offer = ForwardOffer::find_live(prev.account, hop.account, hop.asset_id, now)?;
        need = invert_hop_fee(need, offer.fee_fixed, offer.fee_percent);
        if hop.asset_id != prev.asset_id {
            if let Some(relay) = FavorRelay::get(prev.account, prev.asset_id, hop.asset_id) {
                need = relay.swap_in(prev.asset_id, need);
            } else {
                let pol = FxOffer::get(prev.account, prev.asset_id, hop.asset_id, true)?;
                if !(pol.expires_at.seconds == 0 || now <= pol.expires_at.seconds) {
                    return None;
                }
                need = invert_rate(need, pol.fee_fixed, pol.fx_rate);
                if need.value > pol.remaining.value {
                    return None;
                }
            }
        }
    }
    Some(need.value)
}
