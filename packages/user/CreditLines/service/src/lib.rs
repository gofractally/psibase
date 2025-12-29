use psibase::{check, AccountNumber};

pub fn sort_accounts(a: AccountNumber, b: AccountNumber) -> (AccountNumber, AccountNumber) {
    check(a.value != b.value, "both items are the same");
    if a.value < b.value {
        (a, b)
    } else {
        (b, a)
    }
}

#[psibase::service_tables]
pub mod tables {
    use async_graphql::{ComplexObject, SimpleObject};
    use psibase::{
        check, check_none, check_some, get_sender, services::tokens::Precision, AccountNumber,
        Fracpack, Memo, Table, ToSchema,
    };

    use serde::{Deserialize, Serialize};

    use crate::sort_accounts;

    #[table(name = "ConfigTable", index = 0)]
    #[derive(Serialize, Deserialize, ToSchema, Fracpack, Debug)]
    pub struct Config {
        last_used_draft_id: u32,
    }

    impl Config {
        #[primary_key]
        fn pk(&self) {}

        pub fn next_id() -> u32 {
            let table = ConfigTable::read_write();
            let mut config = check_some(
                table.get_index_pk().get(&()),
                "config row not found, service not initialized",
            );
            let next_id = check_some(
                config.last_used_draft_id.checked_add(1),
                "draft id overflow",
            );
            config.last_used_draft_id = next_id;
            table.put(&config).unwrap();
            next_id
        }

        pub fn get() -> Option<Self> {
            ConfigTable::read().get_index_pk().get(&())
        }

        pub fn add() {
            check_none(Config::get(), "config row already exists");
            let table = ConfigTable::read_write();
            let config = Config {
                last_used_draft_id: 0,
            };
            table.put(&config).unwrap();
        }
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

    #[table(name = "PendingCreditTable", index = 2)]
    #[derive(Default, Fracpack, ToSchema, SimpleObject, Serialize, Deserialize, Debug)]
    pub struct PendingCredit {
        #[primary_key]
        pub id: u32,
        pub ticker: AccountNumber,
        pub creditor: AccountNumber,
        pub debitor: AccountNumber,
        pub balance: i64,
        pub author: AccountNumber,
        pub memo: Memo,
    }

    impl PendingCredit {
        #[secondary_key(1)]
        fn by_creditor(&self) -> (AccountNumber, AccountNumber, u32) {
            (self.creditor, self.debitor, self.id)
        }

        #[secondary_key(2)]
        fn by_debitor(&self) -> (AccountNumber, AccountNumber, u32) {
            (self.debitor, self.creditor, self.id)
        }

        fn new(
            ticker: AccountNumber,
            creditor: AccountNumber,
            debitor: AccountNumber,
            balance: i64,
            memo: Memo,
        ) -> Self {
            check(balance > 0, "balance must be positive");
            Self {
                id: Config::next_id(),
                author: get_sender(),
                ticker,
                creditor,
                debitor,
                balance,
                memo,
            }
        }

        pub fn get(id: u32) -> Option<Self> {
            PendingCreditTable::read().get_index_pk().get(&id)
        }

        pub fn get_assert(id: u32) -> Self {
            check_some(PendingCredit::get(id), "draft not found")
        }

        pub fn add(
            ticker: AccountNumber,
            creditor: AccountNumber,
            debitor: AccountNumber,
            balance: i64,
            memo: Memo,
        ) -> Self {
            let pending_credit = Self::new(ticker, creditor, debitor, balance, memo);
            pending_credit.save();
            pending_credit
        }

        pub fn accept(&mut self) {
            // A pending credit can be created by either party.
            // If it was the debitor who created it, it means he's applying for a loan, so only the creditor can accept.
            // If it was the creditor who created it, it means he's offering a loan, so only the debitor can accept.

            let sender = get_sender();
            if self.author == self.creditor {
                check(
                    sender == self.debitor,
                    "only debitor can accept the pending credit",
                );
            } else {
                check(
                    sender == self.creditor,
                    "only creditor can accept the pending credit",
                );
            }
            CreditLine::get_or_add(self.ticker, self.creditor, self.debitor).credit_counter_party(
                self.creditor,
                self.balance,
                true,
            );
            self.erase();
        }

        pub fn cancel(&self) {
            check(
                get_sender() == self.author,
                "only author can cancel the draft",
            );
            self.erase();
        }

        fn erase(&self) {
            PendingCreditTable::read_write().erase(&self.id);
        }

        fn save(&self) {
            PendingCreditTable::read_write().put(&self).unwrap()
        }
    }

    impl CreditLine {
        #[primary_key]
        fn pk(&self) -> (AccountNumber, AccountNumber, AccountNumber) {
            (self.ticker, self.account_a, self.account_b)
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
            let (a, b) = sort_accounts(a, b);
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

        fn counter_party(&self, account: AccountNumber) -> AccountNumber {
            self.check_is_party(account);
            if account == self.account_a {
                self.account_b
            } else {
                self.account_a
            }
        }

        fn add(ticker: AccountNumber, a: AccountNumber, b: AccountNumber) -> Self {
            let (a, b) = sort_accounts(a, b);
            let new_instance = Self::new(ticker, a, b);
            new_instance.save();
            CreditRelation::add_bidirect(ticker, a, b);
            new_instance
        }

        pub fn get_or_add(ticker: AccountNumber, a: AccountNumber, b: AccountNumber) -> Self {
            let (a, b) = sort_accounts(a, b);

            Self::get(ticker, a, b).unwrap_or_else(|| Self::add(ticker, a, b))
        }

        pub fn get_assert(ticker: AccountNumber, a: AccountNumber, b: AccountNumber) -> Self {
            check_some(
                Self::get(ticker, a, b),
                "credit line not found between the two accounts for the given ticker",
            )
        }

        pub fn remove(&self) {
            check(
                self.balance == 0,
                "cannot remove non-zero balance credit line",
            );
            check(
                self.max_credit_limit_by_a == 0,
                "cannot remove credit line with non-zero credit limit for account A",
            );
            check(
                self.max_credit_limit_by_b == 0,
                "cannot remove credit line with non-zero credit limit for account B",
            );
            self.erase();
            CreditRelation::remove_bidirect(self.ticker, self.account_a, self.account_b);
        }

        pub fn set_credit_limit(&mut self, creditor: AccountNumber, credit_limit: i64) {
            check(credit_limit >= 0, "credit limit must be 0 or above");

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
            let creditor = self.counter_party(debitor);
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
                let is_expanding_debt = balance_to_check < self.balance;
                if is_expanding_debt {
                    check(
                        balance_to_check.abs() <= self.max_credit_limit_by_b,
                        "breaches max limit",
                    )
                }
            }
        }

        fn erase(&self) {
            CreditLineTable::read_write().erase(&self.pk());
        }

        fn save(&self) {
            CreditLineTable::read_write().put(&self).unwrap()
        }
    }

    #[ComplexObject]
    impl CreditLine {
        async fn creditor(&self) -> Option<AccountNumber> {
            if self.balance == 0 {
                return None;
            }

            if self.balance > 0 {
                Some(self.account_a)
            } else {
                Some(self.account_b)
            }
        }

        async fn debitor(&self) -> Option<AccountNumber> {
            if self.balance == 0 {
                return None;
            }

            if self.balance > 0 {
                Some(self.account_b)
            } else {
                Some(self.account_a)
            }
        }
    }

    #[table(name = "CreditRelationTable", index = 3)]
    #[derive(Default, Fracpack, ToSchema, SimpleObject, Serialize, Deserialize, Debug)]
    #[graphql(complex)]
    pub struct CreditRelation {
        pub account: AccountNumber,
        pub ticker: AccountNumber,
        pub counter_party: AccountNumber,
    }

    impl CreditRelation {
        #[primary_key]
        fn pk(&self) -> (AccountNumber, AccountNumber, AccountNumber) {
            (self.account, self.ticker, self.counter_party)
        }

        pub fn new(
            account: AccountNumber,
            ticker: AccountNumber,
            counter_party: AccountNumber,
        ) -> Self {
            Self {
                account,
                ticker,
                counter_party,
            }
        }

        fn add(
            account: AccountNumber,
            ticker: AccountNumber,
            counter_party: AccountNumber,
        ) -> Self {
            let new_instance = Self::new(account, ticker, counter_party);
            new_instance.save();
            new_instance
        }

        pub fn add_bidirect(ticker: AccountNumber, a: AccountNumber, b: AccountNumber) {
            Self::add(a, ticker, b);
            Self::add(b, ticker, a);
        }

        pub fn remove_bidirect(ticker: AccountNumber, a: AccountNumber, b: AccountNumber) {
            CreditRelationTable::read_write().erase(&(a, ticker, b));
            CreditRelationTable::read_write().erase(&(b, ticker, a));
        }

        fn save(&self) {
            CreditRelationTable::read_write().put(&self).unwrap()
        }
    }

    #[ComplexObject]
    impl CreditRelation {
        async fn credit_line(&self) -> Option<CreditLine> {
            CreditLine::get(self.ticker, self.account, self.counter_party)
        }
    }

    #[table(name = "TickerTable", index = 4)]
    #[derive(Fracpack, ToSchema, SimpleObject, Serialize, Deserialize, Debug)]
    pub struct Ticker {
        #[primary_key]
        pub ticker: AccountNumber,
        pub label: Memo,
        pub precision: Precision,
    }

    impl Ticker {
        fn new(ticker: AccountNumber, label: Memo, precision: Precision) -> Self {
            Self {
                ticker,
                label,
                precision,
            }
        }

        pub fn get(ticker: AccountNumber) -> Option<Self> {
            TickerTable::read().get_index_pk().get(&ticker)
        }

        pub fn check_exists(ticker: AccountNumber) {
            check_some(Self::get(ticker), "ticker does not exist");
        }

        pub fn add(ticker: AccountNumber, label: Memo, precision: Precision) -> Self {
            check_none(Self::get(ticker), "ticker already exists");
            let new_instance = Self::new(ticker, label, precision);
            new_instance.save();
            new_instance
        }

        fn save(&self) {
            TickerTable::read_write().put(&self).unwrap()
        }
    }
}

#[psibase::service(name = "credit-lines", tables = "tables")]
pub mod service {
    use std::collections::HashSet;

    use crate::tables::{Config, CreditLine, PendingCredit, Ticker};
    use psibase::{services::tokens::Precision, *};

    #[action]
    fn init() {
        if Config::get().is_some() {
            return;
        }

        Config::add();
        let new_ticker = |tick: &str, label: &str, precision: u8| {
            Ticker::add(
                AccountNumber::from(tick),
                Memo::from(label),
                precision.try_into().unwrap(),
            );
        };
        new_ticker("gbp", "British Pound", 2);
        new_ticker("usd", "United States Dollar", 2);
        new_ticker("aud", "Australian Dollar", 2);
        new_ticker("eur", "Euro", 2);
        new_ticker("jpy", "Japanese Yen", 0);
        new_ticker("cny", "Chinese Yuan", 2);
        new_ticker("cad", "Canadian Dollar", 2);
        new_ticker("btc", "Bitcoin", 8);
    }

    #[pre_action(exclude(init))]
    fn check_init() {
        check_some(Config::get(), "service not inited");
    }

    #[action]
    fn add_ticker(ticker: AccountNumber, label: Memo, precision: Precision) {
        Ticker::add(ticker, label, precision);
    }

    #[action]
    fn set_crd_lim(ticker: AccountNumber, counter_party: AccountNumber, max_credit: i64) {
        Ticker::check_exists(ticker);
        let sender = get_sender();
        CreditLine::get_or_add(ticker, sender, counter_party).set_credit_limit(sender, max_credit);
    }

    #[action]
    fn del_line(ticker: AccountNumber, counter_party: AccountNumber) {
        CreditLine::get_assert(ticker, get_sender(), counter_party).remove();
    }

    #[action]
    fn new_pen_cred(
        ticker: AccountNumber,
        creditor: AccountNumber,
        debitor: AccountNumber,
        amount: i64,
        memo: Memo,
    ) {
        Ticker::check_exists(ticker);
        let sender = get_sender();
        check(
            sender == creditor || sender == debitor,
            "only the creditor or debitor can create a pending credit between each other",
        );
        check(debitor != creditor, "creditor cannot be debitor");
        PendingCredit::add(ticker, creditor, debitor, amount, memo);
    }

    #[action]
    fn accept_pen(proposal_id: u32) {
        PendingCredit::get_assert(proposal_id).accept();
    }

    #[action]
    fn cancel_pen(proposal_id: u32) {
        PendingCredit::get_assert(proposal_id).cancel();
    }

    #[action]
    fn draw(ticker: AccountNumber, creditors: Vec<AccountNumber>, amount: i64, memo: Memo) {
        Ticker::check_exists(ticker);
        let debitor = get_sender();
        let mut current_debitor = debitor;

        // Alice wants to owe Edward
        // Edward trusts Charlie, Charlie trusts Bob, Bob trusts Alice
        // So Alice draws on Bob, Bob draws on Charlie, Charlie draws on Edward

        // 1. Alice debitor draws on Bob creditor
        // 2. Bob debitor draws on Charlie creditor
        // 3. Charlie debitor draws on Edward creditor

        let mut seen = HashSet::new();
        for creditor in creditors.clone() {
            check(seen.insert(creditor), "duplicate creditor in list");
            CreditLine::get_assert(ticker, current_debitor, creditor).draw(current_debitor, amount);
            current_debitor = creditor;
        }

        crate::Wrapper::emit().history().credited(
            ticker,
            creditors
                .into_iter()
                .map(|a| a.to_string())
                .collect::<Vec<_>>()
                .join(", ")
                .to_string(),
            amount,
            memo.to_string(),
        );
    }

    #[event(history)]
    pub fn credited(ticker: AccountNumber, parties: String, amount: i64, memo: String) {}
}

#[cfg(test)]
mod tests;
