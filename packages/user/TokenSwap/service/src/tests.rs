#![allow(non_snake_case)]

#[cfg(test)]
mod tests {
    use crate::Wrapper;
    use psibase::services::chainmail::action_structs::send;
    use psibase::services::nft::NID;
    use psibase::services::tokens::{
        self, Decimal, Precision, Quantity, TokensError, Wrapper as Tokens, TID,
    };
    use psibase::*;
    use std::str::FromStr;

    fn assert_error(result: ChainEmptyResult, message: &str) {
        let err = result.trace.error.unwrap();
        let contains_error = err.contains(message);
        assert!(
            contains_error,
            "Error \"{}\" does not contain: \"{}\"",
            err, message
        );
    }

    fn assert_query_error<T: std::fmt::Debug>(result: Result<T, psibase::Error>, message: &str) {
        let err = result.unwrap_err();
        let err_msg = err.to_string();
        let contains_error = err_msg.contains(message);
        assert!(
            contains_error,
            "Error \"{}\" does not contain: \"{}\"",
            err_msg, message
        );
    }

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
        input_amount: Quantity,
        min_output: Quantity,
        output_token: u32,
        expected_output: Quantity,
    ) {
        let before_input = get_balance(chain, input_token, sender);
        let before_output = get_balance(chain, output_token, sender);

        tokens_credit(
            chain,
            input_token,
            sender,
            account!("token-swap"),
            input_amount,
        );

        Wrapper::push_from(&chain, sender)
            .swap(pools, input_token, input_amount, min_output)
            .get()
            .unwrap();

        let after_input = get_balance(chain, input_token, sender);
        let after_output = get_balance(chain, output_token, sender);

        assert_eq!(
            after_input,
            before_input - input_amount,
            "Input token balance decrease mismatch"
        );
        assert_eq!(
            after_output,
            before_output + expected_output,
            "Output token balance increase mismatch, expected change of {:?} but received change of {:?}",
            expected_output,
            after_output - before_output
        );
    }

    fn initialise_pool(
        chain: &psibase::Chain,
        sender: AccountNumber,
        a_reserve_amount: Quantity,
        b_reserve_amount: Quantity,
    ) -> (TID, NID, TID, TID) {
        let token_a = create_and_mint_token(&chain, sender, u64::MAX.into());
        let token_b = create_and_mint_token(&chain, sender, u64::MAX.into());

        tokens_credit(
            &chain,
            token_a,
            sender,
            "token-swap".into(),
            a_reserve_amount,
        );
        tokens_credit(
            &chain,
            token_b,
            sender,
            "token-swap".into(),
            b_reserve_amount,
        );

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

    #[psibase::test_case(packages("TokenSwap"))]
    fn test_several_trades(chain: psibase::Chain) -> Result<(), psibase::Error> {
        let alice = account!("alice");
        chain.new_account(alice).unwrap();

        let (pool_id, _nft_id, token_a, token_b) =
            initialise_pool(&chain, alice, 100_000.into(), 100_000.into()); // 100k each

        // === SMALL TRADE (very low slippage) ===
        swap_and_assert(
            &chain,
            alice,
            vec![pool_id],
            token_a,
            100.into(), // 0.1% of pool
            95.into(),  // allowing for fee + tiny slippage
            token_b,
            99.into(), // expect almost full amount (minus fee)
        );

        // === MEDIUM TRADE (moderate slippage) ===
        swap_and_assert(
            &chain,
            alice,
            vec![pool_id],
            token_a,
            2000.into(), // 2% of pool
            1900.into(),
            token_b,
            1956.into(), // ~2% slippage + fee
        );

        // === LARGE TRADE (high slippage) ===
        swap_and_assert(
            &chain,
            alice,
            vec![pool_id],
            token_a,
            15000.into(), // 15% of pool
            12546.into(),
            token_b,
            12546.into(), // significant slippage expected
        );

        // === VERY LARGE TRADE (heavy slippage) ===
        swap_and_assert(
            &chain,
            alice,
            vec![pool_id],
            token_a,
            40000.into(), // 40% of pool
            21743.into(),
            token_b,
            21743.into(), // expect much less than input due to curve
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

        swap_and_assert(
            &chain,
            alice,
            vec![pool_id],
            token_a,
            100.into(), // 0.1% of pool
            49.into(),  // allowing for fee + tiny slippage
            token_b,
            49.into(), // expect almost full amount (minus fee)
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

        let a_before_balance = get_balance(&chain, token_a, alice);
        let b_before_balance = get_balance(&chain, token_b, alice);

        // Attempt to add unequal reserve ratios in liquidity 1:2
        tokens_credit(&chain, token_a, alice, "token-swap".into(), 100.into());
        tokens_credit(&chain, token_b, alice, "token-swap".into(), 200.into());
        Wrapper::push_from(&chain, alice)
            .add_liquidity(pool_id, token_a, token_b, 100.into(), 200.into())
            .get()
            .unwrap();

        let a_after_balance = get_balance(&chain, token_a, alice);
        let b_after_balance = get_balance(&chain, token_b, alice);
        assert_eq!(a_before_balance - a_after_balance, 100.into());
        assert_eq!(b_before_balance - b_after_balance, 100.into(), "expected only 100 tokens to be taken despite sending 200 as additional liquidity demands a 1:1 ratio");

        Ok(())
    }
}
