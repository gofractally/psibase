#[psibase::service_tables]
pub mod tables {
    use async_graphql::SimpleObject;
    use psibase::{check, check_some, AccountNumber, Fracpack, Table, ToSchema};
    use serde::{Deserialize, Serialize};

    #[table(name = "InitTable", index = 0)]
    #[derive(Serialize, Deserialize, ToSchema, Fracpack, Debug)]
    pub struct InitRow {}
    impl InitRow {
        #[primary_key]
        fn pk(&self) {}
    }

    #[table(name = "CreditLineTable", index = 1)]
    #[derive(Default, Fracpack, ToSchema, SimpleObject, Serialize, Deserialize, Debug)]
    pub struct CreditLine {
        pub ticker: AccountNumber,
        pub account_a: AccountNumber,
        pub account_b: AccountNumber,
        // If balance is positive, a account is creditor / extended a loan, b account is debitor / in debt
        // If balance is negative, b account is creditor / extended a loan, a account is debitor / in debt
        pub balance: i64,
        pub max_credit_limit_by_a: i64,
        pub max_credit_limit_by_b: i64,
    }

    impl CreditLine {
        #[primary_key]
        fn pk(&self) -> (AccountNumber, AccountNumber, AccountNumber) {
            (self.ticker, self.account_a, self.account_b)
        }

        pub fn sort_accounts(a: AccountNumber, b: AccountNumber) -> (AccountNumber, AccountNumber) {
            check(a.value != b.value, "both items are the same");
            if a.value < b.value {
                (a, b)
            } else {
                (b, a)
            }
        }

        fn new(ticker: AccountNumber, a: AccountNumber, b: AccountNumber) -> Self {
            Self {
                ticker,
                account_a: a,
                account_b: b,
                balance: 0,
                max_credit_limit_by_a: 0,
                max_credit_limit_by_b: 0,
            }
        }

        fn get(ticker: AccountNumber, a: AccountNumber, b: AccountNumber) -> Option<Self> {
            let (a, b) = Self::sort_accounts(a, b);
            CreditLineTable::read().get_index_pk().get(&(ticker, a, b))
        }

        fn is_party(&self, account: AccountNumber) -> bool {
            self.account_a == account || self.account_b == account
        }

        fn check_is_party(&self, account: AccountNumber) {
            check(
                self.is_party(account),
                "account is not a party of credit line",
            )
        }

        pub fn get_or_new(ticker: AccountNumber, a: AccountNumber, b: AccountNumber) -> Self {
            let (a, b) = Self::sort_accounts(a, b);

            Self::get(ticker, a, b).unwrap_or_else(|| Self::new(ticker, a, b))
        }

        pub fn set_credit_limit(&mut self, creditor: AccountNumber, credit_limit: i64) {
            check(credit_limit > 0, "credit limit must be positive");

            self.check_is_party(creditor);
            if creditor == self.account_a {
                self.max_credit_limit_by_a = credit_limit;
            } else {
                self.max_credit_limit_by_b = credit_limit;
            }
            self.save()
        }

        fn credit_counter_party(
            &mut self,
            creditor: AccountNumber,
            amount: i64,
            ignore_limit: bool,
        ) {
            check(amount > 0, "amount must be positive");
            self.check_is_party(creditor);
            let new_balance = if creditor == self.account_a {
                self.balance
                    .checked_add(amount)
                    .expect("integer overflow in balance")
            } else {
                self.balance
                    .checked_sub(amount)
                    .expect("integer overflow in balance")
            };
            if !ignore_limit {
                self.check_balance_limit(new_balance);
            }
            self.balance = new_balance;
            self.save();
        }

        pub fn draw(&mut self, debitor: AccountNumber, amount: i64) {
            self.check_is_party(debitor);
            let creditor = if debitor == self.account_a {
                self.account_b
            } else {
                self.account_a
            };
            self.credit_counter_party(creditor, amount, false);
        }

        fn check_balance_limit(&self, balance_to_check: i64) {
            if balance_to_check == 0 {
                return;
            }
            let a_is_creditor = balance_to_check > 0;

            if a_is_creditor {
                let is_expanding_debt = balance_to_check > self.balance;
                if is_expanding_debt {
                    check(
                        balance_to_check <= self.max_credit_limit_by_a,
                        "breaches max limit",
                    )
                }
            } else {
                let is_expanding_debt = balance_to_check > self.balance;
                if is_expanding_debt {
                    check(
                        balance_to_check.abs() <= self.max_credit_limit_by_b,
                        "breaches max limit",
                    )
                }
            }
        }

        pub fn extend_credit(&mut self, creditor: AccountNumber, amount: i64) {
            self.check_is_party(creditor);
            self.credit_counter_party(creditor, amount, true);
        }

        fn save(&self) {
            CreditLineTable::read_write().put(&self).unwrap()
        }
    }
}

#[psibase::service(name = "credit-lines", tables = "tables")]
pub mod service {
    use crate::tables::{CreditLine, InitRow, InitTable};
    use psibase::*;

    #[action]
    fn init() {
        let table = InitTable::new();
        table.put(&InitRow {}).unwrap();
    }

    #[pre_action(exclude(init))]
    fn check_init() {
        let table = InitTable::new();
        check(
            table.get_index_pk().get(&()).is_some(),
            "service not inited",
        );
    }

    #[action]
    fn set_credit_limit(ticker: AccountNumber, counter_party: AccountNumber, max_credit: i64) {
        let sender = get_sender();
        CreditLine::get_or_new(ticker, sender, counter_party).set_credit_limit(sender, max_credit);
    }

    #[action]
    fn credit(ticker: AccountNumber, debitor: AccountNumber, amount: i64, memo: Memo) {
        let creditor = get_sender();
        CreditLine::get_or_new(ticker, creditor, debitor).extend_credit(creditor, amount);
        crate::Wrapper::emit().history().credited(
            ticker,
            creditor,
            debitor,
            amount,
            memo.to_string(),
        );
    }

    #[action]
    fn draw(ticker: AccountNumber, creditor: AccountNumber, amount: i64, memo: Memo) {
        let debitor = get_sender();
        CreditLine::get_or_new(ticker, debitor, creditor).draw(debitor, amount);
        crate::Wrapper::emit().history().credited(
            ticker,
            creditor,
            debitor,
            amount,
            memo.to_string(),
        );
    }

    #[event(history)]
    pub fn credited(
        ticker: AccountNumber,
        creditor: AccountNumber,
        debitor: AccountNumber,
        amount: i64,
        memo: String,
    ) {
    }
}

#[cfg(test)]
mod tests;
