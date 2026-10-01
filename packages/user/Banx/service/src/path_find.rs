//! Off-chain multi-hop path discovery for Banx `path_pay`.
//!
//! Algorithm mirrors TokenSwap's layered max-output search (`find_path` over
//! pools), but edges are **credit lines** (+ routing fees / FX policies), not
//! AMM pools. Pure logic — no chain IO.

use std::collections::{HashMap, HashSet};

use psibase::AccountNumber;

pub use crate::math::{
    try_apply_hop_fee as apply_hop_fee, try_apply_rate as apply_rate, PPM_SCALE, RATE_SCALE,
};
use crate::math::{try_invert_hop_fee, try_invert_rate};

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct LineEdge {
    pub creditor: AccountNumber,
    pub debtor: AccountNumber,
    pub asset_id: u16,
    /// Reverse claim plus line headroom (raw units). 0 = closed.
    pub capacity: u64,
    /// Reverse claim included in `capacity` (what this creditor already owes
    /// the debtor). Unwind nets that pair; FX still uses the hop notional.
    pub reverse_claim: u64,
    /// What the debtor already owes this creditor (same-direction claim).
    pub exposure: u64,
    pub interest_rate_ppm: u32,
    /// True if a real credit-line row exists (not a reverse-claim-only edge).
    pub is_line: bool,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct RoutingEdge {
    /// [`AccountNumber::new(0)`] = global (any next hop).
    pub creditor: AccountNumber,
    pub debtor: AccountNumber,
    pub asset_id: u16,
    pub hop_fee_fixed: u64,
    pub hop_fee_percent_ppm: u32,
    pub max_accept_rate_ppm: u32,
    /// Unix seconds; `0` = never.
    pub expires_at: i64,
    /// If false, the poster must have a credit line to the next hop.
    pub allow_unknown: bool,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct FxEdge {
    /// Middle man / previous-hop creditor who posted the quote.
    pub poster: AccountNumber,
    pub from_asset: u16,
    pub to_asset: u16,
    pub fee_fixed: u64,
    pub fx_rate: u64,
    pub expires_at: i64,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct PathHop {
    pub account: AccountNumber,
    pub asset_id: u16,
    /// Notional drawn on this hop after fees (raw units of hop asset).
    pub amount: u64,
    /// Routing fee taken on this hop (raw units of hop asset). Always 0 for hop 0.
    pub hop_fee: u64,
    /// FX fixed fee when converting into this hop (raw units of prior asset). 0 if no FX.
    pub fx_fee: u64,
    /// Prior asset when an FX convert happened into this hop.
    pub fx_from_asset: Option<u16>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct PathQuote {
    pub hops: Vec<PathHop>,
    /// Amount drawn on the first hop (raw units of `from_asset`).
    pub amount_in: u64,
    /// Residual amount after all fees (raw units of last hop asset).
    pub amount_out: u64,
}

fn policy_live(expires_at: i64, now: i64) -> bool {
    expires_at == 0 || expires_at >= now
}

fn is_global_creditor(c: AccountNumber) -> bool {
    c.value == 0
}

fn resolve_routing<'a>(
    routing: &'a [RoutingEdge],
    next_creditor: AccountNumber,
    debtor: AccountNumber,
    asset_id: u16,
    now: i64,
) -> Option<&'a RoutingEdge> {
    let mut global = None;
    for r in routing {
        if r.debtor != debtor || r.asset_id != asset_id {
            continue;
        }
        if !policy_live(r.expires_at, now) {
            continue;
        }
        if is_global_creditor(r.creditor) {
            global = Some(r);
        } else if r.creditor == next_creditor {
            return Some(r);
        }
    }
    global
}

#[derive(Clone, Debug)]
struct Label {
    account: AccountNumber,
    asset: u16,
    amount: u64,
    hops: Vec<(AccountNumber, u16)>,
    /// Creditors already drawn on, keyed by the asset of that draw.
    /// The same account may be a hub again in another asset.
    visited: HashSet<(AccountNumber, u16)>,
}

fn note_payee(
    best: &mut Option<Label>,
    label: &Label,
    payee: AccountNumber,
    to_asset: Option<u16>,
) {
    if label.account != payee || label.amount == 0 {
        return;
    }
    if let Some(want) = to_asset {
        if label.asset != want {
            return;
        }
    }
    if best.as_ref().map_or(true, |b| label.amount > b.amount) {
        *best = Some(label.clone());
    }
}

fn visited_subset(a: &HashSet<(AccountNumber, u16)>, b: &HashSet<(AccountNumber, u16)>) -> bool {
    a.iter().all(|x| b.contains(x))
}

/// Keep `new` unless a label already at this node forwards the same amount
/// and can take every next hop `new` can. A larger amount does not replace
/// a smaller one: the next line may fit only the smaller draw.
fn admit(labels: &mut Vec<Label>, new: Label) -> bool {
    let mut i = 0;
    while i < labels.len() {
        let old = &labels[i];
        if old.account != new.account || old.asset != new.asset || old.amount != new.amount {
            i += 1;
            continue;
        }
        if visited_subset(&old.visited, &new.visited) {
            return false;
        }
        if visited_subset(&new.visited, &old.visited) {
            labels.swap_remove(i);
            continue;
        }
        i += 1;
    }
    labels.push(new);
    true
}

struct LineIndex<'a> {
    by_debtor: HashMap<AccountNumber, Vec<&'a LineEdge>>,
    known: HashSet<(AccountNumber, AccountNumber, u16)>,
}

/// Index lines by debtor for expansion. Known matches Connection::knows:
/// who lined them, or who already owes them. Them owing who is not
/// enough (anyone can `deposit`); a hop with new_draw == 0 still proceeds.
fn index_lines(lines: &[LineEdge]) -> LineIndex<'_> {
    let mut by_debtor: HashMap<AccountNumber, Vec<&LineEdge>> = HashMap::new();
    let mut known: HashSet<(AccountNumber, AccountNumber, u16)> = HashSet::new();
    for l in lines {
        if l.is_line {
            known.insert((l.creditor, l.debtor, l.asset_id));
        }
        if l.exposure > 0 {
            known.insert((l.debtor, l.creditor, l.asset_id));
        }
        if l.reverse_claim > 0 {
            known.insert((l.creditor, l.debtor, l.asset_id));
        }
        if l.capacity > 0 {
            by_debtor.entry(l.debtor).or_default().push(l);
        }
    }
    LineIndex { by_debtor, known }
}

/// Find a multi-hop path from `sender` to `payee` maximizing amount_out.
///
/// `max_hops` is the maximum number of path_pay hops (1 = direct line only).
/// `now` is unix seconds for policy expiry (use 0 to ignore wall-clock).
///
/// Optional `to_asset`: require final hop in that asset.
pub fn find_banx_path(
    lines: &[LineEdge],
    routing: &[RoutingEdge],
    fx: &[FxEdge],
    sender: AccountNumber,
    payee: AccountNumber,
    amount_in: u64,
    from_asset: u16,
    to_asset: Option<u16>,
    max_hops: u8,
    now: i64,
) -> Option<PathQuote> {
    if amount_in == 0 || max_hops == 0 || sender == payee {
        return None;
    }

    let LineIndex {
        by_debtor: lines_by_debtor,
        known,
    } = index_lines(lines);

    let mut fx_by_poster_from: HashMap<(AccountNumber, u16), Vec<&FxEdge>> = HashMap::new();
    for e in fx {
        if policy_live(e.expires_at, now) && e.fx_rate > 0 {
            fx_by_poster_from
                .entry((e.poster, e.from_asset))
                .or_default()
                .push(e);
        }
    }

    let mut admitted: Vec<Label> = Vec::new();
    let mut frontier: Vec<Label> = Vec::new();

    // Hop 0: no routing fee; line debtor = sender.
    let Some(first_lines) = lines_by_debtor.get(&sender) else {
        return None;
    };
    for line in first_lines {
        if line.asset_id != from_asset || line.creditor == sender || amount_in > line.capacity {
            continue;
        }
        let label = Label {
            account: line.creditor,
            asset: line.asset_id,
            amount: amount_in,
            hops: vec![(line.creditor, line.asset_id)],
            visited: HashSet::from([(line.creditor, line.asset_id)]),
        };
        if admit(&mut admitted, label.clone()) {
            frontier.push(label);
        }
    }

    let mut best_payee: Option<Label> = None;
    for label in &frontier {
        note_payee(&mut best_payee, label, payee, to_asset);
    }

    // Later hops. Asset changes use the current debtor's FX quote.
    let max_extra = max_hops.saturating_sub(1);
    for _ in 0..max_extra {
        let mut next: Vec<Label> = Vec::new();
        for label in &frontier {
            expand_hops(
                label,
                label.asset,
                label.amount,
                &lines_by_debtor,
                &known,
                routing,
                now,
                sender,
                &mut admitted,
                &mut next,
            );
            if let Some(fx_list) = fx_by_poster_from.get(&(label.account, label.asset)) {
                for e in fx_list {
                    let Some(after_fx) = apply_rate(label.amount, e.fee_fixed, e.fx_rate) else {
                        continue;
                    };
                    expand_hops(
                        label,
                        e.to_asset,
                        after_fx,
                        &lines_by_debtor,
                        &known,
                        routing,
                        now,
                        sender,
                        &mut admitted,
                        &mut next,
                    );
                }
            }
        }
        if next.is_empty() {
            break;
        }
        for label in &next {
            note_payee(&mut best_payee, label, payee, to_asset);
        }
        frontier = next;
    }

    let best_payee = best_payee?;
    if best_payee.hops.is_empty() || best_payee.hops.len() > max_hops as usize {
        return None;
    }
    if best_payee.hops.last().map(|h| h.0) != Some(payee) {
        return None;
    }

    let hops = simulate_path_fees(&best_payee.hops, amount_in, sender, lines, routing, fx, now)?;
    let sim_out = hops.last().map(|h| h.amount).unwrap_or(0);

    Some(PathQuote {
        hops,
        amount_in,
        // Simulation is the fee source of truth.
        amount_out: if sim_out > 0 {
            sim_out
        } else {
            best_payee.amount
        },
    })
}

/// Walk a hop list the same way `path_pay` / search do, recording per-hop fees.
fn simulate_path_fees(
    hop_keys: &[(AccountNumber, u16)],
    amount_in: u64,
    sender: AccountNumber,
    _lines: &[LineEdge],
    routing: &[RoutingEdge],
    fx: &[FxEdge],
    now: i64,
) -> Option<Vec<PathHop>> {
    if hop_keys.is_empty() || amount_in == 0 {
        return None;
    }

    let mut hops = Vec::with_capacity(hop_keys.len());
    let mut forward = amount_in;
    let mut path_debtor = sender;
    let mut prev_asset = hop_keys[0].1;

    for (i, (next_creditor, asset_id)) in hop_keys.iter().enumerate() {
        let next_creditor = *next_creditor;
        let asset_id = *asset_id;
        if i == 0 {
            hops.push(PathHop {
                account: next_creditor,
                asset_id,
                amount: forward,
                hop_fee: 0,
                fx_fee: 0,
                fx_from_asset: None,
            });
            path_debtor = next_creditor;
            prev_asset = asset_id;
            continue;
        }

        let mut fx_fee = 0u64;
        let mut fx_from_asset = None;
        if asset_id != prev_asset {
            let e = fx.iter().find(|e| {
                e.poster == path_debtor
                    && e.from_asset == prev_asset
                    && e.to_asset == asset_id
                    && policy_live(e.expires_at, now)
                    && e.fx_rate > 0
            })?;
            fx_fee = e.fee_fixed;
            fx_from_asset = Some(prev_asset);
            forward = apply_rate(forward, e.fee_fixed, e.fx_rate)?;
        }

        let rpol = resolve_routing(routing, next_creditor, path_debtor, asset_id, now)?;
        let before_fee = forward;
        forward = apply_hop_fee(forward, rpol.hop_fee_fixed, rpol.hop_fee_percent_ppm)?;
        let hop_fee = before_fee.saturating_sub(forward);

        hops.push(PathHop {
            account: next_creditor,
            asset_id,
            amount: forward,
            hop_fee,
            fx_fee,
            fx_from_asset,
        });
        path_debtor = next_creditor;
        prev_asset = asset_id;
    }

    Some(hops)
}

/// Smallest send that delivers at least `amount_out`.
///
/// Each hop sequence is monotone, so its fees are inverted on their own.
/// Output across sequences is not: a larger send can miss a tight cheap hop
/// and fall through to a worse route, or to no route.
pub fn find_banx_path_exact_out(
    lines: &[LineEdge],
    routing: &[RoutingEdge],
    fx: &[FxEdge],
    sender: AccountNumber,
    payee: AccountNumber,
    amount_out: u64,
    from_asset: u16,
    to_asset: Option<u16>,
    max_hops: u8,
    now: i64,
) -> Option<PathQuote> {
    if amount_out == 0 || max_hops == 0 || sender == payee {
        return None;
    }

    let LineIndex {
        by_debtor: lines_by_debtor,
        known,
    } = index_lines(lines);
    let Some(first_lines) = lines_by_debtor.get(&sender) else {
        return None;
    };
    let first: Vec<(AccountNumber, u16)> = first_lines
        .iter()
        .filter(|l| l.asset_id == from_asset && l.creditor != sender)
        .map(|l| (l.creditor, l.asset_id))
        .collect();

    let mut best: Option<PathQuote> = None;
    for (creditor, asset) in first {
        let mut path = vec![(creditor, asset)];
        let mut visited = HashSet::from([(creditor, asset)]);
        walk_exact_out(
            &mut path,
            &mut visited,
            creditor,
            asset,
            max_hops - 1,
            &lines_by_debtor,
            &known,
            lines,
            routing,
            fx,
            sender,
            payee,
            amount_out,
            to_asset,
            now,
            &mut best,
        );
    }
    best
}

fn walk_exact_out(
    path: &mut Vec<(AccountNumber, u16)>,
    visited: &mut HashSet<(AccountNumber, u16)>,
    account: AccountNumber,
    asset: u16,
    hops_left: u8,
    lines_by_debtor: &HashMap<AccountNumber, Vec<&LineEdge>>,
    known: &HashSet<(AccountNumber, AccountNumber, u16)>,
    lines: &[LineEdge],
    routing: &[RoutingEdge],
    fx: &[FxEdge],
    sender: AccountNumber,
    payee: AccountNumber,
    amount_out: u64,
    to_asset: Option<u16>,
    now: i64,
    best: &mut Option<PathQuote>,
) {
    if account == payee && to_asset.map(|want| want == asset).unwrap_or(true) {
        note_exact_sequence(
            path, amount_out, sender, lines, routing, fx, known, now, best,
        );
    }
    if hops_left == 0 {
        return;
    }

    let mut nexts: Vec<(AccountNumber, u16)> = Vec::new();
    if let Some(out_lines) = lines_by_debtor.get(&account) {
        for line in out_lines {
            if line.asset_id == asset {
                push_exact_hop(
                    &mut nexts,
                    visited,
                    routing,
                    now,
                    sender,
                    account,
                    line.creditor,
                    asset,
                );
            }
        }
    }
    for edge in fx {
        if edge.poster != account
            || edge.from_asset != asset
            || edge.fx_rate == 0
            || !policy_live(edge.expires_at, now)
        {
            continue;
        }
        let Some(out_lines) = lines_by_debtor.get(&account) else {
            continue;
        };
        for line in out_lines {
            if line.asset_id != edge.to_asset {
                continue;
            }
            push_exact_hop(
                &mut nexts,
                visited,
                routing,
                now,
                sender,
                account,
                line.creditor,
                edge.to_asset,
            );
        }
    }

    for (creditor, hop_asset) in nexts {
        if !visited.insert((creditor, hop_asset)) {
            continue;
        }
        path.push((creditor, hop_asset));
        walk_exact_out(
            path,
            visited,
            creditor,
            hop_asset,
            hops_left - 1,
            lines_by_debtor,
            known,
            lines,
            routing,
            fx,
            sender,
            payee,
            amount_out,
            to_asset,
            now,
            best,
        );
        path.pop();
        visited.remove(&(creditor, hop_asset));
    }
}

fn push_exact_hop(
    nexts: &mut Vec<(AccountNumber, u16)>,
    visited: &HashSet<(AccountNumber, u16)>,
    routing: &[RoutingEdge],
    now: i64,
    sender: AccountNumber,
    debtor: AccountNumber,
    creditor: AccountNumber,
    asset: u16,
) {
    if creditor == debtor || creditor == sender || visited.contains(&(creditor, asset)) {
        return;
    }
    if resolve_routing(routing, creditor, debtor, asset, now).is_none() {
        return;
    }
    nexts.push((creditor, asset));
}

/// Smallest send on this sequence. Walk fees backward: undo the hop fee, then FX.
fn required_in(
    hop_keys: &[(AccountNumber, u16)],
    mut need: u64,
    routing: &[RoutingEdge],
    fx: &[FxEdge],
    now: i64,
) -> Option<u64> {
    if hop_keys.is_empty() || need == 0 {
        return None;
    }
    for i in (1..hop_keys.len()).rev() {
        let prev_account = hop_keys[i - 1].0;
        let prev_asset = hop_keys[i - 1].1;
        let (next_account, next_asset) = hop_keys[i];
        let policy = resolve_routing(routing, next_account, prev_account, next_asset, now)?;
        need = try_invert_hop_fee(need, policy.hop_fee_fixed, policy.hop_fee_percent_ppm)?;
        if next_asset != prev_asset {
            let edge = fx.iter().find(|edge| {
                edge.poster == prev_account
                    && edge.from_asset == prev_asset
                    && edge.to_asset == next_asset
                    && policy_live(edge.expires_at, now)
                    && edge.fx_rate > 0
            })?;
            need = try_invert_rate(need, edge.fee_fixed, edge.fx_rate)?;
        }
    }
    Some(need)
}

fn note_exact_sequence(
    hop_keys: &[(AccountNumber, u16)],
    amount_out: u64,
    sender: AccountNumber,
    lines: &[LineEdge],
    routing: &[RoutingEdge],
    fx: &[FxEdge],
    known: &HashSet<(AccountNumber, AccountNumber, u16)>,
    now: i64,
    best: &mut Option<PathQuote>,
) {
    let Some(amount_in) = required_in(hop_keys, amount_out, routing, fx, now) else {
        return;
    };
    let Some(hops) = simulate_path_fees(hop_keys, amount_in, sender, lines, routing, fx, now)
    else {
        return;
    };
    let out = hops.last().map(|hop| hop.amount).unwrap_or(0);
    if out < amount_out || !sequence_fits(&hops, sender, lines, routing, known, now) {
        return;
    }
    let replace = match best {
        None => true,
        Some(quote) => {
            amount_in < quote.amount_in || (amount_in == quote.amount_in && out > quote.amount_out)
        }
    };
    if replace {
        *best = Some(PathQuote {
            hops,
            amount_in,
            amount_out: out,
        });
    }
}

/// Post-fee draw on every hop fits some line, including APR and knows checks
/// once the draw is new capacity rather than an unwind.
fn sequence_fits(
    hops: &[PathHop],
    sender: AccountNumber,
    lines: &[LineEdge],
    routing: &[RoutingEdge],
    known: &HashSet<(AccountNumber, AccountNumber, u16)>,
    now: i64,
) -> bool {
    let mut debtor = sender;
    for (i, hop) in hops.iter().enumerate() {
        let draw = hop.amount;
        if draw == 0 {
            return false;
        }
        let ok = lines.iter().any(|line| {
            if line.creditor != hop.account
                || line.debtor != debtor
                || line.asset_id != hop.asset_id
            {
                return false;
            }
            if draw > line.capacity {
                return false;
            }
            if i == 0 {
                return true;
            }
            let Some(policy) = resolve_routing(routing, hop.account, debtor, hop.asset_id, now)
            else {
                return false;
            };
            let new_draw = draw.saturating_sub(line.reverse_claim);
            if !policy.allow_unknown
                && new_draw > 0
                && !known.contains(&(debtor, hop.account, hop.asset_id))
            {
                return false;
            }
            if new_draw > 0 && line.is_line && line.interest_rate_ppm > policy.max_accept_rate_ppm {
                return false;
            }
            true
        });
        if !ok {
            return false;
        }
        debtor = hop.account;
    }
    true
}

fn expand_hops(
    parent: &Label,
    hop_asset: u16,
    amount_in: u64,
    lines_by_debtor: &HashMap<AccountNumber, Vec<&LineEdge>>,
    known: &HashSet<(AccountNumber, AccountNumber, u16)>,
    routing: &[RoutingEdge],
    now: i64,
    sender: AccountNumber,
    admitted: &mut Vec<Label>,
    out: &mut Vec<Label>,
) {
    let debtor = parent.account;
    let Some(out_lines) = lines_by_debtor.get(&debtor) else {
        return;
    };
    for line in out_lines {
        if line.asset_id != hop_asset {
            continue;
        }
        if line.creditor == debtor || line.creditor == sender {
            continue;
        }
        if parent.visited.contains(&(line.creditor, hop_asset)) {
            continue;
        }
        let Some(rpol) = resolve_routing(routing, line.creditor, debtor, hop_asset, now) else {
            continue;
        };
        let Some(draw) = apply_hop_fee(amount_in, rpol.hop_fee_fixed, rpol.hop_fee_percent_ppm)
        else {
            continue;
        };
        if draw > line.capacity {
            continue;
        }
        // APR cap is only on new line capacity, not a pure unwind.
        let new_draw = draw.saturating_sub(line.reverse_claim);
        if !rpol.allow_unknown
            && new_draw > 0
            && !known.contains(&(debtor, line.creditor, hop_asset))
        {
            continue;
        }
        if new_draw > 0 && line.is_line && line.interest_rate_ppm > rpol.max_accept_rate_ppm {
            continue;
        }

        let mut visited = parent.visited.clone();
        visited.insert((line.creditor, hop_asset));
        let mut hops = parent.hops.clone();
        hops.push((line.creditor, hop_asset));
        let label = Label {
            account: line.creditor,
            asset: hop_asset,
            amount: draw,
            hops,
            visited,
        };
        if admit(admitted, label.clone()) {
            out.push(label);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use psibase::AccountNumber;

    fn acct(s: &str) -> AccountNumber {
        s.parse().unwrap_or_else(|_| panic!("{s}"))
    }

    fn find(
        lines: &[LineEdge],
        routing: &[RoutingEdge],
        fx: &[FxEdge],
        sender: &str,
        payee: &str,
        amount_in: u64,
        from_asset: u16,
        to_asset: Option<u16>,
        max_hops: u8,
        now: i64,
    ) -> Option<PathQuote> {
        find_banx_path(
            lines,
            routing,
            fx,
            acct(sender),
            acct(payee),
            amount_in,
            from_asset,
            to_asset,
            max_hops,
            now,
        )
    }

    fn find_out(
        lines: &[LineEdge],
        routing: &[RoutingEdge],
        fx: &[FxEdge],
        sender: &str,
        payee: &str,
        amount_out: u64,
        from_asset: u16,
        to_asset: Option<u16>,
        max_hops: u8,
        now: i64,
    ) -> Option<PathQuote> {
        find_banx_path_exact_out(
            lines,
            routing,
            fx,
            acct(sender),
            acct(payee),
            amount_out,
            from_asset,
            to_asset,
            max_hops,
            now,
        )
    }

    fn line(c: &str, d: &str, asset: u16, capacity: u64) -> LineEdge {
        LineEdge {
            creditor: acct(c),
            debtor: acct(d),
            asset_id: asset,
            capacity,
            reverse_claim: 0,
            exposure: 0,
            interest_rate_ppm: 0,
            is_line: true,
        }
    }

    fn line_with_reverse(c: &str, d: &str, asset: u16, headroom: u64, reverse: u64) -> LineEdge {
        LineEdge {
            creditor: acct(c),
            debtor: acct(d),
            asset_id: asset,
            capacity: headroom + reverse,
            reverse_claim: reverse,
            exposure: 0,
            interest_rate_ppm: 0,
            is_line: true,
        }
    }

    fn reverse_only(c: &str, d: &str, asset: u16, reverse: u64) -> LineEdge {
        LineEdge {
            creditor: acct(c),
            debtor: acct(d),
            asset_id: asset,
            capacity: reverse,
            reverse_claim: reverse,
            exposure: 0,
            interest_rate_ppm: 0,
            is_line: false,
        }
    }

    fn line_apr(c: &str, d: &str, asset: u16, capacity: u64, apr_ppm: u32) -> LineEdge {
        LineEdge {
            interest_rate_ppm: apr_ppm,
            ..line(c, d, asset, capacity)
        }
    }

    fn line_with_reverse_apr(
        c: &str,
        d: &str,
        asset: u16,
        headroom: u64,
        reverse: u64,
        apr_ppm: u32,
    ) -> LineEdge {
        LineEdge {
            interest_rate_ppm: apr_ppm,
            ..line_with_reverse(c, d, asset, headroom, reverse)
        }
    }

    fn global_rte_cap(debtor: &str, asset: u16, max_apr: u32, allow_unknown: bool) -> RoutingEdge {
        RoutingEdge {
            creditor: AccountNumber::new(0),
            debtor: acct(debtor),
            asset_id: asset,
            hop_fee_fixed: 0,
            hop_fee_percent_ppm: 0,
            max_accept_rate_ppm: max_apr,
            expires_at: 0,
            allow_unknown,
        }
    }

    fn global_rte(debtor: &str, asset: u16, fee_pct_ppm: u32) -> RoutingEdge {
        RoutingEdge {
            creditor: AccountNumber::new(0),
            debtor: acct(debtor),
            asset_id: asset,
            hop_fee_fixed: 0,
            hop_fee_percent_ppm: fee_pct_ppm,
            max_accept_rate_ppm: PPM_SCALE,
            expires_at: 0,
            allow_unknown: true,
        }
    }

    #[test]
    fn direct_line() {
        let lines = vec![line("bob", "alice", 1, 1_000_000)];
        let q = find(&lines, &[], &[], "alice", "bob", 100, 1, Some(1), 4, 0).expect("path");
        assert_eq!(q.hops.len(), 1);
        assert_eq!(q.hops[0].account, acct("bob"));
        assert_eq!(q.amount_in, 100);
        assert_eq!(q.amount_out, 100);
    }

    #[test]
    fn multi_hop_same_asset_with_fee() {
        // alice → gary → steve, 5% fee on second hop
        let lines = vec![
            line("gary", "alice", 1, 1_000_000),
            line("steve", "gary", 1, 1_000_000),
        ];
        let routing = vec![global_rte("gary", 1, PPM_SCALE * 5 / 100)];
        let q = find(
            &lines,
            &routing,
            &[],
            "alice",
            "steve",
            10_000,
            1,
            None,
            4,
            0,
        )
        .expect("path");
        assert_eq!(q.hops.len(), 2);
        assert_eq!(q.hops[0].account, acct("gary"));
        assert_eq!(q.hops[1].account, acct("steve"));
        assert_eq!(q.amount_in, 10_000);
        // second hop: 10000 * 0.95 = 9500
        assert_eq!(q.amount_out, 9_500);
        // Fee breakdown on hops
        assert_eq!(q.hops[0].hop_fee, 0);
        assert_eq!(q.hops[0].amount, 10_000);
        assert_eq!(q.hops[1].hop_fee, 500);
        assert_eq!(q.hops[1].amount, 9_500);
        assert_eq!(q.hops[1].fx_fee, 0);
        assert!(q.hops[1].fx_from_asset.is_none());
    }

    #[test]
    fn exact_in_still_works_with_tight_mid_capacity() {
        let lines = vec![
            line("gary", "alice", 1, 1_000_000),
            line("steve", "gary", 1, 20_000),
        ];
        let routing = vec![global_rte("gary", 1, PPM_SCALE * 5 / 100)];
        let q = find(
            &lines,
            &routing,
            &[],
            "alice",
            "steve",
            10_000,
            1,
            Some(1),
            4,
            0,
        )
        .expect("exact-in path");
        assert_eq!(q.amount_in, 10_000);
        assert_eq!(q.amount_out, 9_500);
    }

    /// 0% route puts 100 on mid; 50% route puts 50. Steve's line is 50, so
    /// only the smaller arrival fits. Search must still return that route.
    #[test]
    fn exact_in_keeps_lower_output_route_that_fits() {
        let lines = vec![
            line("gary", "alice", 1, 1_000),
            line("bob", "alice", 1, 1_000),
            line("mid", "gary", 1, 1_000),
            line("mid", "bob", 1, 1_000),
            line("steve", "mid", 1, 50),
        ];
        let routing = vec![
            global_rte("gary", 1, 0),
            global_rte("bob", 1, PPM_SCALE / 2),
            global_rte("mid", 1, 0),
        ];
        let q = find(
            &lines,
            &routing,
            &[],
            "alice",
            "steve",
            100,
            1,
            Some(1),
            4,
            0,
        )
        .expect("50% route still fits");
        assert_eq!(
            q.hops.iter().map(|h| h.account).collect::<Vec<_>>(),
            vec![acct("bob"), acct("mid"), acct("steve")]
        );
        assert_eq!(q.amount_in, 100);
        assert_eq!(q.amount_out, 50);

        let lines = vec![
            line("gary", "alice", 1, 1_000),
            line("bob", "alice", 1, 1_000),
            line("mid", "gary", 1, 1_000),
            line("mid", "bob", 1, 1_000),
            line("steve", "mid", 1, 1_000),
        ];
        let q = find(
            &lines,
            &routing,
            &[],
            "alice",
            "steve",
            100,
            1,
            Some(1),
            4,
            0,
        )
        .expect("both routes fit");
        assert_eq!(q.hops[0].account, acct("gary"));
        assert_eq!(q.amount_out, 100);
    }

    #[test]
    fn exact_out_absorbs_hop_fee() {
        // alice → gary → steve, 5% fee: to deliver 9500, need send 10000
        let lines = vec![
            line("gary", "alice", 1, 1_000_000),
            line("steve", "gary", 1, 1_000_000),
        ];
        let routing = vec![global_rte("gary", 1, PPM_SCALE * 5 / 100)];
        let q = find_out(
            &lines,
            &routing,
            &[],
            "alice",
            "steve",
            9_500,
            1,
            Some(1),
            4,
            0,
        )
        .expect("path");
        assert_eq!(q.hops.len(), 2);
        assert_eq!(q.amount_in, 10_000);
        assert!(q.amount_out >= 9_500);
    }

    #[test]
    fn exact_out_when_first_hop_capacity_far_exceeds_mid_path() {
        let lines = vec![
            line("gary", "alice", 1, 1_000_000),
            line("steve", "gary", 1, 20_000),
        ];
        let routing = vec![global_rte("gary", 1, PPM_SCALE * 5 / 100)];
        let q = find_out(
            &lines,
            &routing,
            &[],
            "alice",
            "steve",
            9_500,
            1,
            Some(1),
            4,
            0,
        )
        .expect("path");
        assert_eq!(q.amount_in, 10_000);
        assert!(q.amount_out >= 9_500);
    }

    #[test]
    fn exact_out_doubling_gap_near_capacity_cap() {
        let lines = vec![
            line("gary", "alice", 1, 1_000_000),
            line("steve", "gary", 1, 20_000),
        ];
        let routing = vec![global_rte("gary", 1, PPM_SCALE * 5 / 100)];
        let q = find_out(
            &lines,
            &routing,
            &[],
            "alice",
            "steve",
            19_000,
            1,
            Some(1),
            4,
            0,
        )
        .expect("path");
        assert!(q.amount_out >= 19_000);
        // 19000 / 0.95 = 20000 exactly
        assert_eq!(q.amount_in, 20_000);
    }

    #[test]
    fn exact_out_direct_line_no_fee() {
        let lines = vec![line("bob", "alice", 1, 1_000_000)];
        let q = find_out(&lines, &[], &[], "alice", "bob", 100, 1, Some(1), 4, 0).expect("path");
        assert_eq!(q.amount_in, 100);
        assert_eq!(q.amount_out, 100);
    }

    #[test]
    fn exact_out_fixed_fee_needs_larger_notional() {
        // 10 fixed on second hop: tiny sends fail; desired 100 needs send 110.
        let lines = vec![
            line("gary", "alice", 1, 1_000_000),
            line("steve", "gary", 1, 1_000_000),
        ];
        let routing = vec![RoutingEdge {
            creditor: AccountNumber::new(0),
            debtor: acct("gary"),
            asset_id: 1,
            hop_fee_fixed: 10,
            hop_fee_percent_ppm: 0,
            max_accept_rate_ppm: PPM_SCALE,
            expires_at: 0,
            allow_unknown: true,
        }];
        let q = find_out(
            &lines,
            &routing,
            &[],
            "alice",
            "steve",
            100,
            1,
            Some(1),
            4,
            0,
        )
        .expect("grows past fixed fee floor");
        assert_eq!(q.amount_in, 110);
        assert_eq!(q.amount_out, 100);
    }

    /// Cheap capacity 50 cannot carry 80. The other route charges a fixed fee
    /// of 100, so the send is 180. Search must not stop when the cheap route
    /// runs out of capacity.
    #[test]
    fn exact_out_uses_larger_send_when_cheap_route_is_short() {
        let lines = vec![
            line("gary", "alice", 1, 1_000),
            line("steve", "gary", 1, 50),
            line("bob", "alice", 1, 1_000),
            line("steve", "bob", 1, 1_000),
        ];
        let routing = vec![
            global_rte("gary", 1, 0),
            RoutingEdge {
                creditor: AccountNumber::new(0),
                debtor: acct("bob"),
                asset_id: 1,
                hop_fee_fixed: 100,
                hop_fee_percent_ppm: 0,
                max_accept_rate_ppm: PPM_SCALE,
                expires_at: 0,
                allow_unknown: true,
            },
        ];
        let q = find_out(
            &lines,
            &routing,
            &[],
            "alice",
            "steve",
            80,
            1,
            Some(1),
            4,
            0,
        )
        .expect("fee route delivers 80");
        assert_eq!(q.hops[0].account, acct("bob"));
        assert_eq!(q.amount_in, 180);
        assert!(q.amount_out >= 80);
    }

    /// Send 100 on the 0% route delivers 100. A 50% route needs about 200.
    /// The search must keep the smaller send.
    #[test]
    fn exact_out_keeps_smaller_send_on_cheap_route() {
        let lines = vec![
            line("gary", "alice", 1, 1_000),
            line("steve", "gary", 1, 100),
            line("bob", "alice", 1, 1_000),
            line("steve", "bob", 1, 1_000),
        ];
        let routing = vec![
            global_rte("gary", 1, 0),
            global_rte("bob", 1, PPM_SCALE / 2),
        ];
        let q = find_out(
            &lines,
            &routing,
            &[],
            "alice",
            "steve",
            100,
            1,
            Some(1),
            4,
            0,
        )
        .expect("cheap route");
        assert_eq!(q.hops[0].account, acct("gary"));
        assert_eq!(q.amount_in, 100);
        assert_eq!(q.amount_out, 100);
    }

    /// 1000 AUD at 0.70 delivers 700 USD, so delivering 700 inverts to send 1000.
    #[test]
    fn exact_out_inverts_fx() {
        let aud = 1u16;
        let usd = 2u16;
        let lines = vec![
            line("gary", "alice", aud, 10_000),
            line("steve", "gary", usd, 10_000),
        ];
        let routing = vec![global_rte("gary", usd, 0)];
        let fx = vec![FxEdge {
            poster: acct("gary"),
            from_asset: aud,
            to_asset: usd,
            fee_fixed: 0,
            fx_rate: RATE_SCALE * 70 / 100,
            expires_at: 0,
        }];
        let q = find_out(
            &lines,
            &routing,
            &fx,
            "alice",
            "steve",
            700,
            aud,
            Some(usd),
            4,
            0,
        )
        .expect("fx invert");
        assert_eq!(q.amount_in, 1_000);
        assert_eq!(q.amount_out, 700);
    }

    #[test]
    fn mid_path_fx() {
        let aud = 1u16;
        let usd = 2u16;
        let lines = vec![
            line("mitchell", "zac", aud, 1_000_000),
            line("john", "mitchell", aud, 1_000_000),
            line("mike", "john", usd, 1_000_000),
            line("brandon", "mike", usd, 1_000_000),
        ];
        let routing = vec![
            global_rte("mitchell", aud, PPM_SCALE * 5 / 100),
            global_rte("john", usd, 0),
            global_rte("mike", usd, PPM_SCALE * 1 / 100),
        ];
        let fx = vec![FxEdge {
            poster: acct("john"),
            from_asset: aud,
            to_asset: usd,
            fee_fixed: 0,
            fx_rate: RATE_SCALE * 65 / 100,
            expires_at: 0,
        }];

        let q = find(
            &lines,
            &routing,
            &fx,
            "zac",
            "brandon",
            10_000,
            aud,
            Some(usd),
            6,
            0,
        )
        .expect("path");
        assert_eq!(
            q.hops
                .iter()
                .map(|h| h.account.to_string())
                .collect::<Vec<_>>(),
            vec!["mitchell", "john", "mike", "brandon"]
        );
        // 10000 → mitchell
        // mitchell→john 5%: 9500 AUD
        // FX mitchell 0.65: 9500 * 0.65 = 6175 USD
        // john→mike 0%: 6175
        // mike→brandon 1%: 6113 (floor)
        assert_eq!(q.amount_out, 6_113);
    }

    #[test]
    fn no_path_without_capacity() {
        let lines = vec![line("bob", "alice", 1, 50)];
        assert!(find(&lines, &[], &[], "alice", "bob", 100, 1, None, 2, 0).is_none());
    }

    #[test]
    fn reverse_claim_edges_unwind_path() {
        // After A→B→C, reverse claims let C→B→A unwind without opposite lines.
        let lines = vec![line("b", "c", 1, 100), line("a", "b", 1, 100)];
        let routing = vec![global_rte("b", 1, 0)];
        let q = find(&lines, &routing, &[], "c", "a", 100, 1, Some(1), 4, 0).expect("reverse path");
        assert_eq!(q.hops.len(), 2);
        assert_eq!(q.hops[0].account, acct("b"));
        assert_eq!(q.hops[1].account, acct("a"));
        assert_eq!(q.amount_out, 100);
    }

    /// Mirrors `test_max_line_apr_allows_unwind`: high APR on the next hop
    /// does not block a hop that only unwinds a reverse claim.
    #[test]
    fn max_line_apr_allows_unwind() {
        let usd = 1u16;
        let lines = vec![
            line("gary", "alice", usd, 10_000),
            line_with_reverse_apr("steve", "gary", usd, 10_000, 100, 20_000),
        ];
        let routing = vec![global_rte_cap("gary", usd, 10_000, false)];
        let q = find(
            &lines,
            &routing,
            &[],
            "alice",
            "steve",
            100,
            usd,
            Some(usd),
            4,
            0,
        )
        .expect("unwind path despite APR over cap");
        assert_eq!(q.hops.len(), 2);
        assert_eq!(q.hops[0].account, acct("gary"));
        assert_eq!(q.hops[1].account, acct("steve"));
        assert_eq!(q.amount_in, 100);
        assert_eq!(q.amount_out, 100);
    }

    /// Mirrors `test_max_line_apr_rejects_forward`.
    #[test]
    fn max_line_apr_rejects_new_draw() {
        let usd = 1u16;
        let lines = vec![
            line("gary", "alice", usd, 10_000),
            line_apr("steve", "gary", usd, 10_000, 20_000),
        ];
        let routing = vec![global_rte_cap("gary", usd, 10_000, true)];
        assert!(find(
            &lines,
            &routing,
            &[],
            "alice",
            "steve",
            100,
            usd,
            Some(usd),
            4,
            0,
        )
        .is_none());
    }

    #[test]
    fn max_line_apr_rejects_mixed_unwind_and_new_draw() {
        let usd = 1u16;
        let lines = vec![
            line("gary", "alice", usd, 10_000),
            line_with_reverse_apr("steve", "gary", usd, 10_000, 100, 20_000),
        ];
        let routing = vec![global_rte_cap("gary", usd, 10_000, false)];
        assert!(
            find(
                &lines,
                &routing,
                &[],
                "alice",
                "steve",
                101,
                usd,
                Some(usd),
                4,
                0,
            )
            .is_none(),
            "new_draw over reverse claim is still capped"
        );
    }

    /// Same setup as `test_expired_specific_falls_back_to_global`.
    #[test]
    fn expired_specific_does_not_beat_live_global() {
        let lines = vec![
            line("gary", "alice", 1, 10_000),
            line("steve", "gary", 1, 10_000),
        ];
        let routing = vec![
            RoutingEdge {
                creditor: acct("steve"),
                debtor: acct("gary"),
                asset_id: 1,
                hop_fee_fixed: 0,
                hop_fee_percent_ppm: 0,
                max_accept_rate_ppm: PPM_SCALE,
                expires_at: 1,
                allow_unknown: true,
            },
            RoutingEdge {
                creditor: AccountNumber::new(0),
                debtor: acct("gary"),
                asset_id: 1,
                hop_fee_fixed: 10,
                hop_fee_percent_ppm: 0,
                max_accept_rate_ppm: PPM_SCALE,
                expires_at: 0,
                allow_unknown: true,
            },
        ];
        let q = find(
            &lines,
            &routing,
            &[],
            "alice",
            "steve",
            100,
            1,
            Some(1),
            4,
            100,
        )
        .expect("path");
        assert_eq!(
            q.amount_out, 90,
            "expired specific (0 fee) must not beat live global (10 fixed)"
        );
    }

    #[test]
    fn fx_converts_full_hop_notional() {
        let aud = 1u16;
        let usd = 2u16;
        let lines = vec![
            line("gary", "alice", aud, 10_000),
            line("steve", "gary", usd, 10_000),
        ];
        let routing = vec![global_rte("gary", usd, 0)];
        let fx = vec![FxEdge {
            poster: acct("gary"),
            from_asset: aud,
            to_asset: usd,
            fee_fixed: 0,
            fx_rate: RATE_SCALE * 70 / 100,
            expires_at: 0,
        }];
        let q = find(
            &lines,
            &routing,
            &fx,
            "alice",
            "steve",
            1_000,
            aud,
            Some(usd),
            4,
            0,
        )
        .expect("path");
        assert_eq!(
            q.amount_out, 700,
            "1000 AUD at 0.70 → 700 USD, not leftover"
        );
    }

    /// Unwind does not shrink the FX'd notional (1000 AUD → 700 USD).
    #[test]
    fn fx_after_partial_reverse_net_uses_hop_notional() {
        let aud = 1u16;
        let usd = 2u16;
        let hop0 = line_with_reverse("gary", "alice", aud, 10_000, 400);
        let lines = vec![hop0, line("steve", "gary", usd, 10_000)];
        let routing = vec![global_rte("gary", usd, 0)];
        let fx = vec![FxEdge {
            poster: acct("gary"),
            from_asset: aud,
            to_asset: usd,
            fee_fixed: 0,
            fx_rate: RATE_SCALE * 70 / 100,
            expires_at: 0,
        }];
        let q = find(
            &lines,
            &routing,
            &fx,
            "alice",
            "steve",
            1_000,
            aud,
            Some(usd),
            4,
            0,
        )
        .expect("path");
        assert_eq!(
            q.amount_out, 700,
            "1000 AUD hop notional at 0.70 → 700, not leftover 600 → 420"
        );
    }

    #[test]
    fn fx_after_full_reverse_net_uses_hop_notional() {
        let aud = 1u16;
        let usd = 2u16;
        let lines = vec![
            line_with_reverse("gary", "alice", aud, 10_000, 1_000),
            line("steve", "gary", usd, 10_000),
        ];
        let routing = vec![global_rte("gary", usd, 0)];
        let fx = vec![FxEdge {
            poster: acct("gary"),
            from_asset: aud,
            to_asset: usd,
            fee_fixed: 0,
            fx_rate: RATE_SCALE * 70 / 100,
            expires_at: 0,
        }];
        let q = find(
            &lines,
            &routing,
            &fx,
            "alice",
            "steve",
            1_000,
            aud,
            Some(usd),
            4,
            0,
        )
        .expect("path");
        assert_eq!(q.amount_out, 700);
    }

    /// Matches `test_path_pay_fx_aud_usd_gbp_after_partial_reverse`.
    #[test]
    fn fx_aud_usd_gbp_after_partial_reverse_uses_hop_notional() {
        let aud = 1u16;
        let usd = 2u16;
        let gbp = 3u16;
        let hop0 = line_with_reverse("gary", "alice", aud, 10_000, 400);
        let lines = vec![
            hop0,
            line("steve", "gary", usd, 10_000),
            line("sam", "steve", gbp, 10_000),
        ];
        let routing = vec![global_rte("gary", usd, 0), global_rte("steve", gbp, 0)];
        let fx = vec![
            FxEdge {
                poster: acct("gary"),
                from_asset: aud,
                to_asset: usd,
                fee_fixed: 0,
                fx_rate: RATE_SCALE * 70 / 100,
                expires_at: 0,
            },
            FxEdge {
                poster: acct("steve"),
                from_asset: usd,
                to_asset: gbp,
                fee_fixed: 0,
                fx_rate: RATE_SCALE * 80 / 100,
                expires_at: 0,
            },
        ];
        let q = find(
            &lines,
            &routing,
            &fx,
            "alice",
            "sam",
            1_000,
            aud,
            Some(gbp),
            4,
            0,
        )
        .expect("path");
        assert_eq!(q.hops.len(), 3);
        assert_eq!(
            q.hops
                .iter()
                .map(|h| h.account.to_string())
                .collect::<Vec<_>>(),
            vec!["gary", "steve", "sam"]
        );
        assert_eq!(q.hops[1].amount, 700);
        assert_eq!(
            q.amount_out, 560,
            "1000 AUD × 0.70 × 0.80 → 560 GBP, not leftover 600 × 0.70 × 0.80"
        );
    }

    #[test]
    fn closed_global_requires_line_to_next_hop() {
        let hop_lines = vec![
            line("gary", "alice", 1, 10_000),
            line("steve", "gary", 1, 10_000),
        ];
        let mut closed = global_rte("gary", 1, 0);
        closed.allow_unknown = false;
        assert!(
            find(
                &hop_lines,
                &[closed.clone()],
                &[],
                "alice",
                "steve",
                100,
                1,
                Some(1),
                4,
                0
            )
            .is_none(),
            "closed forward without gary→steve line"
        );
        let mut with_known = hop_lines;
        with_known.push(LineEdge {
            creditor: acct("gary"),
            debtor: acct("steve"),
            asset_id: 1,
            capacity: 0,
            reverse_claim: 0,
            exposure: 0,
            interest_rate_ppm: 0,
            is_line: true,
        });
        let q = find(
            &with_known,
            &[closed],
            &[],
            "alice",
            "steve",
            100,
            1,
            Some(1),
            4,
            0,
        )
        .expect("0-limit line is enough");
        assert_eq!(q.amount_out, 100);
    }

    /// Cafe coffee: john has a prepaid reverse claim, closed specific
    /// forward to the cafe. Same as Connection::knows via a live claim.
    #[test]
    fn closed_forward_known_via_reverse_claim() {
        let lines = vec![
            line("john", "mitchell", 1, 1_000_000),
            reverse_only("cafe", "john", 1, 100_0000),
        ];
        let closed = RoutingEdge {
            creditor: acct("cafe"),
            debtor: acct("john"),
            asset_id: 1,
            hop_fee_fixed: 0,
            hop_fee_percent_ppm: PPM_SCALE / 100,
            max_accept_rate_ppm: PPM_SCALE,
            expires_at: 0,
            allow_unknown: false,
        };
        let q = find(
            &lines,
            &[closed],
            &[],
            "mitchell",
            "cafe",
            5_0506,
            1,
            Some(1),
            4,
            0,
        )
        .expect("prepaid reverse claim is enough for closed forward");
        assert_eq!(
            q.hops
                .iter()
                .map(|h| h.account.to_string())
                .collect::<Vec<_>>(),
            vec!["john", "cafe"]
        );
        assert_eq!(q.amount_out, 5_0000);
    }

    #[test]
    fn closed_forward_dust_plus_line_does_not_open_new_draw() {
        let lines = vec![
            line("alice", "sender", 1, 10_000),
            line_with_reverse("mallory", "alice", 1, 10_000, 1),
        ];
        let mut closed = global_rte("alice", 1, 0);
        closed.allow_unknown = false;
        assert!(
            find(
                &lines,
                &[closed],
                &[],
                "sender",
                "mallory",
                100,
                1,
                Some(1),
                4,
                0,
            )
            .is_none(),
            "mallory owing alice 1 must not open a 100 new_draw hop"
        );
    }

    /// Hub is drawn in AUD, then again in USD after Relay converts. A same-asset
    /// return to Hub still does not open a second draw.
    #[test]
    fn hub_reenters_in_another_asset() {
        let aud = 1u16;
        let eur = 2u16;
        let usd = 3u16;
        let lines = vec![
            line("hub", "alice", aud, 1_000),
            line("relay", "hub", eur, 1_000),
            line("hub", "relay", usd, 1_000),
            line("dave", "hub", usd, 1_000),
        ];
        let routing = vec![
            global_rte("hub", eur, 0),
            global_rte("relay", usd, 0),
            global_rte("hub", usd, 0),
        ];
        let fx = vec![
            FxEdge {
                poster: acct("hub"),
                from_asset: aud,
                to_asset: eur,
                fee_fixed: 0,
                fx_rate: RATE_SCALE,
                expires_at: 0,
            },
            FxEdge {
                poster: acct("relay"),
                from_asset: eur,
                to_asset: usd,
                fee_fixed: 0,
                fx_rate: RATE_SCALE,
                expires_at: 0,
            },
        ];
        let q = find(
            &lines,
            &routing,
            &fx,
            "alice",
            "dave",
            100,
            aud,
            Some(usd),
            4,
            0,
        )
        .expect("hub can forward USD after the AUD draw");
        assert_eq!(
            q.hops
                .iter()
                .map(|h| (h.account, h.asset_id))
                .collect::<Vec<_>>(),
            vec![
                (acct("hub"), aud),
                (acct("relay"), eur),
                (acct("hub"), usd),
                (acct("dave"), usd),
            ]
        );
        assert_eq!(q.amount_in, 100);
        assert_eq!(q.amount_out, 100);
    }

    #[test]
    fn same_asset_reentry_is_blocked() {
        let aud = 1u16;
        let lines = vec![
            line("hub", "alice", aud, 1_000),
            line("relay", "hub", aud, 1_000),
            line("hub", "relay", aud, 1_000),
            line("dave", "hub", aud, 100),
        ];
        let routing = vec![
            global_rte("hub", aud, 0),
            global_rte("relay", aud, PPM_SCALE / 2),
        ];
        assert!(
            find(
                &lines,
                &routing,
                &[],
                "alice",
                "dave",
                200,
                aud,
                Some(aud),
                4,
                0,
            )
            .is_none(),
            "returning to hub in AUD must not shrink 200 down to dave's line"
        );
    }
}
