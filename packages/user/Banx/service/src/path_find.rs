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
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct PathQuote {
    pub hops: Vec<PathHop>,
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

/// `out = (in - fixed) * (PPM_SCALE - percent) / PPM_SCALE`.
pub fn apply_hop_fee(amount_in: u64, fee_fixed: u64, fee_percent_ppm: u32) -> Option<u64> {
    // Must be under 100% (same as on-chain: hop_fee_percent < PPM_SCALE).
    if fee_percent_ppm >= PPM_SCALE || fee_fixed >= amount_in {
        return None;
    }
    let after = amount_in - fee_fixed;
    let keep = (PPM_SCALE - fee_percent_ppm) as u128;
    let out = (after as u128)
        .checked_mul(keep)?
        .checked_div(PPM_SCALE as u128)?;
    let out = u64::try_from(out).ok()?;
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

    let mut hops = Vec::new();
    loop {
        let p = pred.get(&(cur_acct.clone(), cur_asset))?;
        hops.push(PathHop {
            account: p.hop_account.clone(),
            asset_id: p.hop_asset,
        });
        if p.prev_account.is_empty() {
            break;
        }
        cur_acct = p.prev_account.clone();
        cur_asset = p.prev_asset;
    }
    hops.reverse();
    if hops.is_empty() || hops.len() > max_hops as usize {
        return None;
    }
    // Last hop must be payee.
    if hops.last()?.account != payee {
        return None;
    }

    Some(PathQuote { hops, amount_out })
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
        // second hop: 10000 * 0.95 = 9500
        assert_eq!(q.amount_out, 9_500);
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
