#![allow(non_snake_case)]

#[cfg(test)]
mod tests {
    use psibase::{
        services::tokens::{Quantity, Wrapper as Tokens, TID},
        AccountNumber,
    };

    use crate::Wrapper as Cost;
    use psibase::*;

    fn create_and_mint_token(chain: &psibase::Chain, sender: AccountNumber, amount: u64) -> u32 {
        let token_id = Tokens::push_from(&chain, sender)
            .create(4.try_into().unwrap(), u64::MAX.into())
            .get()
            .unwrap();

        Tokens::push_from(&chain, sender).mint(token_id, amount.into(), "".into());
        token_id
    }

    fn tokens_credit(
        chain: &psibase::Chain,
        token_id: u32,
        creditor: AccountNumber,
        debitor: AccountNumber,
        amount: u64,
    ) {
        Tokens::push_from(&chain, creditor)
            .credit(
                token_id,
                debitor,
                amount.into(),
                "memo".to_string().try_into().unwrap(),
            )
            .get()
            .unwrap();
    }

    fn get_balance(chain: &psibase::Chain, token_id: u32, account: AccountNumber) -> Quantity {
        Tokens::push(&chain)
            .getBalance(token_id, account)
            .get()
            .unwrap()
    }

    fn perform_action_and_assert_balances(
        chain: &psibase::Chain,
        sender: AccountNumber,
        credits: Vec<(u32, u64)>,
        expectations: Vec<(u32, AccountNumber, i64)>, // (token_id, account, expected_delta): after - before, positive for increase, negative for decrease
        action: impl FnOnce(),
    ) {
        // Collect items from expectations
        let items: Vec<(u32, AccountNumber)> =
            expectations.iter().map(|&(t, a, _)| (t, a)).collect();
        let mut befores: Vec<Quantity> = Vec::with_capacity(items.len());
        for &(token, account) in &items {
            befores.push(get_balance(chain, token, account));
        }

        // Perform pre-credits if any
        for (token_id, amount) in credits {
            tokens_credit(chain, token_id, sender, account!("cost"), amount.into());
        }

        action();

        // Assert deltas
        for (i, &(token, account, exp_delta)) in expectations.iter().enumerate() {
            let after = get_balance(chain, token, account);
            let actual_delta = (after.value as i64) - (befores[i].value as i64);
            assert_eq!(
                actual_delta, exp_delta,
                "Balance delta mismatch for token {} on account {}: expected {}, actual {}",
                token, account, exp_delta, actual_delta
            );
        }
    }

    #[psibase::test_case(packages("Cost"))]
    fn test_simple_purchase(chain: psibase::Chain) -> Result<(), psibase::Error> {
        let alice = AccountNumber::from("alice");
        let bob = AccountNumber::from("bob");
        chain.new_account(alice).unwrap();
        chain.new_account(bob).unwrap();

        let five_percent: u32 = 50_000;

        let token_id = create_and_mint_token(&chain, alice, 10000000);
        tokens_credit(&chain, token_id, alice, bob, 5000);

        let cats_name = AccountNumber::from("cats");
        Cost::push_from(&chain, alice)
            .new_asset("cats".into(), token_id, five_percent, 250.into())
            .get()
            .unwrap();

        perform_action_and_assert_balances(
            &chain,
            bob,
            vec![(token_id, 250)],
            vec![(token_id, bob, -250), (token_id, alice, 250)],
            || {
                Cost::push_from(&chain, bob)
                    .purchase(alice, cats_name)
                    .get()
                    .unwrap();
            },
        );

        Ok(())
    }
}
