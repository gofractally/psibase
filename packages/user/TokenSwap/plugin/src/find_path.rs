use std::{
    cmp::Ordering,
    collections::{BinaryHeap, HashMap},
};

use psibase::services::{
    token_swap::swap,
    tokens::{Quantity, TID},
};

#[derive(Clone)]
pub struct Pool {
    id: u32,
    token_a: u32,
    token_b: u32,
    reserve_a: Quantity,
    reserve_b: Quantity,
    token_a_tariff_ppm: u32,
    token_b_tariff_ppm: u32,
}

#[derive(Clone)]
struct SearchState {
    token: TID,
    amount_out: Quantity,
    path: Vec<Pool>,
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

pub fn find_path(
    all_pools: Vec<Pool>,
    from: TID,
    amount: Quantity,
    to: TID,
    max_hops: u8,
) -> (Vec<Pool>, Quantity) {
    if from == to {
        return (vec![], amount);
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
    let mut best_amount_found_dictionary: HashMap<TID, Quantity> = HashMap::new();
    best_amount_found_dictionary.insert(from, amount);

    // Priority queue: explore highest-output paths first
    let mut search_states: BinaryHeap<SearchState> = BinaryHeap::new();
    search_states.push(SearchState {
        token: from,
        amount_out: amount,
        path: vec![],
    });

    // Track best way found to reach target
    let mut best_to_target = Quantity::from(0u64);
    let mut best_path_to_target: Vec<Pool> = vec![];

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
            }
            continue; // no need to explore further from target
        }

        // Skip if we already have a strictly better way to this token
        if let Some(&recorded) = best_amount_found_dictionary.get(&search_state.token) {
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

                let next_amount = swap(
                    search_state.amount_out,
                    if input_token == pool.token_a {
                        pool.reserve_a
                    } else {
                        pool.reserve_b
                    },
                    if output_token == pool.token_b {
                        pool.reserve_b
                    } else {
                        pool.reserve_a
                    },
                    if input_token == pool.token_a {
                        pool.token_a_tariff_ppm
                    } else {
                        pool.token_b_tariff_ppm
                    },
                );

                // Skip useless swaps
                if next_amount.value == 0 {
                    continue;
                }

                // Only continue if this improves the known best for the next token
                let is_new_best_amount_found = best_amount_found_dictionary
                    .get(&output_token)
                    .map_or(true, |&prev| next_amount > prev);

                if is_new_best_amount_found {
                    best_amount_found_dictionary.insert(output_token, next_amount);

                    let mut new_path = search_state.path.clone();
                    new_path.push(pool.clone());

                    search_states.push(SearchState {
                        token: output_token,
                        amount_out: next_amount,
                        path: new_path,
                    });
                }
            }
        }
    }

    (best_path_to_target, best_to_target)
}
