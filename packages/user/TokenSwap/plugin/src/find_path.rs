use std::{
    cmp::Ordering,
    collections::{BinaryHeap, HashMap},
    str::FromStr,
};

use psibase::services::{
    token_swap::swap,
    tokens::{Decimal, Quantity, TID},
};

use crate::constants::PPM;
use crate::graphql::GraphQLPool;
use crate::{bindings::exports::token_swap::plugin::api::Pool as WitPool, mul_div};

#[derive(Clone)]
pub struct Pool {
    pub id: u32,
    pub token_a: u32,
    pub token_b: u32,
    pub reserve_a: Quantity,
    pub reserve_b: Quantity,
    pub token_a_tariff_ppm: u32,
    pub token_b_tariff_ppm: u32,
}

impl From<GraphQLPool> for Pool {
    fn from(value: GraphQLPool) -> Self {
        Self {
            id: value.id,
            reserve_a: value.a_balance.quantity,
            reserve_b: value.b_balance.quantity,
            token_a: value.token_a_id,
            token_b: value.token_b_id,
            token_a_tariff_ppm: value.token_a_tariff_ppm,
            token_b_tariff_ppm: value.token_b_tariff_ppm,
        }
    }
}

impl From<WitPool> for Pool {
    fn from(value: WitPool) -> Self {
        Self {
            id: value.id,
            reserve_a: Decimal::from_str(&value.a_balance).unwrap().quantity,
            reserve_b: Decimal::from_str(&value.b_balance).unwrap().quantity,
            token_a: value.token_a_id,
            token_b: value.token_b_id,
            token_a_tariff_ppm: value.token_a_tariff_ppm,
            token_b_tariff_ppm: value.token_b_tariff_ppm,
        }
    }
}

#[derive(Clone)]
struct SearchState {
    token: TID,
    amount_out: Quantity,
    path: Vec<Pool>,
    max_slippage_ppm: u32,
}

// Max-heap: highest amount_out first
impl Ord for SearchState {
    fn cmp(&self, other: &Self) -> Ordering {
        other.amount_out.cmp(&self.amount_out)
    }
}

impl PartialOrd for SearchState {
    fn partial_cmp(&self, other: &Self) -> Option<Ordering> {
        Some(self.cmp(other))
    }
}

impl PartialEq for SearchState {
    fn eq(&self, other: &Self) -> bool {
        self.amount_out == other.amount_out
    }
}

impl Eq for SearchState {}

/// Returns slippage (inc fee) in parts per million (out of 1_000_000)
fn deviation_from_ideal_ppm(ideal_out: Quantity, actual_out: Quantity) -> u32 {
    if ideal_out.value == 0 {
        return PPM; // complete loss
    }

    if actual_out >= ideal_out {
        return 0;
    }

    let loss = ideal_out - actual_out;

    // (loss / expected) * 1_000_000
    let ppm = ((loss.value as u128) * PPM as u128) / (ideal_out.value as u128);

    ppm.min(PPM as u128) as u32
}

pub fn find_path(
    all_pools: Vec<Pool>,
    from: TID,
    amount: Quantity,
    to: TID,
    max_hops: u8,
) -> (Vec<Pool>, Quantity, u32) {
    if from == to {
        return (vec![], amount, 0);
    }

    let mut graph: HashMap<TID, Vec<Pool>> = HashMap::new();

    for pool in all_pools {
        graph
            .entry(pool.token_a)
            .or_insert_with(Vec::new)
            .push(pool.clone());

        graph
            .entry(pool.token_b)
            .or_insert_with(Vec::new)
            .push(pool);
    }

    // Best known output amount reachable to each token
    let mut best_reachable: HashMap<TID, Quantity> = HashMap::new();
    best_reachable.insert(from, amount);

    // Priority queue: explore highest-output paths first
    let mut search_states: BinaryHeap<SearchState> = BinaryHeap::new();
    search_states.push(SearchState {
        token: from,
        amount_out: amount,
        path: vec![],
        max_slippage_ppm: 0,
    });

    // Track best way found to reach target
    let mut best_to_target = Quantity::from(0u64);
    let mut best_path_to_target: Vec<Pool> = vec![];
    let mut best_max_slippage_ppm: u32 = 0;

    // Start from the beginning token, search state is just of
    //
    while let Some(search_state) = search_states.pop() {
        // Respect max hops limit
        if search_state.path.len() as u8 > max_hops {
            continue;
        }

        // Found target → update if better
        if search_state.token == to {
            if search_state.amount_out > best_to_target {
                best_to_target = search_state.amount_out;
                best_path_to_target = search_state.path.clone();
                best_max_slippage_ppm = search_state.max_slippage_ppm;
            }
            continue; // no need to explore further from target
        }

        // Skip if we already have a strictly better way to this token
        if let Some(&recorded) = best_reachable.get(&search_state.token) {
            if search_state.amount_out < recorded {
                continue;
            }
        }

        // Try every pool connected to current token
        if let Some(connected_pools) = graph.get(&search_state.token) {
            for pool in connected_pools {
                // Determine next token + correct fee/reserves direction
                let (input_token, output_token) = if pool.token_a == search_state.token {
                    (pool.token_a, pool.token_b)
                } else if pool.token_b == search_state.token {
                    (pool.token_b, pool.token_a)
                } else {
                    continue;
                };

                let (reserve_in, reserve_out) = if input_token == pool.token_a {
                    (pool.reserve_a, pool.reserve_b)
                } else {
                    (pool.reserve_b, pool.reserve_a)
                };

                let tariff_ppm = if input_token == pool.token_a {
                    pool.token_a_tariff_ppm
                } else {
                    pool.token_b_tariff_ppm
                };

                let perfect_amount = mul_div(search_state.amount_out, reserve_out, reserve_in);
                let actual_amount =
                    swap(search_state.amount_out, reserve_in, reserve_out, tariff_ppm);

                // Skip useless swaps
                if actual_amount.value == 0 {
                    continue;
                }

                let this_hop_slippage_ppm = deviation_from_ideal_ppm(perfect_amount, actual_amount);

                // Only continue if this improves the known best for the next token
                let is_new_best_amount_found = best_reachable
                    .get(&output_token)
                    .map_or(true, |&prev| actual_amount > prev);

                if is_new_best_amount_found {
                    best_reachable.insert(output_token, actual_amount);

                    let mut new_path = search_state.path.clone();
                    new_path.push(pool.clone());

                    search_states.push(SearchState {
                        token: output_token,
                        amount_out: actual_amount,
                        path: new_path,
                        max_slippage_ppm: search_state.max_slippage_ppm.max(this_hop_slippage_ppm),
                    });
                }
            }
        }
    }

    (best_path_to_target, best_to_target, best_max_slippage_ppm)
}
