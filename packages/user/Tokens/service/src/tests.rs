#![allow(non_snake_case)]

#[cfg(test)]
mod tests {
    use crate::Wrapper;
    use psibase::services::tokens::{Precision, Quantity};
    use psibase::*;

    const MANUAL_DEBIT: u8 = 0;

    fn assert_error(result: ChainEmptyResult, message: &str) {
        let err = result.trace.error.unwrap();
        let contains_error = err.contains(message);
        assert!(
            contains_error,
            "Error \"{}\" does not contain: \"{}\"",
            err, message
        );
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
        let a = Wrapper::push_from(&chain, alice);

        let bob = account!("bob");
        chain.new_account(bob).unwrap();
        let b = Wrapper::push_from(&chain, bob);
        b.setUserConf(MANUAL_DEBIT, true);

        let malicious_mike = account!("mike");
        chain.new_account(malicious_mike).unwrap();

        let memo = Memo::new("memo".to_string()).unwrap();

        // Alice cannot mint a token that does not yet exist.
        assert_error(a.mint(2, 12345.into(), memo.clone()), "Token DNE");

        // Alice can create a new token
        let tid = a.create(4.try_into().unwrap(), 80000.into()).get()?;

        // Alice can mint a portion of the token supply;
        assert_eq!(0, a.getBalance(tid, alice).get().unwrap().value);
        a.mint(tid, 12345.into(), memo.clone());
        assert_eq!(12345, a.getBalance(tid, alice).get().unwrap().value);

        // Alice credits her entire balance to bob, with the entire amount in their shared balance.
        a.credit(tid, bob, 12345.into(), memo.clone());
        assert_eq!(0, a.getBalance(tid, alice).get().unwrap().value);
        assert_eq!(12345, get_shared_balance(&chain, tid, alice, bob).value);

        // Bob can debit most of the balance, leaving 5 left.
        b.debit(tid, alice, 12340.into(), memo.clone());
        assert_eq!(12340, b.getBalance(tid, bob).get().unwrap().value);
        assert_eq!(5, get_shared_balance(&chain, tid, alice, bob).value);

        // Bob cannot debit more than whats in the shared balance
        assert_error(
            b.debit(tid, alice, 6.into(), memo.clone()),
            "Insufficient token balance",
        );
        b.debit(tid, alice, 5.into(), memo.clone());
        assert_eq!(0, get_shared_balance(&chain, tid, alice, bob).value);

        assert_error(
            a.mint(tid, 67656.into(), memo.clone()),
            "Max issued supply exceeded",
        );

        Ok(())
    }

    #[psibase::test_case(packages("Tokens"))]
    fn test_reject(chain: psibase::Chain) -> Result<(), psibase::Error> {
        let memo = Memo::new("".to_string()).unwrap();

        let alice = account!("alice");
        chain.new_account(alice).unwrap();
        let a = Wrapper::push_from(&chain, alice);

        let bob = account!("bob");
        chain.new_account(bob).unwrap();
        let b = Wrapper::push_from(&chain, bob);

        b.setUserConf(MANUAL_DEBIT, true);

        let tid = a
            .create(Precision::new(4).unwrap(), 100_0000.into())
            .get()?;
        a.mint(tid, 100.into(), memo.clone());

        assert_eq!(100, a.getBalance(tid, alice).get()?.value);
        a.credit(tid, bob, 100.into(), memo.clone()).get()?;
        assert_eq!(0, a.getBalance(tid, alice).get()?.value);
        assert_eq!(0, b.getBalance(tid, bob).get()?.value);
        b.reject(tid, alice, memo.clone());
        assert_eq!(100, a.getBalance(tid, alice).get()?.value);
        assert_eq!(0, b.getBalance(tid, bob).get()?.value);

        Ok(())
    }
}
