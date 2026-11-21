//! Exact integer arithmetic and deterministic, private, backwards route search.
//! Deliberately independent of psibase so it can also be tested with rustc --test.
use std::{cmp::Reverse, collections::BinaryHeap};

pub const SCALE: u64 = 100_000_000;
pub const MAX_AMOUNT: u64 = 9_000_000_000_000_000;
pub const MAX_HOPS: usize = 7;
pub const MAX_SEARCH: usize = 50_000;
pub const MAX_EDGES: usize = 20_000;
pub const PPM: u64 = 1_000_000;

pub fn units(value: &str) -> Result<u64, &'static str> {
    let (whole, fraction) = value.split_once('.').unwrap_or((value, ""));
    if whole.is_empty()
        || !whole.bytes().all(|b| b.is_ascii_digit())
        || !fraction.bytes().all(|b| b.is_ascii_digit())
        || fraction.len() > 8
        || value.len() > 32
        || (value.contains('.') && fraction.is_empty())
    {
        return Err("Use a nonnegative amount with at most 8 decimal places");
    }
    let whole: u64 = whole.parse().map_err(|_| "Amount too large")?;
    let fraction: u64 = if fraction.is_empty() {
        0
    } else {
        fraction.parse().unwrap()
    };
    let result = whole
        .checked_mul(SCALE)
        .and_then(|x| {
            x.checked_add(
                fraction * 10_u64.pow(8 - value.split_once('.').map_or(0, |(_, f)| f.len()) as u32),
            )
        })
        .ok_or("Amount too large")?;
    if result > MAX_AMOUNT {
        return Err("Amount too large");
    }
    Ok(result)
}

pub fn decimal(value: u64) -> String {
    let whole = value / SCALE;
    let fraction = value % SCALE;
    if fraction == 0 {
        whole.to_string()
    } else {
        format!("{}.{:08}", whole, fraction)
            .trim_end_matches('0')
            .to_string()
    }
}

pub fn symbol(value: &str) -> Result<(), &'static str> {
    if !(2..=12).contains(&value.len()) || !value.bytes().all(|b| b.is_ascii_uppercase()) {
        return Err("Use a symbol of 2–12 uppercase letters, such as USD or BTC");
    }
    Ok(())
}

#[derive(Clone, Debug)]
pub struct Edge {
    pub from: u64,
    pub to: u64,
    pub capacity: u64,
    /// Fee retained by `from` when it forwards a payment along this edge.
    pub fee_ppm: u32,
    pub forwarding: bool,
}

#[derive(Debug, PartialEq, Eq)]
pub struct Route {
    pub total: u64,
    /// Edge indexes and actual transfer amounts, ordered from payer to payee.
    pub transfers: Vec<(usize, u64)>,
}

pub fn find_route(
    edges: &[Edge],
    payer: u64,
    payee: u64,
    amount: u64,
) -> Result<Route, &'static str> {
    search(edges, payer, payee, amount, MAX_SEARCH)
}

fn search(
    edges: &[Edge],
    payer: u64,
    payee: u64,
    amount: u64,
    budget: usize,
) -> Result<Route, &'static str> {
    if edges.len() > MAX_EDGES {
        return Err("Network is too large for this routing budget");
    }
    let mut incoming = std::collections::BTreeMap::<u64, Vec<(usize, Edge)>>::new();
    for (i, edge) in edges.iter().enumerate() {
        incoming.entry(edge.to).or_default().push((i, edge.clone()));
    }
    search_with(payer, payee, amount, budget, |node| {
        Ok(incoming.remove(&node).unwrap_or_default())
    })
}

/// Query adapters fetch only the incoming neighbors of expanded nodes. The
/// global network can grow without requiring a full graph scan for each quote.
pub fn find_route_with(
    payer: u64,
    payee: u64,
    amount: u64,
    fetch: impl FnMut(u64) -> Result<Vec<(usize, Edge)>, &'static str>,
) -> Result<Route, &'static str> {
    search_with(payer, payee, amount, MAX_SEARCH, fetch)
}
fn search_with(
    payer: u64,
    payee: u64,
    amount: u64,
    budget: usize,
    mut fetch: impl FnMut(u64) -> Result<Vec<(usize, Edge)>, &'static str>,
) -> Result<Route, &'static str> {
    if payer == payee {
        return Err("Choose someone other than yourself");
    }
    if amount == 0 || amount > MAX_AMOUNT {
        return Err("Payment amount must be positive and within range");
    }
    let mut incoming = std::collections::BTreeMap::<u64, Vec<(usize, Edge)>>::new();
    let mut inspected = 0;
    // Each label keeps its visited set. Discarding labels solely by (node, hops)
    // can discard the optimal simple path when capacity and visited nodes differ.
    let mut pending = BinaryHeap::new();
    pending.push(Reverse((
        amount,
        0_usize,
        vec![payee],
        Vec::<(usize, u64)>::new(),
    )));
    let mut work = 0;
    while let Some(Reverse((required, hops, path, transfers))) = pending.pop() {
        work += 1;
        if work > budget {
            return Err(
                "Routing search limit reached; try a smaller payment or a direct relationship",
            );
        }
        let node = *path.last().unwrap();
        if node == payer {
            return Ok(Route {
                total: required,
                transfers: transfers.into_iter().rev().collect(),
            });
        }
        if hops == MAX_HOPS {
            continue;
        }
        if !incoming.contains_key(&node) {
            let neighbors = fetch(node)?;
            inspected += neighbors.len();
            if inspected > MAX_EDGES {
                return Err("Routing edge budget exceeded");
            }
            if neighbors
                .iter()
                .any(|(_, edge)| edge.to != node || edge.fee_ppm as u64 > PPM)
            {
                return Err("Invalid routing edge");
            }
            incoming.insert(node, neighbors);
        }
        for (i, edge) in &incoming[&node] {
            if required > edge.capacity
                || path.contains(&edge.from)
                || (edge.from != payer && !edge.forwarding)
            {
                continue;
            }
            let fee = if edge.from == payer {
                0
            } else {
                ((required as u128 * edge.fee_ppm as u128 + PPM as u128 - 1) / PPM as u128) as u64
            };
            let Some(total) = required.checked_add(fee).filter(|x| *x <= MAX_AMOUNT) else {
                continue;
            };
            let mut next_path = path.clone();
            next_path.push(edge.from);
            let mut next_transfers = transfers.clone();
            next_transfers.push((*i, required));
            // Bound both CPU and queue memory; never return an unproven optimum.
            if pending.len() >= budget {
                return Err("Routing search limit reached; try a direct relationship");
            }
            pending.push(Reverse((total, hops + 1, next_path, next_transfers)));
        }
    }
    Err("No credit path with enough capacity within 7 hops")
}

#[cfg(test)]
mod tests {
    use super::*;
    fn e(from: u64, to: u64, capacity: u64, fee: u32) -> Edge {
        Edge {
            from,
            to,
            capacity,
            fee_ppm: fee,
            forwarding: true,
        }
    }
    #[test]
    fn lazy_search_avoids_unrelated_components() {
        let edges = [e(1, 2, 100, 0), e(2, 3, 100, 0), e(99, 100, 100, 0)];
        let mut calls = vec![];
        let route = find_route_with(1, 3, 20, |node| {
            calls.push(node);
            Ok(edges
                .iter()
                .enumerate()
                .filter(|(_, e)| e.to == node)
                .map(|(i, e)| (i, e.clone()))
                .collect())
        })
        .unwrap();
        assert_eq!(route.total, 20);
        assert_eq!(calls, vec![3, 2]);
    }
    #[test]
    fn exact_amounts() {
        for s in ["0", "1", "0.00000001", "123.4567", "90000000"] {
            assert_eq!(units(&decimal(units(s).unwrap())), units(s));
        }
        for s in [
            "-1",
            "NaN",
            "1e3",
            "1.000000001",
            " 1",
            "1.",
            ".1",
            "1..2",
            "90000000.00000001",
            "999999999999999999999999",
        ] {
            assert!(units(s).is_err(), "{s}");
        }
    }
    #[test]
    fn direct_has_no_fee() {
        assert_eq!(
            find_route(&[e(1, 2, 100, 999999)], 1, 2, 5).unwrap().total,
            5
        );
    }
    #[test]
    fn favors_cheapest_total_not_fewest_hops() {
        let edges = [
            e(1, 2, 1000, 0),
            e(2, 4, 1000, 100000),
            e(1, 3, 1000, 0),
            e(3, 5, 1000, 10000),
            e(5, 4, 1000, 10000),
        ];
        let route = find_route(&edges, 1, 4, 100).unwrap();
        assert_eq!(route.total, 103); // 100 -> 101 -> 103, fees round up.
        assert_eq!(route.transfers, vec![(2, 103), (3, 101), (4, 100)]);
    }
    #[test]
    fn capacity_includes_upstream_fees() {
        assert!(find_route(&[e(1, 2, 100, 0), e(2, 3, 100, 10000)], 1, 3, 100).is_err());
    }
    #[test]
    fn seven_edges_allowed_eight_rejected() {
        let edges: Vec<_> = (1..=8).map(|i| e(i, i + 1, 100, 0)).collect();
        assert!(find_route(&edges, 1, 8, 100).is_ok());
        assert!(find_route(&edges, 1, 9, 100).is_err());
    }
    #[test]
    fn cycles_cannot_mint_fees() {
        let edges = [e(1, 2, 100, 0), e(2, 1, 100, 0), e(2, 3, 100, 0)];
        assert_eq!(find_route(&edges, 1, 3, 100).unwrap().transfers.len(), 2);
        assert!(find_route(&edges, 1, 1, 100).is_err());
    }
    #[test]
    fn forwarding_pause_still_allows_own_payments() {
        let mut edge = e(2, 3, 100, 0);
        edge.forwarding = false;
        assert!(find_route(&[e(1, 2, 100, 0), edge.clone()], 1, 3, 1).is_err());
        assert!(find_route(&[edge], 2, 3, 1).is_ok());
    }
    #[test]
    fn search_limit_fails_closed() {
        assert!(search(&[e(1, 2, 100, 0)], 1, 2, 1, 1)
            .unwrap_err()
            .contains("limit"));
    }
    #[test]
    fn lazy_search_propagates_database_failure_without_partial_route() {
        assert_eq!(
            find_route_with(1, 3, 1, |_| Err("database query budget exceeded")).unwrap_err(),
            "database query budget exceeded"
        );
    }
    #[test]
    fn lazy_search_bounds_adjacency_and_queue_memory() {
        let many: Vec<_> = (0..=MAX_EDGES)
            .map(|i| (i, e(i as u64 + 10, 2, 100, 0)))
            .collect();
        assert_eq!(
            find_route_with(1, 2, 1, |_| Ok(many.clone())).unwrap_err(),
            "Routing edge budget exceeded"
        );
        let many: Vec<_> = (0..3).map(|i| e(i + 10, 2, 100, 0)).collect();
        assert!(search(&many, 1, 2, 1, 2).unwrap_err().contains("limit"));
        assert!(find_route(&vec![e(1, 2, 100, 0); MAX_EDGES + 1], 1, 2, 1)
            .unwrap_err()
            .contains("budget"));
    }
    #[test]
    fn lazy_search_rejects_misdirected_or_invalid_fee_edges() {
        for edge in [e(1, 99, 100, 0), e(1, 2, 100, 1_000_001)] {
            assert_eq!(
                find_route_with(1, 2, 1, |_| Ok(vec![(0, edge.clone())])).unwrap_err(),
                "Invalid routing edge"
            );
        }
    }
    #[test]
    fn only_valid_symbols() {
        for s in ["USD", "BTC", "FAVORS"] {
            assert!(symbol(s).is_ok());
        }
        for s in ["usd", "US D", "U", "BTC/USD", ""] {
            assert!(symbol(s).is_err());
        }
    }
    // Compare the priority search against independent exhaustive simple-path
    // enumeration on deterministic random graphs, including rounding/capacity.
    #[test]
    fn agrees_with_exhaustive_reference() {
        fn walk(
            es: &[Edge],
            at: u64,
            dest: u64,
            amount: u64,
            seen: &mut Vec<u64>,
            path: &mut Vec<usize>,
            best: &mut Option<u64>,
        ) {
            if at == dest {
                let mut required = amount;
                for (position, &i) in path.iter().enumerate().rev() {
                    if required > es[i].capacity {
                        return;
                    }
                    if position > 0 {
                        required += (required * es[i].fee_ppm as u64 + PPM - 1) / PPM;
                    }
                }
                *best = Some(best.unwrap_or(u64::MAX).min(required));
                return;
            }
            if path.len() == MAX_HOPS {
                return;
            }
            for (i, edge) in es.iter().enumerate().filter(|(_, e)| e.from == at) {
                if seen.contains(&edge.to) || (!path.is_empty() && !edge.forwarding) {
                    continue;
                }
                seen.push(edge.to);
                path.push(i);
                walk(es, edge.to, dest, amount, seen, path, best);
                path.pop();
                seen.pop();
            }
        }
        let mut seed = 42_u64;
        for _ in 0..500 {
            let mut edges = Vec::new();
            for a in 1..=6 {
                for b in 1..=6 {
                    if a == b {
                        continue;
                    }
                    seed = seed.wrapping_mul(6364136223846793005).wrapping_add(1);
                    if seed % 3 == 0 {
                        edges.push(e(a, b, 5 + seed % 200, (seed % 100000) as u32));
                    }
                }
            }
            let mut best = None;
            walk(&edges, 1, 6, 20, &mut vec![1], &mut vec![], &mut best);
            assert_eq!(find_route(&edges, 1, 6, 20).ok().map(|r| r.total), best);
        }
    }
}
