use psibase::{services::tokens::Quantity, AccountNumber};

use super::{emit_pair_activity_as, invert_hop_fee, invert_rate, Connection};
use crate::tables::tables::{CurrencyPolicy, ForwardOffer, PathHop, PayRequest};

/// Exact-out send: walk hops backward from `target_out` at the last hop
/// (undo hop fees, then FX).
pub fn path_required_send(hops: &[PathHop], target_out: Quantity) -> Quantity {
    assert!(!hops.is_empty(), "path_pay must include at least one hop");
    let mut need = target_out;
    for i in (1..hops.len()).rev() {
        let prev = hops[i - 1];
        let hop = hops[i];
        let offer = ForwardOffer::get_live(prev.account, hop.account, hop.asset_id);
        need = invert_hop_fee(need, offer.fee_fixed, offer.fee_percent);
        if hop.asset_id != prev.asset_id {
            let pol = CurrencyPolicy::get_assert(prev.account, prev.asset_id, hop.asset_id);
            pol.assert_live();
            need = invert_rate(need, pol.fee_fixed, pol.fx_rate);
        }
    }
    need
}

/// Run a path draw. Returns the last-hop amount.
pub(crate) fn execute_path(
    sender: AccountNumber,
    hops: Vec<PathHop>,
    amount: Quantity,
) -> Quantity {
    assert!(!hops.is_empty(), "path must include at least one hop");
    assert!(amount.value > 0, "path amount must be positive");
    let mut path_debtor = sender;
    let mut forward = amount;
    let mut prev_asset = hops[0].asset_id;

    for (i, hop) in hops.into_iter().enumerate() {
        let PathHop {
            account: next_creditor,
            asset_id,
        } = hop;
        assert!(next_creditor != path_debtor, "path cannot draw on self");

        if i == 0 {
            Connection::get_live(next_creditor, path_debtor, asset_id).draw(forward);
            prev_asset = asset_id;
            path_debtor = next_creditor;
            continue;
        }

        if asset_id != prev_asset {
            forward = CurrencyPolicy::get_assert(path_debtor, prev_asset, asset_id).apply(forward);
        }
        assert!(forward.value > 0, "path hop produced nothing to forward");
        forward = ForwardOffer::get_live(path_debtor, next_creditor, asset_id)
            .path_draw(next_creditor, forward);
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
    amount: Quantity,
    min_return: Quantity,
    request_id: u32,
    memo: &str,
) -> Quantity {
    let hop_count = hops.len();
    let first_asset = hops[0].asset_id;
    let last_hop = hops[hops.len() - 1];
    let forward = execute_path(sender, hops, amount);
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
        emit_pair_activity_as(
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
