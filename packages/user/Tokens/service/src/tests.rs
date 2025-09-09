#![allow(non_snake_case)]

#[cfg(test)]
mod tests {
    use crate::Wrapper;
    use psibase::services::tokens::Quantity;
    use psibase::*;

    fn credit(
        chain: &psibase::Chain,
        token_id: u32,
        creditor: AccountNumber,
        debitor: AccountNumber,
        amount: Quantity,
    ) -> ChainEmptyResult {
        Wrapper::push_from(chain, creditor).credit(
            token_id,
            debitor,
            amount,
            "memo".to_string().try_into().unwrap(),
        )
    }

    fn debit(
        chain: &psibase::Chain,
        token_id: u32,
        creditor: AccountNumber,
        debitor: AccountNumber,
        amount: Quantity,
    ) -> ChainEmptyResult {
        Wrapper::push_from(chain, debitor).debit(
            token_id,
            creditor,
            amount,
            "debit".to_string().try_into().unwrap(),
        )
    }

    fn debit_up_to(
        chain: &psibase::Chain,
        token_id: u32,
        creditor: AccountNumber,
        debitor: AccountNumber,
        amount: Quantity,
    ) -> Quantity {
        Wrapper::push_from(chain, debitor)
            .debit_up_to(
                token_id,
                creditor,
                amount,
                "debit".to_string().try_into().unwrap(),
            )
            .get()
            .unwrap()
    }

    fn assert_error(result: ChainEmptyResult, message: &str) {
        assert_eq!(result.trace.error.unwrap(), message);
    }

    fn get_balance(chain: &psibase::Chain, account: AccountNumber, token_id: u32) -> Quantity {
        Wrapper::push(&chain)
            .getBalance(token_id, account)
            .get()
            .unwrap()
    }

    fn assert_balance(
        chain: &psibase::Chain,
        account: AccountNumber,
        token_id: u32,
        balance: Quantity,
    ) {
        assert_eq!(get_balance(chain, account, token_id), balance)
    }

    fn assert_shared_balance(
        chain: &psibase::Chain,
        creditor: AccountNumber,
        debitor: AccountNumber,
        token_id: u32,
        balance: Quantity,
    ) {
        assert_eq!(
            get_shared_balance(chain, token_id, creditor, debitor),
            balance
        )
    }

    fn get_shared_balance(
        chain: &psibase::Chain,
        token_id: u32,
        creditor: AccountNumber,
        debitor: AccountNumber,
    ) -> Quantity {
        Wrapper::push(&chain)
            .getSharedBal(token_id, creditor, debitor)
            .get()
            .unwrap()
    }

    #[psibase::test_case(packages("Tokens"))]
    fn test_basics(chain: psibase::Chain) -> Result<(), psibase::Error> {
        Wrapper::push(&chain).init();

        let alice = account!("alice");
        chain.new_account(alice).unwrap();

        let bob = account!("bob");
        chain.new_account(bob).unwrap();

        let malicious_mike = account!("mike");
        chain.new_account(malicious_mike).unwrap();

        // Alice cannot mint a token that does not yet exist.
        assert_error(
            Wrapper::push_from(&chain, alice).mint(
                2,
                12345.into(),
                "memo".to_string().try_into().unwrap(),
            ),
            "service 'tokens' aborted with message: Token DNE",
        );

        Wrapper::push_from(&chain, alice).setUserConf(0, true);
        Wrapper::push_from(&chain, bob).setUserConf(0, true);

        // Alice can create a new token
        let token_id = Wrapper::push_from(&chain, alice)
            .create(4.try_into().unwrap(), 80000.into())
            .get()?;

        // Alice can mint a portion of the token supply;
        assert_balance(&chain, alice, token_id, 0.into());
        Wrapper::push_from(&chain, alice)
            .mint(token_id, 12345.into(), format!("").try_into().unwrap())
            .get()?;
        assert_balance(&chain, alice, token_id, 12345.into());

        chain.finish_block();

        // Alice credits her entire balance to bob, with the entire amount in their shared balance.
        credit(&chain, token_id, alice, bob, 12345.into()).get()?;
        assert_balance(&chain, alice, token_id, 0.into());
        assert_shared_balance(&chain, alice, bob, token_id, 12345.into());

        // Bob can debit most of the balance, leaving 5 left.
        debit(&chain, token_id, alice, bob, 12340.into()).get()?;
        assert_balance(&chain, bob, token_id, 12340.into());
        assert_shared_balance(&chain, alice, bob, token_id, 5.into());
        // Bob cannot debit more than whats in the shared balance
        assert_error(
            debit(&chain, token_id, alice, bob, 6.into()),
            "service 'tokens' aborted with message: Insufficient token balance",
        );

        debit(&chain, token_id, alice, bob, 5.into()).get()?;
        assert_shared_balance(&chain, alice, bob, token_id, 0.into());

        assert_error(
            Wrapper::push_from(&chain, alice).mint(
                token_id,
                67656.into(),
                "memo".to_string().try_into().unwrap(),
            ),
            "service 'tokens' aborted with message: Max issued supply exceeded",
        );

        // Bob sends back 100 tokens
        credit(&chain, token_id, bob, alice, 100.into())
            .get()
            .unwrap();

        assert_shared_balance(&chain, bob, alice, token_id, 100.into());

        // Alice only takes 85 / 100 tokens
        assert_eq!(
            debit_up_to(&chain, token_id, bob, alice, 85.into()),
            85.into()
        );

        assert_shared_balance(&chain, bob, alice, token_id, 15.into());

        // Alice debits more than balance remaining
        assert_eq!(
            debit_up_to(&chain, token_id, bob, alice, 1000.into()),
            15.into()
        );
        assert_shared_balance(&chain, bob, alice, token_id, 0.into());

        // Bob sends another 5 tokens
        credit(&chain, token_id, bob, alice, 5.into())
            .get()
            .unwrap();

        assert_shared_balance(&chain, bob, alice, token_id, 5.into());

        // Alice can debit 0 to debit entire balance
        assert_eq!(
            debit_up_to(&chain, token_id, bob, alice, 0.into()),
            5.into()
        );
        assert_shared_balance(&chain, bob, alice, token_id, 0.into());

        Ok(())
    }
}
