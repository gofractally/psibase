mod helpers;
pub mod tables;

#[psibase::service(name = "token-swap", tables = "tables::tables")]
pub mod service {
    use crate::tables::tables::{InitRow, Pool, Reserve};
    use psibase::services::events;
    use psibase::{
        services::{
            nft::NID,
            tokens::{Quantity, TID},
        },
        *,
    };

    use psibase::services::nft::{NftHolderFlags, Wrapper as Nft};
    use psibase::services::tokens::{BalanceFlags, Wrapper as Tokens};

    #[action]
    fn init() {
        if InitRow::get().is_none() {
            InitRow::init();

            Tokens::call().setUserConf(BalanceFlags::MANUAL_DEBIT.index(), true);
            Nft::call().setUserConf(NftHolderFlags::MANUAL_DEBIT.index(), true);
        };
        let add_index = |method: &str, columns: Vec<u8>| {
            for column in columns {
                events::Wrapper::call().addIndex(
                    DbId::HistoryEvent,
                    Wrapper::SERVICE,
                    MethodNumber::from(method),
                    column,
                );
            }
        };

        add_index("swapped", vec![0, 1, 3]);
        add_index("swap_completed", vec![0]);
        add_index("liq_added", vec![0, 1]);
        add_index("liq_removed", vec![0, 1]);
    }

    #[pre_action(exclude(init))]
    fn check_init() {
        check_some(InitRow::get(), "service not initialized");
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
        let pool = Pool::add(token_a, token_b, token_a_amount, token_b_amount, nft_id);
        (pool.liquidity_token, pool.admin_nft)
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
        Pool::get_assert(pool_id).set_admin_nft(nft_id);
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
        Pool::get_assert(pool_id).get_reserve(token_id).set_fee(ppm);
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
        Reserve::get_assert(pool_id, token_id).balance()
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
        Pool::get_assert(pool_id).add_liquidity(token_a, token_b, amount_a, amount_b);
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
        Pool::get_assert(pool_id).remove_liquidity(lp_amount);
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
        check(pools.len() > 0, "pools length must be at least 1");
        check(amount_in.value > 0, "amount in must be non-zero");
        check(min_return.value > 0, "min return must be non-zero");

        let sender = get_sender();
        let tokens_service = psibase::services::tokens::Wrapper::call();
        tokens_service.debit(token_in, sender, amount_in, "".into());

        let mut current_token = token_in;
        let mut current_amount = amount_in;

        for pool_id in pools {
            let (token_out, amount_out) =
                Pool::get_assert(pool_id).swap(current_token, current_amount);

            Wrapper::emit().history().swapped(
                pool_id,
                current_token,
                current_amount,
                token_out,
                amount_out,
            );
            current_token = token_out;
            current_amount = amount_out;
        }

        check(current_amount >= min_return, "does not meet minimum return");
        tokens_service.credit(
            current_token,
            sender,
            current_amount,
            "Swap complete".into(),
        );
    }

    #[event(history)]
    pub fn liq_modified(
        pool_id: TID,
        sender: AccountNumber,
        is_add: bool,
        amount_first: String,
        amount_second: String,
    ) {
    }

    #[event(history)]
    pub fn swapped(
        pool_id: TID,
        token_in: TID,
        amount_in: Quantity,
        token_out: TID,
        amount_out: Quantity,
    ) {
    }

    #[event(history)]
    pub fn swap_completed(
        sender: AccountNumber,
        token_in: TID,
        amount_in: Quantity,
        token_out: TID,
        amount_out: Quantity,
    ) {
    }
}

#[cfg(test)]
mod tests;
