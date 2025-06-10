#[psibase::service_tables]
pub mod tables {
    use crate::flags::token_flags::TokenSetting;
    use crate::flags::token_holder_flags::TokenHolderFlags;

    use async_graphql::SimpleObject;
    use psibase::services::nft::Wrapper as Nfts;
    use psibase::{check, check_some, get_sender, AccountNumber, Quantity};
    use psibase::{Fracpack, Table, ToSchema};
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

        pub fn check_owner_is_sender(&self) {
            check(get_sender() == self.nft_holder(), "must own token NFT");
        }

        pub fn add(max_supply: Quantity, precision: u8) -> Self {
            let init_table = InitTable::new();
            let mut init_row = init_table.get_index_pk().get(&()).unwrap();
            let new_id = init_row.last_used_id.checked_add(1).unwrap();

            init_row.last_used_id = new_id;
            init_table.put(&init_row).expect("failed to save init_row");

            let mut new_instance = Self {
                id: new_id,
                nft_id: Nfts::call().mint(),
                current_supply: 0.into(),
                max_supply,
                precision,
                settings_value: TokenSetting::new().value,
            };

            new_instance.save();

            new_instance
        }

        fn nft_holder(&self) -> AccountNumber {
            Nfts::call().getNft(self.nft_id).owner
        }

        pub fn settings(&self) -> TokenSetting {
            TokenSetting::from(self.settings_value)
        }

        fn save_settings(&mut self, settings: TokenSetting) {
            self.settings_value = settings.value;
            self.save();
        }

        pub fn disable_recallability(&mut self) {
            let mut current_settings = self.settings();
            current_settings.set_is_unrecallable(true);
            self.save_settings(current_settings);
        }

        pub fn disable_burnability(&mut self) {
            let mut current_settings = self.settings();
            current_settings.set_is_unburnable(true);
            self.save_settings(current_settings);
        }

        pub fn disable_transferability(&mut self) {
            let mut current_settings = self.settings();
            current_settings.set_is_untransferable(true);
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

            Balance::get_or_default(receiver, self.id).add_balance(amount);
        }

        pub fn burn(&mut self, amount: Quantity, burnee: AccountNumber) {
            self.current_supply = self.current_supply - amount;
            self.save();

            Balance::get_or_default(burnee, self.id).sub_balance(amount);
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

        pub fn get_or_default(account: AccountNumber, token_id: u32) -> Balance {
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

        pub fn get_or_default(
            creditor: AccountNumber,
            debitor: AccountNumber,
            token_id: u32,
        ) -> Self {
            check(creditor != debitor, "creditor cannot also be debitor");
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
            Balance::get_or_default(self.creditor, self.token_id).sub_balance(quantity);
            self.add_balance(quantity);

            let token = Token::get_assert(self.token_id);
            check(
                !token.settings().is_untransferable(),
                "token is untransferable",
            );

            let is_auto_debit = TokenHolder::get(self.debitor, self.token_id)
                .map(|holder| holder.is_auto_debit())
                .unwrap_or(Holder::get_or_default(self.debitor).is_auto_debit());

            if is_auto_debit {
                self.debit(quantity);
            }
        }

        pub fn uncredit(&mut self, quantity: Quantity) {
            self.sub_balance(quantity);
            Balance::get_or_default(self.creditor, self.token_id).add_balance(quantity);
        }

        pub fn debit(&mut self, quantity: Quantity) {
            crate::Wrapper::emit().history().debited(
                self.token_id,
                self.creditor,
                self.debitor,
                "Autodebit".to_string(),
            );
            self.sub_balance(quantity);
            Balance::get_or_default(self.debitor, self.token_id).add_balance(quantity);

            let token = Token::get_assert(self.token_id);
            check(
                !token.settings().is_untransferable(),
                "token is untransferable",
            );
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
                    .unwrap_or(Holder::get_or_default(self.creditor).is_keep_zero_balances());

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

        pub fn get_or_default(account: AccountNumber) -> Self {
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

        pub fn get_or_default(account: AccountNumber, token_id: u32) -> Self {
            Self::get(account, token_id).unwrap_or(Self {
                account,
                flags: 0,
                token_id,
            })
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
