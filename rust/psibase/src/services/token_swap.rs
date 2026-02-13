#![allow(non_snake_case)]

use crate::services::tokens::Quantity;
use crate::AccountNumber;

pub type SID = AccountNumber;

pub const PPM: u32 = 1_000_000;

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

    let incoming_after_fee = incoming_amount
        .checked_mul((PPM - fee_ppm) as u128)
        .and_then(|v| v.checked_div(PPM as u128))
        .unwrap_or(0);

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

#[crate::service(name = "token-swap", dispatch = false, psibase_mod = "crate")]
#[allow(unused_variables)]
pub mod Service {
    use crate::services::nft::NID;
    use crate::services::tokens::Quantity;
    use crate::services::tokens::TID;

    /// Creates a new pool.
    ///
    /// Requires two token deposits of equal value as the new pool reserves.
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

#[test]
fn verify_schema() {
    crate::assert_schema_matches_package::<Wrapper>();
}
