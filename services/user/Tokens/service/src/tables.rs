#[psibase::service_tables]
pub mod tables {
    use crate::flags::token_flags::TokenSetting;
    use crate::flags::token_holder_flags::TokenHolderFlags;

    use async_graphql::SimpleObject;
    use psibase::services::nft::action_structs::debit;
    use psibase::services::nft::Wrapper as Nfts;
    use psibase::{check, check_some, AccountNumber, Quantity};
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
        pub settings_value: u8,
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
                settings_value: TokenSetting::new().value,
            };

            token_table
                .put(&new_instance)
                .expect("failed to save token");

            new_instance
        }

        pub fn owner(&self) -> AccountNumber {
            Nfts::call().getNft(self.nft_id).owner
        }

        pub fn settings(&self) -> TokenSetting {
            TokenSetting::from(self.settings_value)
        }

        pub fn save_settings(&mut self, settings: TokenSetting) {
            self.settings_value = settings.value;
            self.save();
        }

        pub fn set_recallable(&mut self, recallable: bool) {
            check(recallable == false, "cannot re-enable recallable once set");
            let mut current_settings = self.settings();
            current_settings.set_is_unrecallable(recallable);

            self.save_settings(current_settings);
        }

        fn save(&mut self) {
            let table = TokenTable::new();
            table.put(&self).unwrap();
        }

        pub fn mint(&mut self, amount: Quantity, receiver: AccountNumber) {
            self.current_supply = self.current_supply + amount;
            psibase::check(self.current_supply <= self.max_supply, "over max supply");
            self.save();

            let mut user_balance = Balance::get(receiver, self.id);
            user_balance.add_balance(amount);
        }

        pub fn burn(&mut self, amount: Quantity, burnee: AccountNumber) {
            self.current_supply = self.current_supply - amount;
            self.save();

            let mut user_balance = Balance::get(burnee, self.id);
            user_balance.sub_balance(amount);
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
            table.put(&self).unwrap();
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

    #[table(name = "SharedBalanceTable", index = 3)]
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

            let is_auto_debit = TokenHolder::get(self.debitor, self.token_id)
                .map(|holder| holder.is_auto_debit())
                .unwrap_or(Holder::get(self.debitor).is_auto_debit());

            if is_auto_debit {
                self.debit(quantity);
            }
        }

        pub fn uncredit(&mut self, quantity: Quantity) {
            self.sub_balance(quantity);
            Balance::get(self.creditor, self.token_id).add_balance(quantity);
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

            if self.balance == 0.into() {
                let keep_zero_balance = TokenHolder::get(self.creditor, self.token_id)
                    .map(|token_holder| token_holder.is_keep_zero_balances())
                    .unwrap_or(Holder::get(self.creditor).is_keep_zero_balances());

                if keep_zero_balance {
                    self.save();
                } else {
                    self.delete();
                }
            } else {
                self.save();
            }
        }

        fn delete(&self) {
            SharedBalanceTable::new().erase(&(self.pk()));
        }

        fn save(&mut self) {
            let table = SharedBalanceTable::new();
            table.put(&self).unwrap();
        }
    }

    #[table(name = "HolderTable", index = 4)]
    #[derive(Serialize, Deserialize, ToSchema, Fracpack, Debug)]
    pub struct Holder {
        pub account: AccountNumber,
        pub flags: u8,
    }

    impl Holder {
        #[primary_key]
        fn pk(&self) -> AccountNumber {
            self.account
        }

        pub fn get(account: AccountNumber) -> Self {
            HolderTable::new()
                .get_index_pk()
                .get(&account)
                .unwrap_or(Self { account, flags: 0 })
        }

        pub fn is_auto_debit(&self) -> bool {
            self.settings().is_auto_debit()
        }

        pub fn set_auto_debit(&mut self, enabled: bool) {
            let mut settings = self.settings();
            settings.set_is_auto_debit(enabled);
            self.flags = settings.value;
            self.save();
        }

        pub fn is_keep_zero_balances(&self) -> bool {
            self.settings().is_keep_zero_balances()
        }

        pub fn set_keep_zero_balances(&mut self, enabled: bool) {
            let mut settings = self.settings();
            settings.set_is_keep_zero_balances(enabled);
            self.flags = settings.value;
            self.save();
        }

        fn settings(&self) -> TokenHolderFlags {
            TokenHolderFlags::from(self.flags)
        }

        fn save(&mut self) {
            let table = HolderTable::new();
            table.put(&self).unwrap();
        }
    }

    #[table(name = "TokenHolderTable", index = 5)]
    #[derive(Serialize, Deserialize, ToSchema, Fracpack, Debug)]
    pub struct TokenHolder {
        pub account: AccountNumber,
        pub token_id: u32,
        pub flags: u8,
    }

    impl TokenHolder {
        #[primary_key]
        fn pk(&self) -> (AccountNumber, u32) {
            (self.account, self.token_id)
        }

        pub fn get(account: AccountNumber, token_id: u32) -> Option<Self> {
            TokenHolderTable::new()
                .get_index_pk()
                .get(&(account, token_id))
        }

        pub fn is_auto_debit(&self) -> bool {
            self.settings().is_auto_debit()
        }

        pub fn set_auto_debit(&mut self, enabled: bool) {
            let mut settings = self.settings();
            settings.set_is_auto_debit(enabled);
            self.flags = settings.value;
            self.save();
        }

        pub fn is_keep_zero_balances(&self) -> bool {
            self.settings().is_keep_zero_balances()
        }

        pub fn set_keep_zero_balances(&mut self, enabled: bool) {
            let mut settings = self.settings();
            settings.set_is_keep_zero_balances(enabled);
            self.flags = settings.value;
            self.save();
        }

        fn settings(&self) -> TokenHolderFlags {
            TokenHolderFlags::from(self.flags)
        }

        fn save(&mut self) {
            let table = TokenHolderTable::new();
            table.put(&self).unwrap();
        }
    }
}
