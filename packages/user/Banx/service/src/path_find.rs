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
    visited: HashSet<AccountNumber>,
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

fn visited_subset(a: &HashSet<AccountNumber>, b: &HashSet<AccountNumber>) -> bool {
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

    // Index lines by debtor for expansion. Known matches Connection::knows:
    // who lined them, or who already owes them. Them owing who is not
    // enough (anyone can `deposit`); a hop with new_draw == 0 still proceeds.
    let mut lines_by_debtor: HashMap<AccountNumber, Vec<&LineEdge>> = HashMap::new();
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
            lines_by_debtor.entry(l.debtor).or_default().push(l);
        }
    }

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
            visited: HashSet::from([line.creditor]),
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

/// Find a path that delivers at least `amount_out` to the payee, minimizing
/// `amount_in` (sender absorbs hop/FX fees).
///
/// Important: we must **not** probe the full first-hop capacity first. A large
/// `amount_in` often exceeds intermediate capacity and makes the exact-in
/// searcher return `None` even when a smaller send works (the exact-in UX
/// case). Expand upward from a small probe, then binary-search the minimum
/// send that still clears `amount_out`.
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

    let max_in = lines
        .iter()
        .filter(|l| l.debtor == sender && l.asset_id == from_asset && l.capacity > 0)
        .map(|l| l.capacity)
        .max()
        .unwrap_or(0);
    if max_in == 0 {
        return None;
    }

    let try_in = |amount_in: u64| {
        find_banx_path(
            lines, routing, fx, sender, payee, amount_in, from_asset, to_asset, max_hops, now,
        )
    };

    // Phase 1: find some amount_in that clears `amount_out`.
    //
    // Do not probe max first-hop capacity first — large notions often exceed
    // intermediate capacity and look like "no path". Grow from small values.
    //
    // Feasibility is not fully monotonic (fixed hop fees reject tiny notions;
    // hop capacity rejects huge ones), so when doubling jumps over capacity
    // we binary-search the gap for the largest still-feasible send.
    let mut probe = 1u64;
    let mut upper: Option<PathQuote> = None;
    let mut last_ok: Option<PathQuote> = None;

    loop {
        match try_in(probe) {
            Some(q) if q.amount_out >= amount_out => {
                upper = Some(q);
                break;
            }
            Some(q) => {
                last_ok = Some(q);
            }
            None => {
                if let Some(ref ok) = last_ok {
                    // Doubling jumped past capacity. Search (ok, probe)
                    // for the largest feasible amount_in — may still be enough.
                    let mut flo = ok.amount_in.saturating_add(1);
                    let mut fhi = probe.saturating_sub(1);
                    let mut max_feas = ok.clone();
                    while flo <= fhi {
                        let mid = flo + (fhi - flo) / 2;
                        match try_in(mid) {
                            Some(q) => {
                                max_feas = q;
                                flo = mid.saturating_add(1);
                            }
                            None => {
                                if mid == 0 {
                                    break;
                                }
                                fhi = mid - 1;
                            }
                        }
                    }
                    if max_feas.amount_out >= amount_out {
                        upper = Some(max_feas);
                    }
                    break;
                }
                // Still no feasible path (e.g. fixed fees need a larger notional).
            }
        }
        if probe >= max_in {
            break;
        }
        let next = probe.saturating_mul(2).max(probe.saturating_add(1));
        probe = next.min(max_in);
    }

    let upper = upper?;
    let mut lo = 1u64;
    let mut hi = upper.amount_in;
    let mut best = upper;

    // Phase 2: minimize amount_in while still clearing amount_out.
    while lo <= hi {
        let mid = lo + (hi - lo) / 2;
        match try_in(mid) {
            Some(q) if q.amount_out >= amount_out => {
                best = q;
                if mid == 0 {
                    break;
                }
                hi = mid - 1;
            }
            _ => lo = mid.saturating_add(1),
        }
    }
    Some(best)
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
        if parent.visited.contains(&line.creditor) {
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
        visited.insert(line.creditor);
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
}
