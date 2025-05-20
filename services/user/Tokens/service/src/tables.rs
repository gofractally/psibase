#[psibase::service_tables]
pub mod tables {
    use async_graphql::SimpleObject;
    use psibase::services::nft::Wrapper as Nfts;
    use psibase::{check_some, AccountNumber, Quantity};
    use psibase::{services::nft::Wrapper, Fracpack, Table, ToKey, ToSchema};
    use serde::{Deserialize, Serialize};

    #[table(name = "InitTable", index = 0)]
    #[derive(Serialize, Deserialize, ToSchema, Fracpack, Debug)]
    pub struct InitRow {
        pub last_used_id: u64,
    }
    impl InitRow {
        #[primary_key]
        fn pk(&self) {}
    }

    #[table(name = "TokenTable", index = 1)]
    #[derive(Default, Fracpack, ToSchema, SimpleObject, Serialize, Deserialize, Debug)]
    pub struct Token {
        #[primary_key]
        pub id: u64,
        pub nft_id: u32,
        pub precision: u8,
        pub current_supply: u64,
        pub max_supply: u64,
    }

    impl Token {
        pub fn get(id: u64) -> Option<Self> {
            let token_table = TokenTable::new();
            token_table.get_index_pk().get(&id)
        }

        pub fn get_assert(id: u64) -> Self {
            check_some(Self::get(id), "failed to find token")
        }

        pub fn add(max_supply: Quantity) -> Self {
            let init_table = InitTable::new();
            let mut init_row = init_table.get_index_pk().get(&()).unwrap();
            let new_id = init_row.last_used_id.checked_add(1).expect("overflow");
            init_row.last_used_id = new_id;
            init_table.put(&init_row).expect("failed to save init_row");

            let token_table = TokenTable::new();

            let new_instance = Self {
                id: new_id,
                nft_id: Nfts::call().mint(),
                current_supply: 0,
                max_supply: max_supply.value,
                precision: max_supply.precision.value,
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
        pub token_id: u64,
        pub balance: u64,
    }

    impl Balance {
        #[primary_key]
        fn pk(&self) -> (AccountNumber, u64) {
            (self.account, self.token_id)
        }

        pub fn get(account: AccountNumber, token_id: u64) -> Balance {
            let table = BalanceTable::new();
            table
                .get_index_pk()
                .get(&(account, token_id))
                .unwrap_or_else(|| Balance {
                    account,
                    token_id,
                    balance: 0,
                })
        }

        fn save(&mut self) {
            let table = BalanceTable::new();
            table.put(&self).expect("failed to save balance");
        }

        fn quantity(&mut self) -> Quantity {
            let token = Token::get_assert(self.token_id);

            Quantity {
                value: self.balance,
                precision: token.precision.into(),
            }
        }

        fn add_balance(&mut self, quantity: Quantity) {
            let new_balance = (self.quantity() + quantity).expect("overflow");

            self.balance = new_balance.value;
            self.save();
        }

        fn sub_balance(&mut self, quantity: Quantity) {
            let new_balance = (self.quantity() - quantity).expect("underflow");
            self.balance = new_balance.value;
            self.save();
        }

        pub fn transfer(&mut self, to: AccountNumber, quantity: Quantity) {
            psibase::check(quantity.value > 0, "quantity must be greator than 0");
            self.sub_balance(quantity);
            if TokenHolder::is_manual_debit(to) {
                SharedBalance::get(self.account, to, self.token_id).add_balance(quantity);
            } else {
                Balance::get(to, self.token_id).add_balance(quantity);
            }
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
            let table = TokenHolderTable::new();
            let holder = table.get_index_pk().get(&account);
            holder.is_some_and(|holder| holder.manual_debit)
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
        pub token_id: u64,
        pub balance: u64,
    }

    impl SharedBalance {
        #[primary_key]
        fn pk(&self) -> (AccountNumber, AccountNumber, u64) {
            (self.creditor, self.debitor, self.token_id)
        }

        pub fn get(creditor: AccountNumber, debitor: AccountNumber, token_id: u64) -> Self {
            SharedBalanceTable::new()
                .get_index_pk()
                .get(&(creditor, debitor, token_id))
                .unwrap_or(Self {
                    balance: 0,
                    creditor,
                    debitor,
                    token_id,
                })
        }

        fn quantity(&mut self) -> Quantity {
            let token = Token::get_assert(self.token_id);

            Quantity {
                value: self.balance,
                precision: token.precision.into(),
            }
        }

        pub fn add_balance(&mut self, quantity: Quantity) {
            let new_balance = (self.quantity() + quantity).expect("overflow");

            self.balance = new_balance.value;
            self.save();
        }

        pub fn sub_balance(&mut self, quantity: Quantity) {
            let new_balance = (self.quantity() - quantity).expect("underflow");
            self.balance = new_balance.value;
            self.save();
        }

        pub fn transfer(&mut self, account: AccountNumber, amount: Quantity) {
            self.sub_balance(amount);
            psibase::check(
                account == self.creditor || account == self.debitor,
                "account can only be creditor or debitor",
            );
            Balance::get(account, self.token_id).add_balance(amount);
        }

        fn save(&mut self) {
            let table = SharedBalanceTable::new();
            table.put(&self);
        }
    }
}
