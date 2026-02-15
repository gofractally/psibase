use std::{collections::HashMap, str::FromStr};

use psibase::services::{
    token_swap::swap,
    tokens::{Decimal, Quantity, TID},
};

use crate::bindings::exports::token_swap::plugin::liquidity::Pool as WitPool;
use crate::constants::PPM;
use crate::graphql::GraphQLPool;
use crate::mul_div;

#[derive(Clone, Debug)]
pub struct GraphPool {
    pub id: u32,
    pub token_a: u32,
    pub token_b: u32,
    pub reserve_a: Quantity,
    pub reserve_b: Quantity,
    pub token_a_fee_ppm: u32,
    pub token_b_fee_ppm: u32,
}

impl From<GraphQLPool> for GraphPool {
    fn from(value: GraphQLPool) -> Self {
        Self {
            id: value.liquidity_token,
            reserve_a: value.reserve_a.balance.quantity,
            reserve_b: value.reserve_b.balance.quantity,
            token_a: value.reserve_a.token_id,
            token_b: value.reserve_b.token_id,
            token_a_fee_ppm: value.reserve_a.fee_ppm,
            token_b_fee_ppm: value.reserve_b.fee_ppm,
        }
    }
}

impl From<WitPool> for GraphPool {
    fn from(value: WitPool) -> Self {
        Self {
            id: value.id,
            reserve_a: Decimal::from_str(&value.a_balance).unwrap().quantity,
            reserve_b: Decimal::from_str(&value.b_balance).unwrap().quantity,
            token_a: value.token_a_id,
            token_b: value.token_b_id,
            token_a_fee_ppm: value.token_a_fee_ppm,
            token_b_fee_ppm: value.token_b_fee_ppm,
        }
    }
}

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
    all_pools: Vec<GraphPool>,
    from: TID,
    amount: Quantity,
    to: TID,
    max_hops: u8,
) -> (Vec<GraphPool>, Quantity, u32, bool) {
    if from == to {
        return (vec![], amount, 0, false);
    }

    // Best reachable amount to each token
    let mut best: HashMap<TID, Quantity> = HashMap::new();
    best.insert(from, amount);

    // Predecessor map for path reconstruction: (previous token, pool index)
    let mut pred: HashMap<TID, (TID, usize)> = HashMap::new();

    for _ in 0..max_hops {
        // Candidates for updates in this iteration
        // Per pools
        let mut candidates: HashMap<TID, (Quantity, (TID, usize))> = HashMap::new();

        for (i, pool) in all_pools.iter().enumerate() {
            // Direction: token_a → token_b
            if let Some(&amount_in) = best.get(&pool.token_a) {
                let actual = swap(
                    amount_in,
                    pool.reserve_a,
                    pool.reserve_b,
                    pool.token_a_fee_ppm,
                );

                if actual.value > 0
                    && candidates
                        .get(&pool.token_b)
                        .map_or(true, |(best, _)| actual > *best)
                {
                    candidates.insert(pool.token_b, (actual, (pool.token_a, i)));
                }
            }

            // Direction: token_b → token_a
            if let Some(&amount_in) = best.get(&pool.token_b) {
                let actual = swap(
                    amount_in,
                    pool.reserve_b,
                    pool.reserve_a,
                    pool.token_b_fee_ppm,
                );

                if actual.value > 0
                    && candidates
                        .get(&pool.token_a)
                        .map_or(true, |(best, _)| actual > *best)
                {
                    candidates.insert(pool.token_a, (actual, (pool.token_b, i)));
                }
            }
        }

        // Apply updates if better
        let mut updated = false;
        for (target, (new_amount, predecessor)) in candidates {
            let old_amount = *best.get(&target).unwrap_or(&Quantity::from(0));
            if new_amount > old_amount {
                best.insert(target, new_amount);
                pred.insert(target, predecessor);
                updated = true;
            }
        }

        if !updated {
            break;
        }
    }

    if let Some(&best_to_target) = best.get(&to) {
        if best_to_target.value == 0 {
            return (vec![], Quantity::from(0), 0, false);
        }

        // Reconstruct the path
        let mut path_indices: Vec<usize> = vec![];
        let mut current = to;
        while current != from {
            let (prev, pool_index) = pred.get(&current).expect("broken predecessor chain");
            path_indices.push(*pool_index);
            current = *prev;
        }

        path_indices.reverse();

        let path: Vec<GraphPool> = path_indices
            .into_iter()
            .map(|i| all_pools[i].clone())
            .collect();

        // Compute max_slippage_ppm by simulating the path
        let mut max_slippage_ppm = 0u32;
        let mut current_amount = amount;
        let mut current_token = from;
        for pool in &path {
            let (reserve_in, reserve_out, fee_ppm) = if current_token == pool.token_a {
                (pool.reserve_a, pool.reserve_b, pool.token_a_fee_ppm)
            } else {
                (pool.reserve_b, pool.reserve_a, pool.token_b_fee_ppm)
            };
            let perfect_amount = mul_div(current_amount, reserve_out, reserve_in);
            let actual_amount = swap(current_amount, reserve_in, reserve_out, fee_ppm);
            let this_hop_slippage_ppm = deviation_from_ideal_ppm(perfect_amount, actual_amount);
            max_slippage_ppm = max_slippage_ppm.max(this_hop_slippage_ppm);
            current_amount = actual_amount;
            current_token = if current_token == pool.token_a {
                pool.token_b
            } else {
                pool.token_a
            };
        }

        (path, best_to_target, max_slippage_ppm, true)
    } else {
        (vec![], Quantity::from(0), 0, false)
    }
}
