#[psibase::service_tables]
pub mod tables {
    use std::collections::hash_set::Intersection;

    use async_graphql::SimpleObject;
    use psibase::{
        services::{
            accounts::Account,
            nft::{CreditRecord, NID},
            tokens::Quantity,
            transact,
        },
        AccountNumber, Fracpack, ServiceWrapper, Table, TimePointSec, TimePointUSec, ToSchema,
    };
    use serde::{Deserialize, Serialize};

    /// 3 structs,
    /// CreditLine, LocalBalance, Obligation...
    ///
    /// LocalBalances are always positive?
    ///

    #[table(name = "InitTable", index = 0)]
    #[derive(Serialize, Deserialize, ToSchema, Fracpack, Debug)]
    pub struct InitRow {}
    impl InitRow {
        #[primary_key]
        fn pk(&self) {}
    }

    #[table(name = "LocalBalanceTable", index = 1)]
    #[derive(Default, Fracpack, ToSchema, SimpleObject, Serialize, Deserialize, Debug)]
    pub struct LocalBalance {
        pub creditor: AccountNumber,
        pub debtor: AccountNumber,
        pub asset_id: u32,
        pub amount: Quantity,
    }

    impl LocalBalance {
        #[primary_key]
        fn pk(&self) -> (AccountNumber, AccountNumber, u32) {
            (self.creditor, self.debtor, self.asset_id)
        }
    }

    impl LocalBalance {
        pub fn get(creditor: AccountNumber, debtor: AccountNumber, asset_id: u32) -> Option<Self> {
            LocalBalanceTable::read()
                .get_index_pk()
                .get(&(creditor, debtor, asset_id))
        }

        pub fn get_assert(creditor: AccountNumber, debtor: AccountNumber, asset_id: u32) -> Self {
            Self::get(creditor, debtor, asset_id).expect("local balance not found")
        }
    }

    #[table(name = "RoutingPolicyTab", index = 2)]
    #[derive(Default, Fracpack, ToSchema, SimpleObject, Serialize, Deserialize, Debug)]
    pub struct RoutingPolicy {
        pub creditor: AccountNumber,
        pub debtor: AccountNumber,
        pub asset_id: u32,

        pub hop_fee_percent: u32,
    }

    impl RoutingPolicy {
        #[primary_key]
        fn pk(&self) {}
    }

    #[table(name = "ObligationTable", index = 3)]
    #[derive(Default, Fracpack, ToSchema, SimpleObject, Serialize, Deserialize, Debug)]
    pub struct Obligation {
        pub creditor: AccountNumber,
        pub debtor: AccountNumber,
        pub asset_id: u32,

        pub outstanding_amount: Quantity,
        pub remaining_principal: Quantity,
        pub accrued_interest: Quantity,
        pub created_at: TimePointSec,
        pub interest_rate: u32,
    }

    impl Obligation {
        pub fn get(creditor: AccountNumber, debtor: AccountNumber, asset_id: u32) -> Option<Self> {
            ObligationTable::read()
                .get_index_pk()
                .get(&(creditor, debtor, asset_id))
        }

        pub fn get_assert(creditor: AccountNumber, debtor: AccountNumber, asset_id: u32) -> Self {
            Self::get(creditor, debtor, asset_id).expect("obligation does not exist")
        }

        pub fn new(
            creditor: AccountNumber,
            debtor: AccountNumber,
            asset_id: u32,
            amount: Quantity,
            interest_rate: u32,
        ) -> Self {
            use psibase::services::transact::Wrapper as TransactSvc;
            Self {
                creditor,
                debtor,
                asset_id,
                outstanding_amount: amount,
                remaining_principal: amount,
                interest_rate,
                accrued_interest: 0.into(),
                created_at: TransactSvc::call().currentBlock().time.seconds(),
            }
        }
    }

    impl Obligation {
        #[primary_key]
        fn pk(&self) -> (AccountNumber, AccountNumber, u32) {
            (self.creditor, self.debtor, self.asset_id)
        }
    }

    #[table(name = "CreditLineTable", index = 4)]
    #[derive(Default, Fracpack, ToSchema, SimpleObject, Serialize, Deserialize, Debug)]
    pub struct CreditLine {
        pub creditor: AccountNumber,
        pub debtor: AccountNumber,
        pub asset_id: u32,

        pub limit: Quantity,
        pub deplete_on_debit: bool,

        pub interest_rate: u32,
        pub interest_free_seconds: u32,
    }

    impl CreditLine {
        #[primary_key]
        fn pk(&self) -> (AccountNumber, AccountNumber, u32) {
            (self.creditor, self.debtor, self.asset_id)
        }
    }

    impl CreditLine {
        fn save(&self) {
            CreditLineTable::read_write().put(&self).unwrap();
        }

        fn new(
            creditor: AccountNumber,
            debtor: AccountNumber,
            asset_id: u32,
            limit: Quantity,
            deplete_on_debit: bool,
            interest_rate: u32,
            interest_free_seconds: u32,
        ) -> Self {
            Self {
                creditor,
                debtor,
                asset_id,
                limit,
                deplete_on_debit,
                interest_rate,
                interest_free_seconds,
            }
        }

        pub fn get(creditor: AccountNumber, debtor: AccountNumber, asset_id: u32) -> Option<Self> {
            CreditLineTable::read()
                .get_index_pk()
                .get(&(creditor, debtor, asset_id))
        }

        pub fn get_assert(creditor: AccountNumber, debtor: AccountNumber, asset_id: u32) -> Self {
            Self::get(creditor, debtor, asset_id).expect("credit line not found")
        }

        pub fn upsert_credit_line(
            creditor: AccountNumber,
            debtor: AccountNumber,
            asset_id: u32,
            amount: Quantity,
            deplete_on_debit: bool,
            interest_rate: u32,
            interest_free_seconds: u32,
        ) {
            CreditLine::get(creditor, debtor, asset_id)
                .unwrap_or_else(|| {
                    CreditLine::new(
                        creditor,
                        debtor,
                        asset_id,
                        amount,
                        deplete_on_debit,
                        interest_rate,
                        interest_free_seconds,
                    )
                })
                .save();
        }

        pub fn debit(&mut self, amount: Quantity) {
            let mut obligation = Obligation::get(self.creditor, self.debtor, self.asset_id)
                .unwrap_or_else(|| {
                    Obligation::new(
                        self.creditor,
                        self.debtor,
                        self.asset_id,
                        amount,
                        self.interest_rate,
                    )
                });

            let new_obligation_amount = obligation
                .outstanding_amount
                .value
                .checked_add(amount.value)
                .expect("overflow");

            obligation.outstanding_amount = new_obligation_amount.into();
            assert!(
                new_obligation_amount <= self.limit.value,
                "debit exceeds credit line limit"
            );

            if self.deplete_on_debit {
                self.limit = self
                    .limit
                    .value
                    .checked_sub(amount.value)
                    .expect("insufficient credit line balance")
                    .into();
            }

            self.save();

            // we want to increase their local balance, no?
        }
    }
}

#[psibase::service(name = "banx", tables = "tables")]
pub mod service {
    use crate::tables::{CreditLine, InitRow, InitTable, LocalBalance, LocalBalanceTable};
    use psibase::{services::tokens::Quantity, *};

    #[action]
    fn init() {}

    #[action]
    fn extend_credit_line(
        creditor: AccountNumber,
        asset_id: u32,
        amount: Quantity,
        deplete_on_debit: bool,
        interest_rate: u32,
        interest_free_seconds: u32,
    ) {
        CreditLine::upsert_credit_line(
            creditor,
            get_sender(),
            asset_id,
            amount,
            deplete_on_debit,
            interest_rate,
            interest_free_seconds,
        );
    }

    #[action]
    fn debit(creditor: AccountNumber, asset_id: u32, amount: Quantity) {
        CreditLine::get_assert(creditor, get_sender(), asset_id).debit(amount);
    }

    #[pre_action(exclude(init))]
    fn check_init() {
        let table = InitTable::read();
        table.get_index_pk().get(&()).expect("service not inited");
    }

    #[action]
    #[allow(non_snake_case)]
    fn getLocalBalance() -> String {
        "".to_string()
    }

    #[event(history)]
    pub fn updated(old_thing: String, new_thing: String) {}
}

#[cfg(test)]
mod tests;
