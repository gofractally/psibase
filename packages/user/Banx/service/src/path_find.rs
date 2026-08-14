//! Off-chain multi-hop path discovery for Banx `path_pay`.
//!
//! Algorithm mirrors TokenSwap's layered max-output search (`find_path` over
//! pools), but edges are **credit lines** (+ routing fees / FX policies), not
//! AMM pools. Pure logic — no chain IO.

use std::collections::{HashMap, HashSet};

/// Matches service `RATE_SCALE` / `PPM_SCALE`.
pub const RATE_SCALE: u64 = 1_000_000;
pub const PPM_SCALE: u32 = 1_000_000;

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct LineEdge {
    pub creditor: String,
    pub debtor: String,
    pub asset_id: u16,
    /// `limit - exposure` (raw units). 0 = closed.
    pub residual: u64,
    pub interest_rate_ppm: u32,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct RoutingEdge {
    /// Empty string or `"0"` = global (any next hop).
    pub creditor: String,
    pub debtor: String,
    pub asset_id: u16,
    pub hop_fee_fixed: u64,
    pub hop_fee_percent_ppm: u32,
    pub max_accept_rate_ppm: u32,
    /// Unix seconds; `0` = never.
    pub expires_at: i64,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct FxEdge {
    pub debtor: String,
    pub from_asset: u16,
    pub to_asset: u16,
    pub fee_fixed: u64,
    pub fx_rate: u64,
    pub expires_at: i64,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct PathHop {
    pub account: String,
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

fn is_global_creditor(c: &str) -> bool {
    c.is_empty() || c == "0"
}

/// `out = (in - fee_fixed) * rate / RATE_SCALE`. Returns `None` if invalid.
pub fn apply_rate(amount_in: u64, fee_fixed: u64, rate: u64) -> Option<u64> {
    if fee_fixed >= amount_in || rate == 0 {
        return None;
    }
    let after = amount_in - fee_fixed;
    let out = (after as u128)
        .checked_mul(rate as u128)?
        .checked_div(RATE_SCALE as u128)?;
    let out = u64::try_from(out).ok()?;
    if out == 0 {
        return None;
    }
    Some(out)
}

/// Stripe-style: `out = in * (PPM_SCALE - percent) / PPM_SCALE - fixed`.
pub fn apply_hop_fee(amount_in: u64, fee_fixed: u64, fee_percent_ppm: u32) -> Option<u64> {
    // Must be under 100% (same as on-chain: hop_fee_percent < PPM_SCALE).
    if fee_percent_ppm >= PPM_SCALE {
        return None;
    }
    let keep = (PPM_SCALE - fee_percent_ppm) as u128;
    let after_pct = (amount_in as u128)
        .checked_mul(keep)?
        .checked_div(PPM_SCALE as u128)?;
    let after_pct = u64::try_from(after_pct).ok()?;
    if fee_fixed >= after_pct {
        return None;
    }
    let out = after_pct - fee_fixed;
    if out == 0 {
        return None;
    }
    Some(out)
}

fn resolve_routing<'a>(
    routing: &'a [RoutingEdge],
    next_creditor: &str,
    debtor: &str,
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
        if is_global_creditor(&r.creditor) {
            global = Some(r);
        } else if r.creditor == next_creditor {
            return Some(r);
        }
    }
    global
}

type StateKey = (String, u16); // (account as path debtor after hop, asset)

#[derive(Clone, Debug)]
struct Pred {
    /// Previous state account; empty for hop 0 (from sender).
    prev_account: String,
    prev_asset: u16,
    /// Hop that was taken to reach this state.
    hop_account: String,
    hop_asset: u16,
}

/// Find a multi-hop path from `sender` to `payee` maximizing residual amount.
///
/// `max_hops` is the maximum number of path_pay hops (1 = direct line only).
/// `now` is unix seconds for policy expiry (use 0 to ignore wall-clock).
///
/// Optional `to_asset`: require final hop in that asset.
pub fn find_banx_path(
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
    if amount_in == 0 || max_hops == 0 || sender == payee {
        return None;
    }

    // Index lines by debtor for expansion.
    let mut lines_by_debtor: HashMap<&str, Vec<&LineEdge>> = HashMap::new();
    for l in lines {
        if l.residual > 0 {
            lines_by_debtor.entry(l.debtor.as_str()).or_default().push(l);
        }
    }

    let mut fx_by_debtor_from: HashMap<(&str, u16), Vec<&FxEdge>> = HashMap::new();
    for e in fx {
        if policy_live(e.expires_at, now) && e.fx_rate > 0 {
            fx_by_debtor_from
                .entry((e.debtor.as_str(), e.from_asset))
                .or_default()
                .push(e);
        }
    }

    let mut best: HashMap<StateKey, u64> = HashMap::new();
    let mut pred: HashMap<StateKey, Pred> = HashMap::new();
    // Accounts on the path when this state was reached (including hop accounts).
    let mut path_accounts: HashMap<StateKey, HashSet<String>> = HashMap::new();

    // --- Hop 0: no routing fee; line debtor = sender ---
    let Some(first_lines) = lines_by_debtor.get(sender) else {
        return None;
    };
    for line in first_lines {
        if line.asset_id != from_asset {
            continue;
        }
        if line.creditor == sender {
            continue;
        }
        if amount_in > line.residual {
            continue;
        }
        let key = (line.creditor.clone(), line.asset_id);
        let amt = amount_in;
        if best.get(&key).map_or(true, |&b| amt > b) {
            best.insert(key.clone(), amt);
            pred.insert(
                key.clone(),
                Pred {
                    prev_account: String::new(),
                    prev_asset: from_asset,
                    hop_account: line.creditor.clone(),
                    hop_asset: line.asset_id,
                },
            );
            path_accounts.insert(key, HashSet::from([line.creditor.clone()]));
        }
    }

    // Later hops: expand from reached states (TokenSwap-style layered rounds).
    //
    // On-chain, asset changes convert via CurrencyPolicy of **prev_edge_debtor**
    // (path debtor before the hop that created the current edge), then route from
    // the current path_debtor. For state (D, A):
    //   fx_debtor = pred.prev_account if set, else sender.
    let max_extra = max_hops.saturating_sub(1);
    for _ in 0..max_extra {
        let mut candidates: HashMap<StateKey, (u64, Pred, HashSet<String>)> = HashMap::new();

        for ((debtor, asset), &amt) in &best {
            let key = (debtor.clone(), *asset);
            let visited = path_accounts.get(&key).cloned().unwrap_or_default();
            let p = pred.get(&key);
            let fx_debtor = p
                .map(|pr| {
                    if pr.prev_account.is_empty() {
                        sender
                    } else {
                        pr.prev_account.as_str()
                    }
                })
                .unwrap_or(sender);

            // Same-asset forward hops (no convert).
            expand_hops(
                debtor,
                *asset, // state asset
                *asset, // hop asset
                amt,
                &lines_by_debtor,
                routing,
                now,
                &visited,
                sender,
                &mut candidates,
            );

            // Asset-change hops: convert claim on fx_debtor, then route from debtor.
            if let Some(fx_list) = fx_by_debtor_from.get(&(fx_debtor, *asset)) {
                for e in fx_list {
                    let Some(after_fx) = apply_rate(amt, e.fee_fixed, e.fx_rate) else {
                        continue;
                    };
                    expand_hops(
                        debtor,
                        *asset,     // previous state asset (for pred walk)
                        e.to_asset, // hop / line asset after FX
                        after_fx,
                        &lines_by_debtor,
                        routing,
                        now,
                        &visited,
                        sender,
                        &mut candidates,
                    );
                }
            }
        }

        let mut updated = false;
        for (key, (amt, p, visited)) in candidates {
            let old = *best.get(&key).unwrap_or(&0);
            if amt > old {
                best.insert(key.clone(), amt);
                pred.insert(key.clone(), p);
                path_accounts.insert(key, visited);
                updated = true;
            }
        }
        if !updated {
            break;
        }
    }

    // Pick best state at payee.
    let mut best_payee: Option<(StateKey, u64)> = None;
    for ((acct, asset), &amt) in &best {
        if acct != payee {
            continue;
        }
        if let Some(want) = to_asset {
            if *asset != want {
                continue;
            }
        }
        let better = match &best_payee {
            None => true,
            Some((_, a)) => amt > *a,
        };
        if better {
            best_payee = Some(((acct.clone(), *asset), amt));
        }
    }

    let ((mut cur_acct, mut cur_asset), amount_out) = best_payee?;
    if amount_out == 0 {
        return None;
    }

    // Reconstruct hop accounts/assets (fees filled by simulate_path_fees).
    let mut hop_keys = Vec::new();
    loop {
        let p = pred.get(&(cur_acct.clone(), cur_asset))?;
        hop_keys.push((p.hop_account.clone(), p.hop_asset));
        if p.prev_account.is_empty() {
            break;
        }
        cur_acct = p.prev_account.clone();
        cur_asset = p.prev_asset;
    }
    hop_keys.reverse();
    if hop_keys.is_empty() || hop_keys.len() > max_hops as usize {
        return None;
    }
    // Last hop must be payee.
    if hop_keys.last()?.0 != payee {
        return None;
    }

    let hops = simulate_path_fees(&hop_keys, amount_in, sender, routing, fx, now)?;
    let sim_out = hops.last().map(|h| h.amount).unwrap_or(0);

    Some(PathQuote {
        hops,
        amount_in,
        // Prefer search residual when both agree; simulation is the fee source of truth.
        amount_out: if sim_out > 0 { sim_out } else { amount_out },
    })
}

/// Walk a hop list the same way `path_pay` / search do, recording per-hop fees.
fn simulate_path_fees(
    hop_keys: &[(String, u16)],
    amount_in: u64,
    sender: &str,
    routing: &[RoutingEdge],
    fx: &[FxEdge],
    now: i64,
) -> Option<Vec<PathHop>> {
    if hop_keys.is_empty() || amount_in == 0 {
        return None;
    }

    let mut hops = Vec::with_capacity(hop_keys.len());
    let mut forward = amount_in;
    let mut path_debtor = sender.to_string();
    let mut prev_edge_debtor = sender.to_string();
    let mut prev_asset = hop_keys[0].1;

    for (i, (next_creditor, asset_id)) in hop_keys.iter().enumerate() {
        let asset_id = *asset_id;
        if i == 0 {
            hops.push(PathHop {
                account: next_creditor.clone(),
                asset_id,
                amount: forward,
                hop_fee: 0,
                fx_fee: 0,
                fx_from_asset: None,
            });
            prev_edge_debtor = path_debtor;
            path_debtor = next_creditor.clone();
            prev_asset = asset_id;
            continue;
        }

        let mut fx_fee = 0u64;
        let mut fx_from_asset = None;
        if asset_id != prev_asset {
            let e = fx.iter().find(|e| {
                e.debtor == prev_edge_debtor
                    && e.from_asset == prev_asset
                    && e.to_asset == asset_id
                    && policy_live(e.expires_at, now)
                    && e.fx_rate > 0
            })?;
            fx_fee = e.fee_fixed;
            fx_from_asset = Some(prev_asset);
            forward = apply_rate(forward, e.fee_fixed, e.fx_rate)?;
        }

        let rpol = resolve_routing(routing, next_creditor, &path_debtor, asset_id, now)?;
        let before_fee = forward;
        forward = apply_hop_fee(forward, rpol.hop_fee_fixed, rpol.hop_fee_percent_ppm)?;
        let hop_fee = before_fee.saturating_sub(forward);

        hops.push(PathHop {
            account: next_creditor.clone(),
            asset_id,
            amount: forward,
            hop_fee,
            fx_fee,
            fx_from_asset,
        });
        prev_edge_debtor = path_debtor;
        path_debtor = next_creditor.clone();
        prev_asset = asset_id;
    }

    Some(hops)
}

/// Find a path that delivers at least `amount_out` to the payee, minimizing
/// `amount_in` (sender absorbs hop/FX fees).
///
/// Important: we must **not** probe the full first-hop residual first. A large
/// `amount_in` often exceeds intermediate residuals and makes the exact-in
/// searcher return `None` even when a smaller send works (the exact-in UX
/// case). Expand upward from a small probe, then binary-search the minimum
/// send that still clears `amount_out`.
pub fn find_banx_path_exact_out(
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
    if amount_out == 0 || max_hops == 0 || sender == payee {
        return None;
    }

    let max_in = lines
        .iter()
        .filter(|l| l.debtor == sender && l.asset_id == from_asset && l.residual > 0)
        .map(|l| l.residual)
        .max()
        .unwrap_or(0);
    if max_in == 0 {
        return None;
    }

    let try_in = |amount_in: u64| {
        find_banx_path(
            lines,
            routing,
            fx,
            sender,
            payee,
            amount_in,
            from_asset,
            to_asset,
            max_hops,
            now,
        )
    };

    // Phase 1: find some amount_in that clears `amount_out`.
    //
    // Do not probe max first-hop residual first — large notions often exceed
    // intermediate residuals and look like "no path". Grow from small values.
    //
    // Feasibility is not fully monotonic (fixed hop fees reject tiny notions;
    // residual caps reject huge ones), so when doubling jumps over residual
    // capacity we binary-search the gap for the largest still-feasible send.
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
                    // Doubling jumped past residual capacity. Search (ok, probe)
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
    debtor: &str,
    state_asset: u16,
    hop_asset: u16,
    amount_in: u64,
    lines_by_debtor: &HashMap<&str, Vec<&LineEdge>>,
    routing: &[RoutingEdge],
    now: i64,
    visited: &HashSet<String>,
    sender: &str,
    candidates: &mut HashMap<StateKey, (u64, Pred, HashSet<String>)>,
) {
    let Some(out_lines) = lines_by_debtor.get(debtor) else {
        return;
    };
    for line in out_lines {
        if line.asset_id != hop_asset {
            continue;
        }
        if line.creditor == debtor || line.creditor == sender {
            continue;
        }
        if visited.contains(&line.creditor) {
            continue;
        }
        let Some(rpol) = resolve_routing(routing, &line.creditor, debtor, hop_asset, now) else {
            continue;
        };
        if line.interest_rate_ppm > rpol.max_accept_rate_ppm {
            continue;
        }
        let Some(draw) = apply_hop_fee(amount_in, rpol.hop_fee_fixed, rpol.hop_fee_percent_ppm)
        else {
            continue;
        };
        if draw > line.residual {
            continue;
        }

        let key = (line.creditor.clone(), hop_asset);
        let better = candidates
            .get(&key)
            .map_or(true, |(b, _, _)| draw > *b);
        if !better {
            continue;
        }
        let mut next_visited = visited.clone();
        next_visited.insert(line.creditor.clone());
        candidates.insert(
            key,
            (
                draw,
                Pred {
                    prev_account: debtor.to_string(),
                    prev_asset: state_asset,
                    hop_account: line.creditor.clone(),
                    hop_asset,
                },
                next_visited,
            ),
        );
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn line(c: &str, d: &str, asset: u16, residual: u64) -> LineEdge {
        LineEdge {
            creditor: c.into(),
            debtor: d.into(),
            asset_id: asset,
            residual,
            interest_rate_ppm: 0,
        }
    }

    fn global_rte(debtor: &str, asset: u16, fee_pct_ppm: u32) -> RoutingEdge {
        RoutingEdge {
            creditor: String::new(),
            debtor: debtor.into(),
            asset_id: asset,
            hop_fee_fixed: 0,
            hop_fee_percent_ppm: fee_pct_ppm,
            max_accept_rate_ppm: PPM_SCALE,
            expires_at: 0,
        }
    }

    #[test]
    fn direct_line() {
        let lines = vec![line("bob", "alice", 1, 1_000_000)];
        let q = find_banx_path(
            &lines,
            &[],
            &[],
            "alice",
            "bob",
            100,
            1,
            Some(1),
            4,
            0,
        )
        .expect("path");
        assert_eq!(q.hops.len(), 1);
        assert_eq!(q.hops[0].account, "bob");
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
        let q = find_banx_path(
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
        assert_eq!(q.hops[0].account, "gary");
        assert_eq!(q.hops[1].account, "steve");
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
    fn exact_in_still_works_with_tight_mid_residual() {
        // Exact-in must keep working when first-hop residual is huge but mid is tight
        // (the case that previously broke exact-out when it probed max_in).
        let lines = vec![
            line("gary", "alice", 1, 1_000_000),
            line("steve", "gary", 1, 20_000),
        ];
        let routing = vec![global_rte("gary", 1, PPM_SCALE * 5 / 100)];
        let q = find_banx_path(
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

    #[test]
    fn exact_out_absorbs_hop_fee() {
        // alice → gary → steve, 5% fee: to deliver 9500, need send 10000
        let lines = vec![
            line("gary", "alice", 1, 1_000_000),
            line("steve", "gary", 1, 1_000_000),
        ];
        let routing = vec![global_rte("gary", 1, PPM_SCALE * 5 / 100)];
        let q = find_banx_path_exact_out(
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
    fn exact_out_when_first_hop_residual_far_exceeds_mid_path() {
        // Old bug: probing max first-hop residual (1e6) required a mid-hop draw
        // larger than gary→steve residual, so exact-out returned None even though
        // a modest send works (exact-in of 10_000 succeeds).
        let lines = vec![
            line("gary", "alice", 1, 1_000_000),
            line("steve", "gary", 1, 20_000),
        ];
        let routing = vec![global_rte("gary", 1, PPM_SCALE * 5 / 100)];
        let q = find_banx_path_exact_out(
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
        .expect("path despite huge first-hop residual");
        assert_eq!(q.amount_in, 10_000);
        assert!(q.amount_out >= 9_500);
    }

    #[test]
    fn exact_out_doubling_gap_near_residual_cap() {
        // mid residual 20_000 @ 5% ⇒ max send ~21_052. Desired out 19_000 needs
        // send ≈ 20_000. Doubling 16384 → 32768 jumps over the feasible window.
        let lines = vec![
            line("gary", "alice", 1, 1_000_000),
            line("steve", "gary", 1, 20_000),
        ];
        let routing = vec![global_rte("gary", 1, PPM_SCALE * 5 / 100)];
        let q = find_banx_path_exact_out(
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
        .expect("gap search finds send inside residual window");
        assert!(q.amount_out >= 19_000);
        // 19000 / 0.95 = 20000 exactly
        assert_eq!(q.amount_in, 20_000);
    }

    #[test]
    fn exact_out_direct_line_no_fee() {
        let lines = vec![line("bob", "alice", 1, 1_000_000)];
        let q = find_banx_path_exact_out(
            &lines, &[], &[], "alice", "bob", 100, 1, Some(1), 4, 0,
        )
        .expect("path");
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
            creditor: String::new(),
            debtor: "gary".into(),
            asset_id: 1,
            hop_fee_fixed: 10,
            hop_fee_percent_ppm: 0,
            max_accept_rate_ppm: PPM_SCALE,
            expires_at: 0,
        }];
        let q = find_banx_path_exact_out(
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
        // Mirror service test shape (simplified):
        // zac → mitchell (AUD) → john (AUD, 5% fee) → mike (USD after mitchell FX) → brandon
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
        // mitchell converts AUD→USD at 0.65 when path switches to USD at john→mike
        // Actually convert is on prev_edge_debtor when asset changes.
        // Hop sequence: mitchell(AUD), john(AUD), mike(USD), brandon(USD)
        // Asset change at mike hop: prev_edge_debtor=john, so john needs FX?
        // Looking at service again: convert uses prev_edge_debtor.
        // After john hop: prev_edge_debtor=mitchell, prev_asset=AUD
        // Wait after hop john: path_debtor=john, prev_edge_debtor=mitchell
        // Hop mike USD: convert mitchell AUD→USD, then john routes to mike.
        // So FX is on mitchell not john!
        //
        // After hop0 mitchell: prev_edge_debtor=zac
        // After hop john: prev_edge_debtor=mitchell
        // Hop mike USD: convert mitchell's policy AUD→USD
        let fx = vec![FxEdge {
            debtor: "mitchell".into(),
            from_asset: aud,
            to_asset: usd,
            fee_fixed: 0,
            fx_rate: RATE_SCALE * 65 / 100,
            expires_at: 0,
        }];

        let q = find_banx_path(
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
                .map(|h| h.account.as_str())
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
        assert!(find_banx_path(&lines, &[], &[], "alice", "bob", 100, 1, None, 2, 0).is_none());
    }
}
