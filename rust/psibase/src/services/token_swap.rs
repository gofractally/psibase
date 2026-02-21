#![allow(non_snake_case)]

use std::collections::HashMap;

use crate::services::tokens::{Quantity, TID};
use crate::AccountNumber;

pub type SID = AccountNumber;

pub const PPM: u32 = 1_000_000;

pub fn mul_div(a: Quantity, b: Quantity, c: Quantity) -> Quantity {
    let res = (a.value as u128 * b.value as u128) / (c.value as u128);
    (res as u64).into()
}

pub fn swap(
    incoming_amount: Quantity,
    incoming_reserve: Quantity,
    outgoing_reserve: Quantity,
    fee_ppm: u32,
) -> Quantity {
    let incoming_amount = incoming_amount.value as u128;
    let incoming_reserve = incoming_reserve.value as u128;
    let outgoing_reserve = outgoing_reserve.value as u128;

    if incoming_amount == 0 || incoming_reserve == 0 || outgoing_reserve == 0 {
        return 0.into();
    }

    let incoming_after_fee = ((PPM - fee_ppm) as u128) * incoming_amount / PPM as u128;

    if incoming_after_fee == 0 {
        return 0.into();
    }

    let numerator = outgoing_reserve
        .checked_mul(incoming_after_fee)
        .expect("numerator overflow");

    let denominator = incoming_reserve
        .checked_add(incoming_after_fee)
        .expect("denominator overflow");

    let amount_out = numerator / denominator;

    (amount_out as u64).into()
}

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

fn deviation_from_ideal_ppm(ideal_out: Quantity, actual_out: Quantity) -> u32 {
    if ideal_out.value == 0 {
        return PPM;
    }
    if actual_out >= ideal_out {
        return 0;
    }
    let loss = ideal_out.value.saturating_sub(actual_out.value);
    let ppm = ((loss as u128) * PPM as u128) / (ideal_out.value as u128);
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
    let mut best: HashMap<TID, Quantity> = HashMap::new();
    best.insert(from, amount);
    let mut pred: HashMap<TID, (TID, usize)> = HashMap::new();

    for _ in 0..max_hops {
        let mut candidates: HashMap<TID, (Quantity, (TID, usize))> = HashMap::new();
        for (i, pool) in all_pools.iter().enumerate() {
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
                        .map_or(true, |(b, _)| actual > *b)
                {
                    candidates.insert(pool.token_b, (actual, (pool.token_a, i)));
                }
            }
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
                        .map_or(true, |(b, _)| actual > *b)
                {
                    candidates.insert(pool.token_a, (actual, (pool.token_b, i)));
                }
            }
        }
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

#[crate::service(name = "token-swap", dispatch = false, psibase_mod = "crate")]
#[allow(unused_variables)]
pub mod Service {
    use crate::services::nft::NID;
    use crate::services::tokens::Quantity;
    use crate::services::tokens::TID;

    #[action]
    fn init() {
        unimplemented!()
    }

    /// Creates a new pool.
    ///
    /// Requires two token deposits of equal market value as the new pool reserves.
    /// Mints and credits to the sender administration NFT of pool to set pool fees.
    ///
    /// # Arguments
    /// * `token_a` - Token ID of the first deposit.
    /// * `token_b` - Token ID of the second deposit.
    /// * `token_a_amount` - Amount of the first deposit.
    /// * `token_b_amount` - Amount of the second deposit.
    /// * `nft_id`  - Optional administration NFT ID for the pool. If not provided, a new NFT is minted and credited to the sender.
    ///
    /// # Returns
    /// (TID of Liquidity token / Pool ID, Administration NFT ID of pool)
    #[action]
    fn new_pool(
        token_a: TID,
        token_b: TID,
        token_a_amount: Quantity,
        token_b_amount: Quantity,
        nft_id: Option<NID>,
    ) -> (u32, NID) {
        unimplemented!()
    }

    /// Set the administration NFT ID for an existing pool.
    ///
    /// Only the current owner of the existing administration NFT is allowed to change it.
    ///
    /// # Arguments
    /// * `pool_id` - Liquidity token ID that identifies the pool
    /// * `nft_id`  - New administration NFT ID for the pool
    #[action]
    fn set_admin_nft(pool_id: TID, nft_id: NID) {
        unimplemented!()
    }

    /// Updates the swap fee for one of the tokens in an existing pool.
    ///
    /// Only the current owner of the administration NFT for the pool
    /// is allowed to change the fee. The fee is set in parts per million (ppm).
    /// Maximum allowed value is 999_999 (≈99.9999%).
    ///
    /// # Arguments
    /// * `pool_id`  - Liquidity token ID that identifies the pool
    /// * `token_id`    - Token ID whose fee should be updated (must be one of the two tokens in the pool)
    /// * `ppm`      - New fee rate in parts per million (e.g. 3000 = 0.3%)
    #[action]
    fn set_fee(pool_id: TID, token_id: TID, ppm: u32) {
        unimplemented!()
    }

    /// Queries the current reserve balance of one token in the specified pool.
    ///
    /// # Arguments
    /// * `pool_id`    - Liquidity token ID that identifies the pool
    /// * `token_id`   - Token ID whose reserve balance should be returned
    ///
    /// # Returns
    /// The current balance held in the pool's reserve sub-account for the given token
    #[action]
    fn get_reserve(pool_id: TID, token_id: TID) -> Quantity {
        unimplemented!()
    }

    /// Adds liquidity to an existing pool.
    ///
    /// The caller specifies desired maximum amounts for both tokens.
    /// The function automatically calculates the optimal amounts to deposit
    /// (respecting the current pool ratio) and mints the corresponding amount
    /// of liquidity tokens to the caller.
    ///
    /// # Arguments
    /// * `pool_id`    - Liquidity token ID that identifies the pool
    /// * `token_a` -   Token A ID.
    /// * `token_b` -   Token B ID.
    /// * `amount_a`   - Maximum amount of token A the caller wishes to add
    /// * `amount_b`   - Maximum amount of token B the caller wishes to add
    #[action]
    fn add_liquidity(
        pool_id: TID,
        token_a: TID,
        token_b: TID,
        amount_a: Quantity,
        amount_b: Quantity,
    ) {
        unimplemented!()
    }

    /// Removes liquidity from a pool and returns the proportional share of both tokens.
    ///
    /// Burns the specified amount of liquidity tokens from the caller's account
    /// and credits the corresponding amounts of the underlying tokens.
    ///
    /// # Arguments
    /// * `pool_id`    - Liquidity token ID that identifies the pool
    /// * `lp_amount`  - Amount of liquidity tokens to redeem / burn
    #[action]
    fn remove_liquidity(pool_id: TID, lp_amount: Quantity) {
        unimplemented!()
    }

    /// Executes a token swap, potentially through multiple pools (multi-hop).
    ///
    /// The input tokens are debited from the caller, routed through the given sequence
    /// of pools, and the final output token is credited back to the caller.
    /// Includes basic slippage protection via the `min_return` parameter.
    ///
    /// # Arguments
    /// * `pools`       - Ordered list of pool IDs (liquidity token IDs) defining the swap route
    /// * `token_in`    - Token ID being sent by the caller
    /// * `amount_in`   - Exact input amount to swap
    /// * `min_return`  - Minimum acceptable output amount (reverts if result is lower)
    #[action]
    fn swap(pools: Vec<TID>, token_in: TID, amount_in: Quantity, min_return: Quantity) {
        unimplemented!()
    }
}

#[cfg(test)]
mod path_tests {
    use super::*;

    fn pool(
        id: u32,
        token_a: u32,
        token_b: u32,
        reserve_a: u64,
        reserve_b: u64,
        fee_ppm: u32,
    ) -> GraphPool {
        GraphPool {
            id,
            token_a,
            token_b,
            reserve_a: Quantity::from(reserve_a),
            reserve_b: Quantity::from(reserve_b),
            token_a_fee_ppm: fee_ppm,
            token_b_fee_ppm: fee_ppm,
        }
    }

    /// Constant-product expected output
    /// amount_out = (reserve_out * amount_in_after_fee) / (reserve_in + amount_in_after_fee)
    fn expected_swap_out(amount_in: u64, reserve_in: u64, reserve_out: u64, fee_ppm: u32) -> u64 {
        let (amount_in, reserve_in, reserve_out) =
            (amount_in as u128, reserve_in as u128, reserve_out as u128);
        let after_fee = amount_in * (PPM - fee_ppm) as u128 / PPM as u128;
        if after_fee == 0 {
            return 0;
        }
        ((reserve_out * after_fee) / (reserve_in + after_fee)) as u64
    }

    /// Slippage in ppm vs spot price
    ///  * ideal = amount_in * reserve_out / reserve_in (no price movement)
    /// (ideal - actual) / ideal * PPM when actual < ideal.
    fn expected_slippage_ppm(
        amount_in: u64,
        reserve_in: u64,
        reserve_out: u64,
        fee_ppm: u32,
    ) -> u32 {
        let ideal = (amount_in as u128 * reserve_out as u128) / (reserve_in as u128);

        let actual = expected_swap_out(amount_in, reserve_in, reserve_out, fee_ppm) as u128;
        let loss = ideal - actual;
        let ppm = (loss * PPM as u128) / ideal;
        assert!(ppm <= PPM as u128, "slippage {} exceeds PPM {}", ppm, PPM);
        ppm as u32
    }

    // (Token A -> Token A) is invalid; Should result in empty path
    #[test]
    fn same_token() {
        let pools = vec![pool(0, 1, 2, 1_000_000, 1_000_000, 0)];
        let (path, _amt, _slippage, found) = find_path(pools, 1, Quantity::from(100), 1, 3);

        assert!(path.is_empty());
        assert!(!found);
    }

    // No pools given: no route exists; Should result in empty path
    #[test]
    fn no_pools() {
        let (path, _amt, _slippage, found) = find_path(vec![], 1, Quantity::from(100), 2, 3);

        assert!(path.is_empty());
        assert!(!found);
    }

    /// Pools exist but form no path from `from` to `to` (disconnected); Should result in empty path
    #[test]
    fn disconnected_pools() {
        let pools = vec![
            pool(0, 1, 2, 1_000_000, 1_000_000, 0),
            pool(1, 3, 4, 1_000_000, 1_000_000, 0),
        ];
        let (path, _amt, _slippage, found) = find_path(pools, 1, Quantity::from(100), 4, 3);
        assert!(path.is_empty());
        assert!(!found);
    }

    // 100 in, reserve_in=1M, reserve_out=2M, 0 fee => amount_out = (2M*100)/(1M+100) = 199.98 = 199 (integer div).
    #[test]
    fn test_cp() {
        assert_eq!(expected_swap_out(100, 1_000_000, 2_000_000, 0), 199);
    }

    /// Single pool A–B: one-hop path from A to B
    #[test]
    fn single_pool() {
        let pools = vec![pool(0, 1, 2, 1_000_000, 2_000_000, 0)];
        let amount = Quantity::from(100);
        let (path, best_out, _slippage, found) = find_path(pools.clone(), 1, amount, 2, 3);
        assert!(found);
        assert_eq!(path.len(), 1);
        assert_eq!(path[0].token_a, 1);
        assert_eq!(path[0].token_b, 2);
        assert_eq!(
            best_out.value,
            expected_swap_out(100, 1_000_000, 2_000_000, 0)
        );

        let (path, best_out, _slippage, found) = find_path(pools.clone(), 2, amount, 1, 3);
        assert!(found);
        assert_eq!(path.len(), 1);
        assert_eq!(
            best_out.value,
            expected_swap_out(100, 2_000_000, 1_000_000, 0)
        );
    }

    /// Two pools A–B and B–C
    #[test]
    fn two_hops() {
        let pools = vec![
            pool(0, 1, 2, 1_000_000, 1_000_000, 0),
            pool(1, 2, 3, 1_000_000, 1_000_000, 0),
        ];
        let amount = Quantity::from(100);
        let (path, best_out, _slippage, found) = find_path(pools.clone(), 1, amount, 3, 3);
        assert!(found);
        assert_eq!(path.len(), 2);
        assert_eq!(path[0].token_a, 1);
        assert_eq!(path[0].token_b, 2);
        assert_eq!(path[1].token_a, 2);
        assert_eq!(path[1].token_b, 3);
        let hop1 = expected_swap_out(100, 1_000_000, 1_000_000, 0);
        let expected = expected_swap_out(hop1, 1_000_000, 1_000_000, 0);
        assert_eq!(best_out.value, expected);
    }

    /// Path to C requires 2 hops; with max_hops=2 we find a path, with max_hops=1 we do not.
    #[test]
    fn max_hops() {
        let pools = vec![
            pool(0, 1, 2, 1_000_000, 1_000_000, 0),
            pool(1, 2, 3, 1_000_000, 1_000_000, 0),
        ];
        let amount = Quantity::from(100);
        let (_path, _out, _slippage, found) = find_path(pools.clone(), 1, amount, 3, 2);
        assert!(found);

        let (path, _out, _slippage, found) = find_path(pools, 1, amount, 3, 1);
        assert!(!found);
        assert!(path.is_empty());
    }

    /// Two routes between 1-3
    #[test]
    fn best_path_wins() {
        let pool_1_2 = pool(0, 1, 2, 1_000_000, 1_000_000, 3000);
        let pool_2_3 = pool(1, 2, 3, 1_000_000, 1_000_000, 0);
        let pool_1_4 = pool(2, 1, 4, 1_000_000, 10_000_000, 0);
        let pool_4_3 = pool(3, 4, 3, 10_000_000, 1_000_000, 0);
        let pools = vec![
            pool_1_2.clone(),
            pool_2_3.clone(),
            pool_1_4.clone(),
            pool_4_3.clone(),
        ];
        let amount = 100_000u64;

        let via_2_hop1 = expected_swap_out(
            amount,
            pool_1_2.reserve_a.value,
            pool_1_2.reserve_b.value,
            pool_1_2.token_a_fee_ppm,
        );
        let via_2 = expected_swap_out(
            via_2_hop1,
            pool_2_3.reserve_a.value,
            pool_2_3.reserve_b.value,
            pool_2_3.token_a_fee_ppm,
        );
        let via_4_hop1 = expected_swap_out(
            amount,
            pool_1_4.reserve_a.value,
            pool_1_4.reserve_b.value,
            pool_1_4.token_a_fee_ppm,
        );
        let via_4 = expected_swap_out(
            via_4_hop1,
            pool_4_3.reserve_a.value,
            pool_4_3.reserve_b.value,
            pool_4_3.token_a_fee_ppm,
        );
        let expected_best = via_2.max(via_4);
        let expected_path_ids: Vec<u32> = if via_4 > via_2 {
            vec![pool_1_4.id, pool_4_3.id]
        } else {
            vec![pool_1_2.id, pool_2_3.id]
        };

        let (path, best_out, _slippage, found) = find_path(pools, 1, Quantity::from(amount), 3, 3);
        assert!(found);
        assert_eq!(best_out.value, expected_best);
        assert_eq!(
            path.iter().map(|p| p.id).collect::<Vec<_>>(),
            expected_path_ids,
            "path should be the route that yields expected_best"
        );
    }

    /// Check slippage amounts
    #[test]
    fn fee_increases_slippage_ppm() {
        let reserve = 1_000_000u64;
        let amount = 100_000u64;
        let expected_no_fee = expected_slippage_ppm(amount, reserve, reserve, 0);
        let expected_with_fee = expected_slippage_ppm(amount, reserve, reserve, 30_000);

        let pools_no_fee = vec![pool(0, 1, 2, reserve, reserve, 0)];
        let pools_with_fee = vec![pool(0, 1, 2, reserve, reserve, 30_000)];
        let (_path, _out, slippage_no_fee, _) =
            find_path(pools_no_fee, 1, Quantity::from(amount), 2, 1);
        let (_path, _out, slippage_with_fee, _) =
            find_path(pools_with_fee, 1, Quantity::from(amount), 2, 1);

        assert_eq!(slippage_no_fee, expected_no_fee);
        assert_eq!(slippage_with_fee, expected_with_fee);
        assert!(slippage_with_fee > slippage_no_fee);
    }

    /// One large swap and two half-sized swaps yield the same total (theoretical and via find_path), within integer truncation.
    #[test]
    fn slippage() {
        let reserve = 100_000_000u64;
        let fee_ppm = 0u32;
        let amount = 1_000_000u64;
        let half = amount / 2;

        // Theoretical slippage amounts
        let one_swap = expected_swap_out(amount, reserve, reserve, fee_ppm);
        let out1 = expected_swap_out(half, reserve, reserve, fee_ppm);
        let out2 = expected_swap_out(half, reserve + half, reserve - out1, fee_ppm);
        let two_swaps = out1 + out2;
        assert!((one_swap as i64 - two_swaps as i64).abs() <= 1); // Allow for slight difference due to integer truncation

        // Using actual find_path logic
        let pools = vec![pool(0, 1, 2, reserve, reserve, fee_ppm)];
        let (_path, best_out, _, found) = find_path(pools.clone(), 1, Quantity::from(amount), 2, 1);
        assert!(found);
        let one_swap_actual = best_out.value;

        let (_path, out1_qty, _, found1) = find_path(pools.clone(), 1, Quantity::from(half), 2, 1);
        assert!(found1);
        let out1_actual = out1_qty.value;
        let pool_updated = pool(0, 1, 2, reserve + half, reserve - out1_actual, fee_ppm);
        let (_path, out2_qty, _, found2) =
            find_path(vec![pool_updated], 1, Quantity::from(half), 2, 1);
        assert!(found2);
        let out2_actual = out2_qty.value;
        let two_swaps_actual = out1_actual + out2_actual;

        assert!(
            (one_swap_actual as i64 - two_swaps_actual as i64).abs() <= 1,
            "find_path: one swap {} vs two half-swaps {}",
            one_swap_actual,
            two_swaps_actual
        );

        assert_eq!(one_swap, one_swap_actual);
        assert_eq!(two_swaps, two_swaps_actual);
    }
}

#[test]
fn verify_schema() {
    crate::assert_schema_matches_package::<Wrapper>();
}
