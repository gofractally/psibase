#![allow(non_snake_case)]

#[cfg(test)]
mod tests {
    use crate::helpers::to_fixed;
    use crate::Wrapper;
    use psibase::services::http_server;
    use psibase::services::tokens::{Decimal, Precision, Quantity, TokensError};
    use psibase::*;
    use std::str::FromStr;

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
        assert_eq!(0, get_shared_balance(&chain, tid, bob, alice).value);

        // Bob can debit most of the balance, leaving 5 left.
        b.debit(tid, alice, 12340.into(), memo.clone());
        assert_eq!(12340, b.getBalance(tid, bob).get().unwrap().value);
        assert_eq!(5, get_shared_balance(&chain, tid, alice, bob).value);

        // Bob cannot debit more than whats in the shared balance
        assert_error(
            b.debit(tid, alice, 6.into(), memo.clone()),
            "Insufficient shared balance",
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

    #[test]
    fn test_to_fixed() {
        // test_padding_fractional
        assert_eq!(to_fixed("123.4", 2), "123.40");
        assert_eq!(to_fixed("123", 2), "123.00");
        assert_eq!(to_fixed("0.5", 3), "0.500");

        // test_truncating_fractional
        assert_eq!(to_fixed("123.456", 2), "123.45");
        assert_eq!(to_fixed("123.456789", 3), "123.456");

        // test_removing_leading_zeros
        assert_eq!(to_fixed("00123.4", 2), "123.40");
        assert_eq!(to_fixed("000123", 2), "123.00");
        assert_eq!(to_fixed("000.5", 3), "0.500");

        // test_zero_precision
        assert_eq!(to_fixed("123.4", 0), "123");
        assert_eq!(to_fixed("00123.456", 0), "123");
        assert_eq!(to_fixed("0.5", 0), "0");

        // test_zero_integer_part
        assert_eq!(to_fixed("0.5", 2), "0.50");
        assert_eq!(to_fixed("0", 2), "0.00");
        assert_eq!(to_fixed("000", 3), "0.000");

        // test_only_fractional_part
        assert_eq!(to_fixed(".5", 2), "0.50");
        assert_eq!(to_fixed(".123", 3), "0.123");

        // test_exact_precision
        assert_eq!(to_fixed("123.45", 2), "123.45");
        assert_eq!(to_fixed("0.123", 3), "0.123");

        // test_large_precision
        assert_eq!(to_fixed("123.4", 8), "123.40000000");
        assert_eq!(to_fixed("0", 5), "0.00000");
    }

    #[derive(serde::Deserialize)]
    struct SubaccountBalance {
        balance: String,
    }

    #[derive(serde::Deserialize)]
    struct SubaccountBalanceData {
        subaccountBalance: Option<SubaccountBalance>,
    }

    #[derive(serde::Deserialize)]
    struct GraphQLError {
        message: String,
    }

    #[derive(serde::Deserialize)]
    struct Response<T> {
        data: Option<T>,
        errors: Option<Vec<GraphQLError>>,
    }

    fn get_sub_balance(
        chain: &psibase::Chain,
        account: AccountNumber,
        subaccount: &str,
        token_id: u32,
        auth_token: &String,
    ) -> Result<u64, psibase::Error> {
        let query = format!(
            r#"query {{
                subaccountBalance(user: "{}", subAccount: "{}", tokenId: {}) {{
                    balance
                }}
            }}"#,
            account, subaccount, token_id
        );
        let response: Response<SubaccountBalanceData> =
            chain.graphql_auth(Wrapper::SERVICE, &query, auth_token)?;

        if let Some(errors) = response.errors {
            return Err(anyhow!("GraphQL error: {}", errors[0].message).into());
        }

        let Some(data) = response.data else {
            return Err(anyhow!("GraphQL response has no data").into());
        };

        let d = Decimal::from_str(&data.subaccountBalance.unwrap().balance)
            .map_err(|e: TokensError| anyhow!("Failed to parse balance: {}", e))?;

        Ok(d.quantity.value)
    }

    #[psibase::test_case(packages("Tokens"))]
    fn test_subaccounts(chain: psibase::Chain) -> Result<(), psibase::Error> {
        Wrapper::push(&chain).init();
        http_server::Wrapper::push_from(&chain, Wrapper::SERVICE)
            .registerServer(account!("r-tokens"))
            .get()?;
        chain.finish_block();

        let alice = account!("alice");
        chain.new_account(alice).unwrap();

        let bob = account!("bob");
        chain.new_account(bob).unwrap();

        let token_a = chain.login(account!("alice"), Wrapper::SERVICE)?;
        let token_b = chain.login(account!("bob"), Wrapper::SERVICE)?;

        let a = Wrapper::push_from(&chain, alice);
        let b = Wrapper::push_from(&chain, bob);

        let tid = a.create(4.try_into().unwrap(), 100_0000.into()).get()?;
        a.mint(tid, 10_0000.into(), "".into()).get()?;
        assert_eq!(10_0000, a.getBalance(tid, alice).get()?.value);
        a.credit(tid, bob, 10_0000.into(), "".into()).get()?;
        a.mint(tid, 10_0000.into(), "".into()).get()?;

        let checking = "checking".to_string();
        let savings = "savings".to_string();

        // Check send to a sub-account
        a.toSub(tid, savings.clone(), 5_0000.into()).get()?;
        assert_eq!(5_0000, a.getBalance(tid, alice).get()?.value);
        let balance = get_sub_balance(&chain, alice, &savings, tid, &token_a)?;
        assert_eq!(5_0000, balance);
        a.toSub(tid, savings.clone(), 3_0000.into()).get()?;
        assert_eq!(2_0000, a.getBalance(tid, alice).get()?.value);
        let balance = get_sub_balance(&chain, alice, &savings, tid, &token_a)?;
        assert_eq!(8_0000, balance);

        // Check retrieve from a sub-account
        a.fromSub(tid, savings.clone(), 2_0000.into()).get()?;
        assert_eq!(4_0000, a.getBalance(tid, alice).get()?.value);
        let balance = get_sub_balance(&chain, alice, &savings, tid, &token_a)?;
        assert_eq!(6_0000, balance);

        // Check overdraw from a sub-account
        assert_error(
            a.fromSub(tid, savings.clone(), 6_0001.into()),
            "Insufficient sub-account balance",
        );

        // Check auto-deleted sub-account
        a.fromSub(tid, savings.clone(), 6_0000.into()).get()?;
        assert_eq!(10_0000, a.getBalance(tid, alice).get()?.value);
        assert_query_error(
            get_sub_balance(&chain, alice, &savings, tid, &token_a),
            "not found",
        );

        // Check overdraw from primary
        assert_error(
            a.toSub(tid, savings.clone(), 100_0000.into()),
            "insufficient balance",
        );

        // Check multiple sub-accounts
        a.toSub(tid, savings.clone(), 3_0000.into()).get()?;
        a.toSub(tid, checking.clone(), 5_0000.into()).get()?;
        assert_eq!(2_0000, a.getBalance(tid, alice).get()?.value);
        let savings_balance = get_sub_balance(&chain, alice, &savings, tid, &token_a)?;
        let checking_balance = get_sub_balance(&chain, alice, &checking, tid, &token_a)?;
        assert_eq!(3_0000, savings_balance);
        assert_eq!(5_0000, checking_balance);

        a.toSub(tid, savings.clone(), 1_0000.into());
        assert_eq!(1_0000, a.getBalance(tid, alice).get()?.value);
        let savings_balance = get_sub_balance(&chain, alice, &savings, tid, &token_a)?;
        let checking_balance = get_sub_balance(&chain, alice, &checking, tid, &token_a)?;
        assert_eq!(4_0000, savings_balance);
        assert_eq!(5_0000, checking_balance);

        a.fromSub(tid, checking.clone(), 2_0000.into());
        assert_eq!(3_0000, a.getBalance(tid, alice).get()?.value);
        let savings_balance = get_sub_balance(&chain, alice, &savings, tid, &token_a)?;
        let checking_balance = get_sub_balance(&chain, alice, &checking, tid, &token_a)?;
        assert_eq!(4_0000, savings_balance);
        assert_eq!(3_0000, checking_balance);

        // Check auto-delete sub-account
        assert_error(
            a.deleteSub(savings.clone()),
            "Sub-account with non-zero balances cannot be deleted",
        );
        a.fromSub(tid, savings.clone(), 4_0000.into()).get()?;
        a.fromSub(tid, checking.clone(), 3_0000.into()).get()?;
        assert_eq!(10_0000, a.getBalance(tid, alice).get()?.value);

        assert_query_error(
            get_sub_balance(&chain, alice, &savings, tid, &token_a),
            "Sub-account 'savings' not found",
        );

        assert_query_error(
            get_sub_balance(&chain, alice, &checking, tid, &token_a),
            "Sub-account 'checking' not found",
        );

        // Check manually deleted sub-accounts
        a.toSub(tid, savings.clone(), 4_0000.into()).get()?;
        a.createSub(savings.clone()).get()?; // Upgrades to manual deletion
        assert_error(
            a.createSub(savings.clone()),
            "Sub-account was 'created' twice",
        );
        a.fromSub(tid, savings.clone(), 4_0000.into()).get()?;
        let savings_balance = get_sub_balance(&chain, alice, &savings, tid, &token_a)?;
        assert_eq!(0, savings_balance);
        a.deleteSub(savings.clone()).get()?;

        a.createSub(savings.clone()).get()?;
        assert_error(
            a.createSub(savings.clone()),
            "Sub-account was 'created' twice",
        );
        a.toSub(tid, savings.clone(), 1_0000.into()).get()?;
        a.fromSub(tid, savings.clone(), 1_0000.into()).get()?;
        let savings_balance = get_sub_balance(&chain, alice, &savings, tid, &token_a)?;
        assert_eq!(0, savings_balance);
        a.deleteSub(savings.clone()).get()?;

        // Check sub-account key length validation
        let long_key = "a".repeat(80);
        a.createSub(long_key.clone()).get()?;
        a.deleteSub(long_key.clone()).get()?;

        let too_long_key = "a".repeat(81);
        assert_error(
            a.createSub(too_long_key.clone()),
            "Sub-account key must be 80 bytes or less",
        );

        // Avoid cross-account sub-account contamination
        a.toSub(tid, savings.clone(), 1_0000.into()).get()?;
        b.toSub(tid, savings.clone(), 2_0000.into()).get()?;
        let a_savings_bal = get_sub_balance(&chain, alice, &savings, tid, &token_a)?;
        let b_savings_bal = get_sub_balance(&chain, bob, &savings, tid, &token_b)?;
        assert_eq!(1_0000, a_savings_bal);
        assert_eq!(2_0000, b_savings_bal);
        a.fromSub(tid, savings.clone(), a_savings_bal.into())
            .get()?;
        b.fromSub(tid, savings.clone(), b_savings_bal.into())
            .get()?;

        // Check multiple tokens in same sub-account
        a.toSub(tid, savings.clone(), 2_0000.into()).get()?;
        assert_eq!(8_0000, a.getBalance(tid, alice).get()?.value);

        let tid2 = a.create(4.try_into().unwrap(), 100_0000.into()).get()?;
        a.mint(tid2, 5_0000.into(), "".into()).get()?;
        a.toSub(tid2, savings.clone(), 3_0000.into()).get()?;
        assert_eq!(2_0000, a.getBalance(tid2, alice).get()?.value);

        let savings_balance_1 = get_sub_balance(&chain, alice, &savings, tid, &token_a)?;
        let savings_balance_2 = get_sub_balance(&chain, alice, &savings, tid2, &token_a)?;
        assert_eq!(2_0000, savings_balance_1);
        assert_eq!(3_0000, savings_balance_2);

        Ok(())
    }
}
