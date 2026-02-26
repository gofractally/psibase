#![allow(non_snake_case)]

#[cfg(test)]
mod tests {
    use crate::Wrapper;
    use psibase::services::nft::NID;
    use psibase::services::tokens::{Quantity, Wrapper as Tokens, TID};
    use psibase::*;

    fn create_and_mint_token(
        chain: &psibase::Chain,
        sender: AccountNumber,
        amount: Quantity,
    ) -> u32 {
        let token_id = Tokens::push_from(&chain, sender)
            .create(4.try_into().unwrap(), u64::MAX.into())
            .get()
            .unwrap();

        Tokens::push_from(&chain, sender).mint(token_id, amount, "".into());
        token_id
    }

    fn get_balance(chain: &psibase::Chain, token_id: u32, account: AccountNumber) -> Quantity {
        Tokens::push(&chain)
            .getBalance(token_id, account)
            .get()
            .unwrap()
    }

    fn create_pool(
        chain: &psibase::Chain,
        sender: AccountNumber,
        token_a: u32,
        token_b: u32,
        token_a_amount: Quantity,
        token_b_amount: Quantity,
        nft_id: Option<u32>,
    ) -> (u32, u32) {
        Wrapper::push_from(&chain, sender)
            .new_pool(token_a, token_b, token_a_amount, token_b_amount, nft_id)
            .get()
            .unwrap()
    }

    fn tokens_credit(
        chain: &psibase::Chain,
        token_id: u32,
        creditor: AccountNumber,
        debitor: AccountNumber,
        amount: Quantity,
    ) {
        Tokens::push_from(&chain, creditor)
            .credit(
                token_id,
                debitor,
                amount,
                "memo".to_string().try_into().unwrap(),
            )
            .get()
            .unwrap();
    }

    fn swap_and_assert(
        chain: &psibase::Chain,
        sender: AccountNumber,
        pools: Vec<u32>,
        input_token: u32,
        input_amount: u64,
        min_output: u64,
        output_token: u32,
        expected_output: u64,
    ) {
        perform_action_and_assert_balances(
            &chain,
            sender,
            vec![(input_token, input_amount)],
            vec![
                (input_token, (input_amount as i64) * -1),
                (output_token, (expected_output as i64)),
            ],
            || {
                swap(&chain, sender, pools, input_token, input_amount, min_output);
            },
        );
    }

    fn perform_action_and_assert_balances(
        chain: &psibase::Chain,
        sender: AccountNumber,
        credits: Vec<(u32, u64)>, // Optional pre-credits: (token_id, amount) to credit from sender to "token-swap"
        expectations: Vec<(u32, i64)>, // (token_id, expected_delta): after - before, positive for increase, negative for decrease
        action: impl FnOnce(),
    ) {
        // Collect unique tokens from expectations (assuming all are for sender's balances, as per pattern)
        let tokens: Vec<u32> = expectations.iter().map(|&(t, _)| t).collect();
        let mut befores: Vec<Quantity> = Vec::with_capacity(tokens.len());
        for &token in &tokens {
            befores.push(get_balance(chain, token, sender));
        }

        // Perform pre-credits if any
        for (token_id, amount) in credits {
            tokens_credit(
                chain,
                token_id,
                sender,
                account!("token-swap"),
                amount.into(),
            );
        }

        action();

        // Assert deltas
        for (i, &(token, exp_delta)) in expectations.iter().enumerate() {
            let after = get_balance(chain, token, sender);
            let actual_delta = (after.value as i64) - (befores[i].value as i64);
            assert_eq!(
                actual_delta, exp_delta,
                "Balance delta mismatch for token {}: expected {}, actual {}",
                token, exp_delta, actual_delta
            );
        }
    }

    fn initialise_pool(
        chain: &psibase::Chain,
        sender: AccountNumber,
        a_reserve_amount: Quantity,
        b_reserve_amount: Quantity,
    ) -> (TID, NID, TID, TID) {
        let token_a = create_and_mint_token(&chain, sender, u64::MAX.into());
        let token_b = create_and_mint_token(&chain, sender, u64::MAX.into());
        let token_swap = account!("token-swap");

        tokens_credit(&chain, token_a, sender, token_swap, a_reserve_amount);
        tokens_credit(&chain, token_b, sender, token_swap, b_reserve_amount);

        let (pool_id, nft_id) = create_pool(
            &chain,
            sender,
            token_a,
            token_b,
            a_reserve_amount,
            b_reserve_amount,
            None,
        );

        (pool_id, nft_id, token_a, token_b)
    }

    fn swap(
        chain: &psibase::Chain,
        sender: AccountNumber,
        pools: Vec<u32>,
        token_in: TID,
        amount: u64,
        min_return: u64,
    ) {
        Wrapper::push_from(&chain, sender)
            .swap(pools, token_in, amount.into(), min_return.into())
            .get()
            .unwrap()
    }

    #[psibase::test_case(packages("TokenSwap"))]
    fn test_several_trades(chain: psibase::Chain) -> Result<(), psibase::Error> {
        let alice = account!("alice");
        chain.new_account(alice).unwrap();

        let (pool_id, _nft_id, token_a, token_b) =
            initialise_pool(&chain, alice, 100_000.into(), 100_000.into()); // 100k each

        // === SMALL TRADE (very low slippage) ===
        swap_and_assert(&chain, alice, vec![pool_id], token_a, 100, 95, token_b, 99);

        // === MEDIUM TRADE (moderate slippage) ===
        swap_and_assert(
            &chain,
            alice,
            vec![pool_id],
            token_a,
            2000,
            1900,
            token_b,
            1956,
        );

        // === LARGE TRADE (high slippage) ===
        swap_and_assert(
            &chain,
            alice,
            vec![pool_id],
            token_a,
            15000,
            12546,
            token_b,
            12546,
        );

        // === VERY LARGE TRADE (heavy slippage) ===
        swap_and_assert(
            &chain,
            alice,
            vec![pool_id],
            token_a,
            40000,
            21743,
            token_b,
            21743,
        );

        Ok(())
    }

    #[psibase::test_case(packages("TokenSwap"))]
    fn test_single_side_fee(chain: psibase::Chain) -> Result<(), psibase::Error> {
        let alice = account!("alice");
        chain.new_account(alice).unwrap();

        let (pool_id, _nft_id, token_a, token_b) =
            initialise_pool(&chain, alice, 100_000.into(), 100_000.into());

        Wrapper::push_from(&chain, alice).set_fee(pool_id, token_a, 500000);

        perform_action_and_assert_balances(
            &chain,
            alice,
            vec![(token_a, 100)],
            vec![(token_a, -100), (token_b, 49)],
            || {
                Wrapper::push_from(&chain, alice)
                    .swap(vec![pool_id], token_a, 100.into(), 49.into())
                    .get()
                    .unwrap()
            },
        );

        Ok(())
    }

    #[psibase::test_case(packages("TokenSwap"))]
    fn test_adding_liquidity(chain: psibase::Chain) -> Result<(), psibase::Error> {
        let alice = account!("alice");
        chain.new_account(alice).unwrap();

        // Create a pool of equal 1:1 reserve ratios
        let (pool_id, _nft_id, token_a, token_b) =
            initialise_pool(&chain, alice, 100_000.into(), 100_000.into());

        perform_action_and_assert_balances(
            &chain,
            alice,
            vec![(token_a, 100), (token_b, 200)],
            // Due to the pool having 1:1 reserve ratios, we expect the pool to only take 100 token_b tokens despite sending 200, the rest is rejected
            vec![(token_a, -100), (token_b, -100)],
            || {
                Wrapper::push_from(&chain, alice)
                    .add_liquidity(pool_id, token_a, token_b, 100.into(), 200.into())
                    .get()
                    .unwrap();
            },
        );

        Ok(())
    }

    #[psibase::test_case(packages("TokenSwap"))]
    fn test_remove_liquidity(chain: psibase::Chain) -> Result<(), psibase::Error> {
        let alice = account!("alice");
        chain.new_account(alice).unwrap();

        let (pool_id, _nft_id, token_a, token_b) =
            initialise_pool(&chain, alice, 100_000.into(), 100_000.into());

        let lp_token = pool_id; // LP token is the pool_id token

        // Capture LP balance before adding liquidity
        let lp_before = get_balance(&chain, lp_token, alice);

        // Add extra liquidity (should take 50/50 due to ratio)
        perform_action_and_assert_balances(
            &chain,
            alice,
            vec![(token_a, 5000), (token_b, 5000)],
            vec![(token_a, -5000), (token_b, -5000)],
            || {
                Wrapper::push_from(&chain, alice)
                    .add_liquidity(pool_id, token_a, token_b, 5000.into(), 5000.into())
                    .get()
                    .unwrap();
            },
        );

        // Calculate awarded LP tokens after add
        let lp_after_add = get_balance(&chain, lp_token, alice);
        let awarded_lp = lp_after_add - lp_before;

        // Remove half the awarded LP tokens
        let remove_amount = (awarded_lp.value / 2) as u64;

        perform_action_and_assert_balances(
            &chain,
            alice,
            vec![(lp_token, remove_amount)],
            vec![
                (lp_token, -(remove_amount as i64)),
                (token_a, 2499),
                (token_b, 2499),
            ],
            || {
                Wrapper::push_from(&chain, alice)
                    .remove_liquidity(pool_id, remove_amount.into())
                    .get()
                    .unwrap();
            },
        );

        Ok(())
    }

    #[psibase::test_case(packages("TokenSwap"))]
    fn test_multi_hop_swap(chain: psibase::Chain) -> Result<(), psibase::Error> {
        let alice = account!("alice");
        let token_swap = account!("token-swap");

        chain.new_account(alice).unwrap();

        // Pool 1: A-B (1:1)
        let (pool_ab, _, token_a, token_b) =
            initialise_pool(&chain, alice, 100_000.into(), 100_000.into());

        // Pool 2: B-C (1:1)
        let token_c = create_and_mint_token(&chain, alice, u64::MAX.into());
        tokens_credit(&chain, token_b, alice, token_swap, 100_000.into());
        tokens_credit(&chain, token_c, alice, token_swap, 100_000.into());

        let (pool_bc, _) = create_pool(
            &chain,
            alice,
            token_b,
            token_c,
            100_000.into(),
            100_000.into(),
            None,
        );

        // Swap A → C via A-B then B-C
        swap_and_assert(
            &chain,
            alice,
            vec![pool_ab, pool_bc],
            token_a,
            100,
            95,
            token_c,
            98,
        );

        Ok(())
    }

    #[psibase::test_case(packages("TokenSwap"))]
    fn test_asymmetric_fees(chain: psibase::Chain) -> Result<(), psibase::Error> {
        let alice = account!("alice");
        chain.new_account(alice).unwrap();

        let (pool_id, _nft_id, token_a, token_b) =
            initialise_pool(&chain, alice, 100_000.into(), 100_000.into());

        // 0.3% on A→pool, 1% on B→pool
        Wrapper::push_from(&chain, alice)
            .set_fee(pool_id, token_a, 3000)
            .get()
            .unwrap();
        Wrapper::push_from(&chain, alice)
            .set_fee(pool_id, token_b, 10000)
            .get()
            .unwrap();

        // A → B (fee from incoming A: 0.3%)
        swap_and_assert(&chain, alice, vec![pool_id], token_a, 1000, 1, token_b, 987);

        // B → A (fee from incoming B: 1%)
        swap_and_assert(&chain, alice, vec![pool_id], token_b, 1000, 1, token_a, 999);

        Ok(())
    }
}
