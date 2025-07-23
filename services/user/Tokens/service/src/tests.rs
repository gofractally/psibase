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
            "memo".to_string().into(),
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
            "debit".to_string().into(),
        )
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
            Wrapper::push_from(&chain, alice).mint(2, 12345.into(), "memo".to_string().into()),
            "service 'tokens' aborted with message: failed to find token",
        );

        // Alice can create a new token
        let token_id = Wrapper::push_from(&chain, alice)
            .create(4.try_into().unwrap(), 80000.into())
            .get()?;

        // Alice can mint a portion of the token supply;
        assert_balance(&chain, alice, token_id, 0.into());
        Wrapper::push_from(&chain, alice)
            .mint(token_id, 12345.into(), format!("").into())
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
            "unreachable: unreachable",
        );

        debit(&chain, token_id, alice, bob, 5.into()).get()?;
        assert_shared_balance(&chain, alice, bob, token_id, 0.into());

        assert_error(
            Wrapper::push_from(&chain, alice).mint(
                token_id,
                67656.into(),
                "memo".to_string().into(),
            ),
            "service 'tokens' aborted with message: over max issued supply",
        );

        Wrapper::push_from(&chain, alice)
            .mint(token_id, 67655.into(), "memo".to_string().into())
            .get()?;

        let token_detail = Wrapper::push_from(&chain, alice).getToken(token_id).get()?;

        // assert!(
        //     token_detail.issued_supply - token_detail.burned_supply == token_detail.max_issued_supply,
        //     "expected the current supply to be the max issued supply",
        // );

        // assert_balance(&chain, bob, token_id, 12345.into());

        // // Bob can burn some of his balance
        // Wrapper::push_from(&chain, bob)
        //     .burn(token_id, 3.into(), format!("").into())
        //     .get()?;

        // let supply_delta = token_detail.current_supply
        //     - Wrapper::push_from(&chain, alice)
        //         .getToken(token_id)
        //         .get()?
        //         .current_supply;
        // assert_eq!(supply_delta, 3.into());

        // // Alice can burn some of Bobs balance
        // Wrapper::push_from(&chain, alice)
        //     .recall(token_id, bob, 6.into(), format!("").into())
        //     .get()?;

        // assert_balance(&chain, bob, token_id, 12336.into());

        Ok(())
    }
}
