#[psibase::service_tables]
pub mod tables {
    use crate::service::TID;
    use async_graphql::{ComplexObject, SimpleObject};
    use psibase::services::nft::{Wrapper as Nfts, NID};
    use psibase::services::tokens::{Decimal, Precision, Quantity};
    use psibase::{check, check_none, check_some, get_sender, AccountNumber};
    use psibase::{define_flags, Flags};
    use psibase::{Fracpack, Table, ToSchema};
    use serde::{Deserialize, Serialize};

    #[table(name = "InitTable", index = 0)]
    #[derive(Serialize, Deserialize, ToSchema, Fracpack, Debug)]
    pub struct InitRow {
        pub last_used_id: TID,
    }
    impl InitRow {
        #[primary_key]
        fn pk(&self) {}
    }

    #[table(name = "TokenTable", index = 1)]
    #[derive(Default, Fracpack, ToSchema, SimpleObject, Serialize, Deserialize, Debug)]
    #[graphql(complex)]
    pub struct Token {
        #[primary_key]
        pub id: TID,
        pub nft_id: NID,
        #[graphql(skip)]
        pub precision: u8,
        #[graphql(skip)]
        pub issued_supply: Quantity,
        #[graphql(skip)]
        pub burned_supply: Quantity,
        #[graphql(skip)]
        pub max_supply: Quantity,
        #[graphql(skip)]
        pub settings_value: u8,
        pub symbol: Option<AccountNumber>,
    }

    define_flags!(TokenFlags, u8, {
        unburnable,
        untransferable,
        unrecallable,
    });

    impl Token {
        #[secondary_key(1)]
        fn by_symbol(&self) -> (Option<AccountNumber>, TID) {
            (self.symbol, self.id)
        }

        pub fn get(id: TID) -> Option<Self> {
            TokenTable::new().get_index_pk().get(&id)
        }

        pub fn get_assert(id: TID) -> Self {
            check_some(Self::get(id), "failed to find token")
        }

        pub fn get_by_symbol(symbol: AccountNumber) -> Option<Self> {
            let mut tokens: Vec<Token> = TokenTable::new()
                .get_index_by_symbol()
                .range((Some(symbol), 0 as u32)..=(Some(symbol), u32::MAX))
                .collect();

            tokens.pop()
        }

        fn check_is_owner(&self, account: AccountNumber) {
            let holder = self.nft_holder();

            check(
                account == holder,
                &format!("{} does not hold the issuer NFT, {} does", account, holder),
            );
        }

        pub fn map_symbol(&mut self, symbol: AccountNumber) {
            check_none(self.symbol, "already has symbol");
            let sender = get_sender();
            self.check_is_owner(sender);
            self.symbol = Some(symbol);
            self.save();
        }

        pub fn add(max_supply: Quantity, precision: u8) -> Self {
            let init_table = InitTable::new();
            let mut init_row = init_table.get_index_pk().get(&()).unwrap();
            let new_id = init_row.last_used_id.checked_add(1).unwrap();

            init_row.last_used_id = new_id;
            init_table.put(&init_row).unwrap();

            let mut new_instance = Self {
                id: new_id,
                nft_id: Nfts::call().mint(),
                issued_supply: 0.into(),
                burned_supply: 0.into(),
                max_supply,
                precision: Precision::try_from(precision).unwrap().value,
                settings_value: 0,
                symbol: None,
            };

            new_instance.save();

            let creator = get_sender();

            if creator != crate::Wrapper::SERVICE {
                Nfts::call().credit(
                    new_instance.nft_id,
                    creator,
                    format!("NFT for token ID {}", new_instance.id),
                );
            }

            new_instance
        }

        pub fn nft_holder(&self) -> AccountNumber {
            Nfts::call().getNft(self.nft_id).owner
        }

        fn save(&mut self) {
            let table = TokenTable::new();
            table.put(&self).unwrap();
        }

        pub fn mint(&mut self, amount: Quantity) {
            let owner = get_sender();
            self.check_is_owner(owner);
            check(amount.value > 0, "mint quantity must be greater than 0");

            self.issued_supply = self.issued_supply + amount;
            psibase::check(
                self.issued_supply <= self.max_supply,
                "over max issued supply",
            );
            self.save();

            Balance::get_or_new(owner, self.id).add_balance(amount);
        }

        pub fn set_flag(&mut self, flag: TokenFlags, enabled: bool) {
            self.check_is_owner(get_sender());
            self.settings_value = Flags::new(self.settings_value).set(flag, enabled).value();
            self.save();
        }

        pub fn get_flag(&self, flag: TokenFlags) -> bool {
            Flags::new(self.settings_value).get(flag)
        }

        pub fn burn(&mut self, amount: Quantity) {
            self.burn_supply(amount, get_sender());
        }

        pub fn recall(&mut self, amount: Quantity, from: AccountNumber) {
            self.check_is_owner(get_sender());

            check(
                !self.get_flag(TokenFlags::UNRECALLABLE),
                "token is not recallable",
            );

            self.burn_supply(amount, from);
        }

        fn burn_supply(&mut self, amount: Quantity, from: AccountNumber) {
            check(amount.value > 0, "burn quantity must be greater than 0");
            self.burned_supply = self.burned_supply + amount;
            self.save();

            Balance::get_or_new(from, self.id).sub_balance(amount);
        }
    }

    #[ComplexObject]
    impl Token {
        pub async fn owner(&self) -> AccountNumber {
            self.nft_holder()
        }

        pub async fn precision(&self) -> Precision {
            self.precision.try_into().unwrap()
        }

        pub async fn current_supply(&self) -> Decimal {
            Decimal::new(
                self.issued_supply - self.burned_supply,
                self.precision.try_into().unwrap(),
            )
        }

        pub async fn issued_supply(&self) -> Decimal {
            Decimal::new(self.issued_supply, self.precision.try_into().unwrap())
        }

        pub async fn max_supply(&self) -> Decimal {
            Decimal::new(self.max_supply, self.precision.try_into().unwrap())
        }

        pub async fn settings(&self) -> TokenFlagsJson {
            TokenFlagsJson::from(Flags::new(self.settings_value))
        }

        pub async fn burned_supply(&self) -> Decimal {
            Decimal::new(self.burned_supply, self.precision.try_into().unwrap())
        }
    }

    #[table(name = "BalanceTable", index = 2)]
    #[derive(Serialize, Deserialize, ToSchema, Fracpack, Debug, SimpleObject)]
    #[graphql(complex)]
    pub struct Balance {
        pub account: AccountNumber,
        pub token_id: TID,
        #[graphql(skip)]
        pub balance: Quantity,
    }

    impl Balance {
        #[primary_key]
        fn pk(&self) -> (AccountNumber, TID) {
            (self.account, self.token_id)
        }

        fn new(account: AccountNumber, token_id: TID) -> Self {
            Token::get_assert(token_id);
            Self {
                account,
                token_id,
                balance: 0.into(),
            }
        }

        pub fn get(account: AccountNumber, token_id: TID) -> Option<Self> {
            BalanceTable::new().get_index_pk().get(&(account, token_id))
        }

        pub fn add(account: AccountNumber, token_id: TID) -> Self {
            check_none(Self::get(account, token_id), "balance already exists");
            let mut instance = Self::new(account, token_id);
            instance.save();
            instance
        }

        pub fn get_or_new(account: AccountNumber, token_id: TID) -> Self {
            Self::get(account, token_id).unwrap_or(Self::new(account, token_id))
        }

        fn save(&mut self) {
            let table = BalanceTable::new();
            table.put(&self).unwrap();
        }

        fn delete(&mut self) {
            BalanceTable::new().erase(&(&self.pk()));
        }

        fn add_balance(&mut self, quantity: Quantity) {
            self.balance = self.balance + quantity;
            self.save();
        }

        fn sub_balance(&mut self, quantity: Quantity) {
            self.balance = self.balance - quantity;

            if self.balance == 0.into() {
                let keep_zero_balance = BalanceConfig::get(self.account, self.token_id)
                    .map(|token_holder| {
                        token_holder.get_flag(BalanceConfigFlags::KEEP_ZERO_BALANCES)
                    })
                    .unwrap_or(false);

                if keep_zero_balance {
                    self.save();
                } else {
                    self.delete();
                }
            } else {
                self.save();
            }
        }
    }

    #[ComplexObject]
    impl Balance {
        pub async fn balance(&self) -> Decimal {
            Decimal::new(
                self.balance,
                Token::get_assert(self.token_id)
                    .precision
                    .try_into()
                    .unwrap(),
            )
        }
    }

    #[table(name = "SharedBalanceTable", index = 3)]
    #[derive(Fracpack, ToSchema, SimpleObject, Serialize, Deserialize, Debug, Clone)]
    #[graphql(complex)]
    pub struct SharedBalance {
        pub creditor: AccountNumber,
        pub debitor: AccountNumber,
        pub token_id: TID,
        #[graphql(skip)]
        pub balance: Quantity,
    }

    #[ComplexObject]
    impl SharedBalance {
        pub async fn token(&self) -> Token {
            TokenTable::with_service(crate::Wrapper::SERVICE)
                .get_index_pk()
                .get(&self.token_id)
                .unwrap()
        }

        pub async fn balance(&self) -> Decimal {
            Decimal::new(
                self.balance,
                TokenTable::with_service(crate::Wrapper::SERVICE)
                    .get_index_pk()
                    .get(&self.token_id)
                    .unwrap()
                    .precision
                    .try_into()
                    .unwrap(),
            )
        }
    }

    impl SharedBalance {
        #[primary_key]
        fn by_creditor(&self) -> (AccountNumber, AccountNumber, TID) {
            (self.creditor, self.debitor, self.token_id)
        }

        #[secondary_key(1)]
        fn by_debitor(&self) -> (AccountNumber, AccountNumber, TID) {
            (self.debitor, self.creditor, self.token_id)
        }

        fn new(creditor: AccountNumber, debitor: AccountNumber, token_id: TID) -> Self {
            Token::get_assert(token_id);
            check(
                creditor != debitor,
                format!("{} cannot be the creditor and debitor", creditor).as_str(),
            );
            Self {
                token_id,
                creditor,
                debitor,
                balance: 0.into(),
            }
        }

        pub fn get_or_new(creditor: AccountNumber, debitor: AccountNumber, token_id: TID) -> Self {
            SharedBalanceTable::new()
                .get_index_pk()
                .get(&(creditor, debitor, token_id))
                .unwrap_or(Self::new(creditor, debitor, token_id))
        }

        pub fn credit(&mut self, quantity: Quantity) {
            check(quantity.value > 0, "credit quantity must be greater than 0");

            Balance::get_or_new(self.creditor, self.token_id).sub_balance(quantity);
            self.add_balance(quantity);

            let token = Token::get_assert(self.token_id);
            check(
                !token.get_flag(TokenFlags::UNTRANSFERABLE),
                "token is untransferable",
            );

            let is_auto_debit = BalanceConfig::get(self.debitor, self.token_id)
                .map(|holder| holder.get_flag(BalanceConfigFlags::AUTO_DEBIT))
                .unwrap_or(false);

            if is_auto_debit {
                self.debit(quantity, "Autodebit".to_string());
            }
        }

        pub fn uncredit(&mut self, quantity: Quantity) {
            check(
                quantity.value > 0,
                "uncredit quantity must be greater than 0",
            );

            self.sub_balance(quantity);
            Balance::get_or_new(self.creditor, self.token_id).add_balance(quantity);
        }

        pub fn debit(&mut self, quantity: Quantity, memo: String) {
            check(quantity.value > 0, "debit quantity must be greater than 0");

            crate::Wrapper::emit().history().debited(
                self.token_id,
                self.creditor,
                self.debitor,
                quantity,
                memo,
            );
            self.sub_balance(quantity);
            Balance::get_or_new(self.debitor, self.token_id).add_balance(quantity);
        }

        fn add_balance(&mut self, quantity: Quantity) {
            self.balance = self.balance + quantity;
            self.save();
        }

        fn sub_balance(&mut self, quantity: Quantity) {
            self.balance = self.balance - quantity;

            if self.balance == 0.into() {
                let keep_zero_balance = BalanceConfig::get(self.creditor, self.token_id)
                    .map(|token_holder| {
                        token_holder.get_flag(BalanceConfigFlags::KEEP_ZERO_BALANCES)
                    })
                    .unwrap_or(false);

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
            SharedBalanceTable::new().erase(&(self.by_creditor()));
        }

        fn save(&mut self) {
            let table = SharedBalanceTable::new();
            table.put(&self).unwrap();
        }
    }

    #[table(name = "BalanceConfigTable", index = 4)]
    #[derive(Serialize, Deserialize, ToSchema, Fracpack, Debug)]
    pub struct BalanceConfig {
        pub account: AccountNumber,
        pub token_id: TID,
        pub flags: u8,
    }

    define_flags!(BalanceConfigFlags, u8, {
        auto_debit,
        keep_zero_balances,
    });

    impl BalanceConfig {
        #[primary_key]
        fn pk(&self) -> (AccountNumber, TID) {
            (self.account, self.token_id)
        }

        fn new(account: AccountNumber, token_id: TID) -> Self {
            Self {
                account,
                token_id,
                flags: 0,
            }
        }

        fn get(account: AccountNumber, token_id: TID) -> Option<Self> {
            BalanceConfigTable::new()
                .get_index_pk()
                .get(&(account, token_id))
        }

        pub fn get_or_new(account: AccountNumber, token_id: TID) -> Self {
            Self::get(account, token_id).unwrap_or(Self::new(account, token_id))
        }

        pub fn set_flag(&mut self, flag: BalanceConfigFlags, enabled: bool) {
            self.flags = Flags::new(self.flags).set(flag, enabled).value();
            self.save();
        }

        pub fn get_flag(&self, flag: BalanceConfigFlags) -> bool {
            Flags::new(self.flags).get(flag)
        }

        fn delete(&self) {
            BalanceConfigTable::new().erase(&(self.pk()));
        }

        fn put(&mut self) {
            BalanceConfigTable::new().put(&self).unwrap();
        }

        fn save(&mut self) {
            if self.flags == 0 {
                self.delete();
            } else {
                self.put();
            }
        }
    }
}
