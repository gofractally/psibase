#[psibase::service_tables]
pub mod tables {
    use async_graphql::SimpleObject;
    use psibase::services::nft::action_structs::debit;
    use psibase::services::nft::Wrapper as Nfts;
    use psibase::{check_some, AccountNumber, Quantity};
    use psibase::{services::nft::Wrapper, Fracpack, Table, ToKey, ToSchema};
    use serde::{Deserialize, Serialize};

    #[table(name = "InitTable", index = 0)]
    #[derive(Serialize, Deserialize, ToSchema, Fracpack, Debug)]
    pub struct InitRow {
        pub last_used_id: u32,
    }
    impl InitRow {
        #[primary_key]
        fn pk(&self) {}
    }

    #[table(name = "TokenTable", index = 1)]
    #[derive(Default, Fracpack, ToSchema, SimpleObject, Serialize, Deserialize, Debug)]
    pub struct Token {
        #[primary_key]
        pub id: u32,
        pub nft_id: u32,
        pub precision: u8,
        pub current_supply: Quantity,
        pub max_supply: Quantity,
    }

    impl Token {
        pub fn get(id: u32) -> Option<Self> {
            let token_table = TokenTable::new();
            token_table.get_index_pk().get(&id)
        }

        pub fn get_assert(id: u32) -> Self {
            check_some(Self::get(id), "failed to find token")
        }

        pub fn add(max_supply: Quantity, precision: u8) -> Self {
            let init_table = InitTable::new();
            let mut init_row = init_table.get_index_pk().get(&()).unwrap();
            let new_id = init_row.last_used_id.checked_add(1).unwrap();

            init_row.last_used_id = new_id;
            init_table.put(&init_row).expect("failed to save init_row");

            let token_table = TokenTable::new();

            let new_instance = Self {
                id: new_id,
                nft_id: Nfts::call().mint(),
                current_supply: 0.into(),
                max_supply,
                precision,
            };

            token_table
                .put(&new_instance)
                .expect("failed to save token");

            new_instance
        }
    }

    #[table(name = "BalanceTable", index = 2)]
    #[derive(Serialize, Deserialize, ToSchema, Fracpack, Debug)]
    pub struct Balance {
        pub account: AccountNumber,
        pub token_id: u32,
        pub balance: Quantity,
    }

    impl Balance {
        #[primary_key]
        fn pk(&self) -> (AccountNumber, u32) {
            (self.account, self.token_id)
        }

        pub fn get(account: AccountNumber, token_id: u32) -> Balance {
            let table = BalanceTable::new();
            table
                .get_index_pk()
                .get(&(account, token_id))
                .unwrap_or_else(|| Balance {
                    account,
                    token_id,
                    balance: 0.into(),
                })
        }

        fn save(&mut self) {
            let table = BalanceTable::new();
            table.put(&self).expect("failed to save balance");
        }

        fn add_balance(&mut self, quantity: Quantity) {
            self.balance = self.balance + quantity;
            self.save();
        }

        fn sub_balance(&mut self, quantity: Quantity) {
            self.balance = self.balance - quantity;
            self.save();
        }
    }

    #[table(name = "TokenHolderTable", index = 3)]
    #[derive(Serialize, Deserialize, ToSchema, Fracpack, Debug)]
    pub struct TokenHolder {
        pub account: AccountNumber,
        pub manual_debit: bool,
    }

    impl TokenHolder {
        #[primary_key]
        fn pk(&self) -> AccountNumber {
            self.account
        }

        pub fn is_manual_debit(account: AccountNumber) -> bool {
            TokenHolderTable::new()
                .get_index_pk()
                .get(&account)
                .is_some_and(|holder| holder.manual_debit)
        }

        pub fn set_manual_debit(account: AccountNumber, enabled: bool) {
            let new_instance = TokenHolder {
                account,
                manual_debit: enabled,
            };
            let table = TokenHolderTable::new();
            table
                .put(&new_instance)
                .expect("failed to save manual debit");
        }
    }

    #[table(name = "SharedBalanceTable", index = 4)]
    #[derive(Serialize, Deserialize, ToSchema, Fracpack, Debug)]
    pub struct SharedBalance {
        pub creditor: AccountNumber,
        pub debitor: AccountNumber,
        pub token_id: u32,
        pub balance: Quantity,
    }

    impl SharedBalance {
        #[primary_key]
        fn pk(&self) -> (AccountNumber, AccountNumber, u32) {
            (self.creditor, self.debitor, self.token_id)
        }

        pub fn get(creditor: AccountNumber, debitor: AccountNumber, token_id: u32) -> Self {
            SharedBalanceTable::new()
                .get_index_pk()
                .get(&(creditor, debitor, token_id))
                .unwrap_or(Self {
                    balance: 0.into(),
                    creditor,
                    debitor,
                    token_id,
                })
        }

        pub fn credit(&mut self, quantity: Quantity) {
            Balance::get(self.creditor, self.token_id).sub_balance(quantity);
            self.add_balance(quantity);
        }

        pub fn debit(&mut self, quantity: Quantity) {
            self.sub_balance(quantity);
            Balance::get(self.debitor, self.token_id).add_balance(quantity);
        }

        fn add_balance(&mut self, quantity: Quantity) {
            self.balance = self.balance + quantity;
            self.save();
        }

        fn sub_balance(&mut self, quantity: Quantity) {
            self.balance = self.balance - quantity;
            self.save();
        }

        fn save(&mut self) {
            let table = SharedBalanceTable::new();
            table.put(&self);
        }
    }
}
