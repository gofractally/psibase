#[psibase::service_tables]
pub mod tables {
    use crate::service::{fmt_amount, TID};
    use async_graphql::{ComplexObject, SimpleObject};
    use psibase::services::nft::{Wrapper as Nfts, NID};
    use psibase::services::tokens::{Decimal, Precision, Quantity};
    use psibase::{
        abort_message, check, check_none, check_some, get_sender, AccountNumber, Memo, TableRecord,
    };
    use psibase::{define_flags, Flags};
    use psibase::{Fracpack, Table, ToSchema};
    use serde::{Deserialize, Serialize};

    #[table(name = "InitTable", index = 0)]
    #[derive(Serialize, Deserialize, ToSchema, Fracpack, Debug)]
    pub struct InitRow {
        pub last_used_id: TID,
        pub last_used_shared_bal_id: u64,
        pub last_used_subaccount_id: u64,
    }
    impl InitRow {
        #[primary_key]
        fn pk(&self) {}
    }
    impl InitRow {
        fn new() -> Self {
            Self {
                last_used_id: 0,
                last_used_shared_bal_id: 0,
                last_used_subaccount_id: 0,
            }
        }

        pub fn get() -> Option<Self> {
            InitTable::read().get_index_pk().get(&())
        }

        pub fn get_assert() -> Self {
            check_some(Self::get(), "init row does not exist")
        }

        pub fn init() {
            check_none(Self::get(), "init row already exists");
            Self::new().save();
        }

        pub fn next_token_id() -> TID {
            let mut init_row = InitRow::get_assert();

            let next_id = check_some(
                init_row.last_used_id.checked_add(1),
                "last_used_id overflowed",
            );
            init_row.last_used_id = next_id;
            init_row.save();
            next_id
        }

        pub fn next_subaccount_id() -> u64 {
            let mut init_row = InitRow::get_assert();

            let next_id = check_some(
                init_row.last_used_subaccount_id.checked_add(1),
                "last_used_subaccount_id overflowed",
            );
            init_row.last_used_subaccount_id = next_id;
            init_row.save();

            next_id
        }

        pub fn next_shared_bal_id() -> u64 {
            let mut init_row = InitRow::get_assert();

            let next_id = check_some(
                init_row.last_used_shared_bal_id.checked_add(1),
                "last_used_shared_bal_id overflowed",
            );
            init_row.last_used_shared_bal_id = next_id;
            init_row.save();
            next_id
        }

        fn save(&self) {
            InitTable::read_write().put(&self).unwrap();
        }
    }

    #[table(name = "TokenTable", index = 1)]
    #[derive(Fracpack, ToSchema, SimpleObject, Serialize, Deserialize, Debug)]
    #[graphql(complex)]
    pub struct Token {
        #[primary_key]
        pub id: TID,
        pub nft_id: NID,
        #[graphql(skip)]
        pub settings_value: u8,
        pub precision: Precision,
        #[graphql(skip)]
        pub issued_supply: Quantity,
        #[graphql(skip)]
        pub burned_supply: Quantity,
        #[graphql(skip)]
        pub max_issued_supply: Quantity,
    }

    define_flags!(TokenFlags, u8, {
        untransferable,
        unrecallable,
    });

    impl Token {
        fn new(precision: Precision, max_issued_supply: Quantity) -> Self {
            Self {
                id: InitRow::next_token_id(),
                nft_id: Nfts::call().mint(),
                issued_supply: 0.into(),
                burned_supply: 0.into(),
                max_issued_supply,
                precision,
                settings_value: 0,
            }
        }

        pub fn get(id: TID) -> Option<Self> {
            TokenTable::read().get_index_pk().get(&id)
        }

        pub fn get_assert(id: TID) -> Self {
            check_some(Self::get(id), "Token DNE")
        }

        pub fn get_by_symbol(symbol: AccountNumber) -> Option<Self> {
            let mapping = psibase::services::symbol::Wrapper::call().getMapBySym(symbol)?;
            Self::get(mapping.tokenId)
        }

        fn check_is_owner(&self, account: AccountNumber) {
            let holder = self.nft_holder();

            check(account == holder, "Missing required authority");
        }

        pub fn add(precision: Precision, max_issued_supply: Quantity) -> Self {
            let new_instance = Token::new(precision, max_issued_supply);
            new_instance.save();

            let creator = get_sender();

            if creator != crate::Wrapper::SERVICE {
                Nfts::call().credit(
                    new_instance.nft_id,
                    creator,
                    format!("NFT for token ID {}", new_instance.id)
                        .as_str()
                        .into(),
                );
            }

            new_instance
        }

        pub fn nft_holder(&self) -> AccountNumber {
            Nfts::call().getNft(self.nft_id).owner
        }

        fn save(&self) {
            TokenTable::read_write().put(&self).unwrap();
        }

        pub fn mint(&mut self, amount: Quantity) {
            let owner = get_sender();
            self.check_is_owner(owner);
            check(amount.value > 0, "mint quantity must be greater than 0");

            self.issued_supply = self.issued_supply + amount;
            psibase::check(
                self.issued_supply <= self.max_issued_supply,
                "Max issued supply exceeded",
            );
            self.save();

            Balance::get_or_new(owner, self.id).add_balance(amount);
        }

        pub fn set_flag(&mut self, flag: TokenFlags, enabled: bool) {
            self.check_is_owner(get_sender());
            if flag == TokenFlags::UNRECALLABLE {
                check(enabled, "Invalid configuration update")
            }
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
                "Token unrecallable",
            );

            self.burn_supply(amount, from);
        }

        fn burn_supply(&mut self, amount: Quantity, from: AccountNumber) {
            check(amount.value > 0, "burn quantity must be greater than 0");

            Balance::get_or_new(from, self.id).sub_balance(amount);
            self.burned_supply = self.burned_supply + amount;
            self.save();
        }
    }

    #[ComplexObject]
    impl Token {
        pub async fn owner(&self) -> AccountNumber {
            self.nft_holder()
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

        pub async fn max_issued_supply(&self) -> Decimal {
            Decimal::new(self.max_issued_supply, self.precision.try_into().unwrap())
        }

        pub async fn settings(&self) -> TokenFlagsJson {
            TokenFlagsJson::from(Flags::new(self.settings_value))
        }

        pub async fn burned_supply(&self) -> Decimal {
            Decimal::new(self.burned_supply, self.precision.try_into().unwrap())
        }

        pub async fn symbol(&self) -> Option<AccountNumber> {
            psibase::services::symbol::Wrapper::call()
                .getByToken(self.id)
                .map(|s| s.symbolId)
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
            BalanceTable::read()
                .get_index_pk()
                .get(&(account, token_id))
        }

        pub fn get_assert(account: AccountNumber, token_id: TID) -> Self {
            check_some(
                Self::get(account, token_id),
                &format!("{} has no balance of token ID {}", account, token_id),
            )
        }

        pub fn get_or_new(account: AccountNumber, token_id: TID) -> Self {
            Self::get(account, token_id).unwrap_or(Self::new(account, token_id))
        }

        fn save(&self) {
            BalanceTable::read_write().put(&self).unwrap();
        }

        fn delete(&self) {
            BalanceTable::read_write().erase(&(&self.pk()));
        }

        pub fn add_balance(&mut self, quantity: Quantity) {
            self.balance = self.balance + quantity;
            self.save();
        }

        pub fn sub_balance(&mut self, quantity: Quantity) {
            if self.balance < quantity {
                let p = Token::get_assert(self.token_id).precision;
                abort_message(&format!(
                    "{} has insufficient balance (tid {}): {} < {}",
                    self.account.to_string(),
                    self.token_id,
                    Decimal::new(self.balance, p),
                    Decimal::new(quantity, p)
                ));
            }
            self.balance = self.balance - quantity;

            if self.balance == 0.into() {
                let keep_zero_balance = BalanceConfig::get(self.account, self.token_id)
                    .map(|token_holder| token_holder.get_flag(BalanceFlags::KEEP_ZERO_BALANCES))
                    .unwrap_or(
                        UserConfig::get_or_new(self.account)
                            .get_flag(BalanceFlags::KEEP_ZERO_BALANCES),
                    );

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
            Decimal::new(self.balance, Token::get_assert(self.token_id).precision)
        }

        pub async fn settings(&self) -> BalanceFlagsJson {
            let flag = BalanceConfig::get(self.account, self.token_id)
                .map(|bal| bal.flags)
                .unwrap_or(UserConfig::get_or_new(self.account).flags);

            BalanceFlagsJson::from(Flags::new(flag))
        }

        pub async fn symbol(&self) -> Option<AccountNumber> {
            psibase::services::symbol::Wrapper::call()
                .getByToken(self.token_id)
                .map(|s| s.symbolId)
        }

        pub async fn precision(&self) -> Precision {
            Token::get_assert(self.token_id)
                .precision
                .try_into()
                .unwrap()
        }
    }

    #[table(name = "SharedBalanceTable", index = 3)]
    #[derive(Fracpack, ToSchema, SimpleObject, Serialize, Deserialize, Debug, Clone)]
    #[graphql(complex)]
    pub struct SharedBalance {
        #[primary_key]
        #[graphql(skip)]
        pub shared_bal_id: u64,
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

        pub async fn symbol(&self) -> Option<AccountNumber> {
            psibase::services::symbol::Wrapper::call()
                .getByToken(self.token_id)
                .map(|s| s.symbolId)
        }

        pub async fn precision(&self) -> Precision {
            Token::get_assert(self.token_id)
                .precision
                .try_into()
                .unwrap()
        }
    }

    impl SharedBalance {
        fn new(creditor: AccountNumber, debitor: AccountNumber, token_id: TID) -> Self {
            Token::get_assert(token_id);
            check(
                creditor != debitor,
                format!("Sender {} cannot also be receiver", creditor).as_str(),
            );

            Self {
                shared_bal_id: InitRow::next_shared_bal_id(),
                token_id,
                creditor,
                debitor,
                balance: 0.into(),
            }
        }

        fn get(creditor: AccountNumber, debitor: AccountNumber, token_id: TID) -> Option<Self> {
            let shared_creditor_bal_ids = UserPendingTable::read()
                .get_index_pk()
                .range((creditor, token_id, 0_u64)..(creditor, token_id, u64::MAX))
                .map(|bal| bal.shared_bal_id)
                .collect::<Vec<_>>();

            if shared_creditor_bal_ids.is_empty() {
                return None;
            }

            shared_creditor_bal_ids.iter().find_map(|bal_id| {
                let shared_bal = SharedBalanceTable::read().get_index_pk().get(bal_id)?;
                if shared_bal.creditor == creditor
                    && shared_bal.debitor == debitor
                    && shared_bal.token_id == token_id
                {
                    Some(shared_bal)
                } else {
                    None
                }
            })
        }

        pub fn get_assert(creditor: AccountNumber, debitor: AccountNumber, token_id: TID) -> Self {
            check_some(
                Self::get(creditor, debitor, token_id),
                "Shared balance does not exist",
            )
        }

        pub fn get_or_new(creditor: AccountNumber, debitor: AccountNumber, token_id: TID) -> Self {
            Self::get(creditor, debitor, token_id).unwrap_or(Self::new(creditor, debitor, token_id))
        }

        pub fn credit(&mut self, quantity: Quantity, memo: Memo) {
            check(quantity.value > 0, "credit quantity must be greater than 0");

            Balance::get_or_new(self.creditor, self.token_id).sub_balance(quantity);
            self.add_balance(quantity);

            let token = Token::get_assert(self.token_id);

            let is_untransferable = token.get_flag(TokenFlags::UNTRANSFERABLE);
            if is_untransferable {
                check(token.nft_holder() == get_sender(), "Token untradeable");
            }

            let is_manual_debit = BalanceConfig::get(self.debitor, self.token_id)
                .map(|holder| holder.get_flag(BalanceFlags::MANUAL_DEBIT))
                .unwrap_or(
                    UserConfig::get_or_new(self.debitor).get_flag(BalanceFlags::MANUAL_DEBIT),
                );

            if !is_manual_debit {
                self.debit(quantity, memo);
            }
        }

        pub fn uncredit(&mut self, quantity: Quantity) {
            check(
                quantity.value > 0,
                "uncredit quantity must be greater than 0",
            );
            let quantity = quantity.min(self.balance);
            self.sub_balance(quantity);
            Balance::get_or_new(self.creditor, self.token_id).add_balance(quantity);
        }

        pub fn debit(&mut self, quantity: Quantity, memo: Memo) {
            check(quantity.value > 0, "debit quantity must be greater than 0");

            crate::Wrapper::emit().history().balChanged(
                self.token_id,
                self.debitor,
                self.creditor,
                "debited".to_string(),
                fmt_amount(self.token_id, quantity),
                memo,
            );

            self.sub_balance(quantity);
            Balance::get_or_new(self.debitor, self.token_id).add_balance(quantity);
        }

        pub fn reject(&mut self, memo: Memo) {
            if self.balance.value > 0 {
                let balance = self.balance;
                crate::Wrapper::emit().history().balChanged(
                    self.token_id,
                    self.creditor,
                    self.debitor,
                    "rejected".to_string(),
                    fmt_amount(self.token_id, balance),
                    memo,
                );
                self.sub_balance(balance);
                Balance::get_or_new(self.creditor, self.token_id).add_balance(balance);
            }
        }

        fn add_balance(&mut self, quantity: Quantity) {
            self.balance = self.balance + quantity;
            UserPendingRecord::add(
                self.creditor,
                self.debitor,
                self.token_id,
                self.shared_bal_id,
            );
            self.save();
        }

        fn sub_balance(&mut self, quantity: Quantity) {
            if self.balance < quantity {
                let p = Token::get_assert(self.token_id).precision;
                let b = Decimal::new(self.balance, p);
                let q = Decimal::new(quantity, p);
                abort_message(&format!(
                    "Insufficient shared balance (tid {}) between {} and {}: {} < {}",
                    self.token_id,
                    self.creditor.to_string(),
                    self.debitor.to_string(),
                    b,
                    q
                ));
            }
            self.balance = self.balance - quantity;

            if self.balance == 0.into() {
                let keep_zero_balance = BalanceConfig::get(self.creditor, self.token_id)
                    .map(|token_holder| token_holder.get_flag(BalanceFlags::KEEP_ZERO_BALANCES))
                    .unwrap_or(
                        UserConfig::get_or_new(self.creditor)
                            .get_flag(BalanceFlags::KEEP_ZERO_BALANCES),
                    );

                if keep_zero_balance {
                    self.save();
                } else {
                    self.delete();
                    UserPendingRecord::remove(
                        self.creditor,
                        self.debitor,
                        self.token_id,
                        self.shared_bal_id,
                    );
                }
            } else {
                self.save();
            }
        }

        fn delete(&self) {
            SharedBalanceTable::read_write().erase(&(self.shared_bal_id));
        }

        fn save(&self) {
            SharedBalanceTable::read_write().put(&self).unwrap();
        }
    }

    define_flags!(BalanceFlags, u8, {
        manual_debit,
        keep_zero_balances,
    });

    #[table(name = "BalanceConfigTable", index = 4)]
    #[derive(Serialize, Deserialize, ToSchema, Fracpack, Debug, SimpleObject)]
    pub struct BalanceConfig {
        pub account: AccountNumber,
        pub token_id: TID,
        pub flags: u8,
    }

    impl BalanceConfig {
        #[primary_key]
        fn pk(&self) -> (AccountNumber, TID) {
            (self.account, self.token_id)
        }

        fn new(account: AccountNumber, token_id: TID) -> Self {
            Token::get_assert(token_id);
            Self {
                account,
                token_id,
                flags: 0,
            }
        }

        fn get(account: AccountNumber, token_id: TID) -> Option<Self> {
            BalanceConfigTable::read()
                .get_index_pk()
                .get(&(account, token_id))
        }

        pub fn get_assert(account: AccountNumber, token_id: TID) -> Self {
            check_some(
                Self::get(account, token_id),
                "balance config does not exist",
            )
        }

        pub fn get_or_new(account: AccountNumber, token_id: TID) -> Self {
            Self::get(account, token_id).unwrap_or(Self::new(account, token_id))
        }

        pub fn set_flag(&mut self, flag: BalanceFlags, enabled: bool) {
            self.flags = Flags::new(self.flags).set(flag, enabled).value();
            self.save();
        }

        pub fn get_flag(&self, flag: BalanceFlags) -> bool {
            Flags::new(self.flags).get(flag)
        }

        pub fn delete(&self) {
            BalanceConfigTable::read_write().erase(&(self.pk()));
        }

        fn put(&mut self) {
            BalanceConfigTable::read_write().put(&self).unwrap();
        }

        fn save(&mut self) {
            self.put();
        }
    }

    #[ComplexObject]
    impl BalanceConfig {
        pub async fn settings(&self) -> BalanceFlagsJson {
            BalanceFlagsJson::from(Flags::new(self.flags))
        }
    }

    #[table(name = "UserConfigTable", index = 5)]
    #[derive(Fracpack, ToSchema, SimpleObject, Serialize, Deserialize, Debug, Clone)]
    #[graphql(complex)]
    pub struct UserConfig {
        #[primary_key]
        pub account: AccountNumber,
        pub flags: u8,
    }

    impl UserConfig {
        fn new(account: AccountNumber) -> Self {
            Self { account, flags: 0 }
        }

        fn get(account: AccountNumber) -> Option<Self> {
            UserConfigTable::read().get_index_pk().get(&account)
        }

        pub fn get_or_new(account: AccountNumber) -> Self {
            Self::get(account).unwrap_or(Self::new(account))
        }

        pub fn set_flag(&mut self, flag: BalanceFlags, enabled: bool) {
            self.flags = Flags::new(self.flags).set(flag, enabled).value();
            self.save();
        }

        pub fn get_flag(&self, flag: BalanceFlags) -> bool {
            Flags::new(self.flags).get(flag)
        }

        fn delete(&self) {
            UserConfigTable::read_write().erase(&(self.get_primary_key()));
        }

        fn put(&self) {
            UserConfigTable::read_write().put(&self).unwrap();
        }

        fn save(&mut self) {
            if self.flags == 0 {
                self.delete();
            } else {
                self.put();
            }
        }
    }

    #[ComplexObject]
    impl UserConfig {
        pub async fn settings(&self) -> BalanceFlagsJson {
            BalanceFlagsJson::from(Flags::new(self.flags))
        }
    }

    #[table(name = "ConfigTable", index = 6)]
    #[derive(Serialize, Deserialize, ToSchema, Fracpack, Debug, SimpleObject)]
    #[graphql(complex)]
    pub struct ConfigRow {
        pub sys_tid: TID,
    }

    impl ConfigRow {
        #[primary_key]
        fn pk(&self) {}
    }

    #[ComplexObject]
    impl ConfigRow {
        pub async fn token(&self) -> Token {
            Token::get_assert(self.sys_tid)
        }
    }

    #[table(name = "UserPendingTable", index = 7)]
    #[derive(Fracpack, ToSchema, SimpleObject, Serialize, Deserialize, Debug, Clone)]
    #[graphql(complex)]
    pub struct UserPendingRecord {
        #[graphql(skip)]
        pub user: AccountNumber,
        #[graphql(skip)]
        pub token_id: TID,
        pub shared_bal_id: u64,
    }

    #[ComplexObject]
    impl UserPendingRecord {
        pub async fn shared_bal(&self) -> SharedBalance {
            SharedBalanceTable::with_service(crate::Wrapper::SERVICE)
                .get_index_pk()
                .get(&self.shared_bal_id)
                .unwrap()
        }
    }

    impl UserPendingRecord {
        #[primary_key]
        fn by_pk(&self) -> (AccountNumber, TID, u64) {
            (self.user, self.token_id, self.shared_bal_id)
        }

        fn new(user: AccountNumber, token_id: TID, shared_bal_id: u64) -> Self {
            Self {
                shared_bal_id,
                token_id,
                user,
            }
        }
        fn add(creditor: AccountNumber, debitor: AccountNumber, token_id: TID, shared_bal_id: u64) {
            let upt = UserPendingTable::new();
            upt.put(&UserPendingRecord::new(creditor, token_id, shared_bal_id))
                .unwrap();
            upt.put(&UserPendingRecord::new(debitor, token_id, shared_bal_id))
                .unwrap();
        }
        fn remove(
            creditor: AccountNumber,
            debitor: AccountNumber,
            token_id: TID,
            shared_bal_id: u64,
        ) {
            let upt = UserPendingTable::read_write();
            upt.erase(&(creditor, token_id, shared_bal_id));
            upt.erase(&(debitor, token_id, shared_bal_id));
        }
    }

    #[table(name = "SubAccountTable", index = 8)]
    #[derive(Serialize, Deserialize, ToSchema, Fracpack, Debug, SimpleObject)]
    pub struct SubAccount {
        pub account: AccountNumber,
        pub sub_account: String,
        #[graphql(skip)]
        pub id: u64,
        pub manual_deletion: bool,
    }
    impl SubAccount {
        #[primary_key]
        fn pk(&self) -> (AccountNumber, String) {
            (self.account, self.sub_account.clone())
        }

        #[secondary_key(1)]
        fn by_id(&self) -> u64 {
            self.id
        }
    }
    impl SubAccount {
        pub const MANUAL_DEL: bool = true;

        fn new(owner: AccountNumber, sub_account: String, manual_deletion: bool) -> Self {
            Self {
                id: InitRow::next_subaccount_id(),
                account: owner,
                sub_account,
                manual_deletion,
            }
        }

        pub fn get(owner: AccountNumber, sub_account: String) -> Option<Self> {
            SubAccountTable::read()
                .get_index_pk()
                .get(&(owner, sub_account))
        }

        pub fn get_or_add(
            owner: AccountNumber,
            sub_account: String,
            manual_deletion: bool,
        ) -> Self {
            if let Some(mut inst) = Self::get(owner, sub_account.clone()) {
                if manual_deletion {
                    check(!inst.manual_deletion, "Sub-account was 'created' twice");
                    inst.manual_deletion = true;
                    inst.save();
                }

                return inst;
            }

            check(
                sub_account.len() <= 80,
                "Sub-account key must be 80 bytes or less",
            );
            let mut new_instance = Self::new(owner, sub_account, manual_deletion);
            new_instance.save();
            new_instance
        }

        pub fn get_assert(owner: AccountNumber, sub_account: String) -> Self {
            check_some(
                Self::get(owner, sub_account.clone()),
                &format!("{} has no sub-account '{}'", owner, sub_account),
            )
        }

        pub fn get_by_id(id: u64) -> Option<Self> {
            SubAccountTable::read().get_index_by_id().get(&id)
        }

        fn save(&mut self) {
            SubAccountTable::read_write().put(&self).unwrap();
        }

        pub fn delete(&mut self) {
            let sub_bal_table = SubAccountBalanceTable::read_write();

            let sub_balances: Vec<_> = sub_bal_table
                .get_index_pk()
                .range((self.id, 0)..(self.id, u32::MAX))
                .collect();

            for sub_balance in sub_balances {
                check(
                    sub_balance.balance.value == 0,
                    "Sub-account with non-zero balances cannot be deleted",
                );
                sub_bal_table.erase(&sub_balance.pk());
            }

            SubAccountTable::read_write().erase(&(&self.pk()));
        }

        pub fn add_balance(&mut self, token_id: TID, quantity: Quantity) {
            Balance::get_assert(self.account, token_id).sub_balance(quantity);
            SubAccountBalance::get_or_new(self.id, token_id).add_balance(quantity);
        }

        pub fn sub_balance(&mut self, token_id: TID, quantity: Quantity) {
            let remaining = SubAccountBalance::get_assert(self.id, token_id).sub_balance(quantity);
            Balance::get_or_new(self.account, token_id).add_balance(quantity);

            if remaining.value == 0 && !self.manual_deletion {
                let keep = SubAccountBalanceTable::read()
                    .get_index_pk()
                    .range((self.id, 0)..(self.id, u32::MAX))
                    .any(|sub_balance| sub_balance.balance.value > 0);

                if !keep {
                    self.delete();
                }
            }
        }

        pub fn get_balance(&self, token_id: TID) -> Quantity {
            SubAccountBalance::get_or_new(self.id, token_id).get_balance()
        }
    }

    #[table(name = "SubAccountBalanceTable", index = 9)]
    #[derive(Serialize, Deserialize, ToSchema, Fracpack, Debug, SimpleObject)]
    #[graphql(complex)]
    pub struct SubAccountBalance {
        #[graphql(skip)]
        pub subaccount_id: u64,
        pub token_id: TID,
        #[graphql(skip)]
        pub balance: Quantity,
    }
    impl SubAccountBalance {
        #[primary_key]
        fn pk(&self) -> (u64, TID) {
            (self.subaccount_id, self.token_id)
        }
    }
    impl SubAccountBalance {
        fn new(subaccount_id: u64, token_id: TID) -> Self {
            Token::get_assert(token_id);
            Self {
                subaccount_id,
                token_id,
                balance: 0.into(),
            }
        }

        fn get(subaccount_id: u64, token_id: TID) -> Option<Self> {
            SubAccountBalanceTable::read()
                .get_index_pk()
                .get(&(subaccount_id, token_id))
        }

        pub fn get_or_new(subaccount_id: u64, token_id: TID) -> Self {
            Self::get(subaccount_id, token_id).unwrap_or(Self::new(subaccount_id, token_id))
        }

        pub fn get_assert(subaccount_id: u64, token_id: TID) -> Self {
            check_some(
                Self::get(subaccount_id, token_id),
                &format!(
                    "Sub-account balance does not exist for subaccount ID {} and token ID {}",
                    subaccount_id, token_id
                ),
            )
        }

        fn save(&self) {
            SubAccountBalanceTable::read_write().put(&self).unwrap();
        }

        fn add_balance(&mut self, quantity: Quantity) {
            self.balance = self.balance + quantity;
            self.save();
        }

        fn sub_balance(&mut self, quantity: Quantity) -> Quantity {
            check(self.balance >= quantity, "Insufficient sub-account balance");
            self.balance = self.balance - quantity;
            self.save();
            self.balance
        }

        pub fn get_balance(&self) -> Quantity {
            self.balance
        }
    }
    #[ComplexObject]
    impl SubAccountBalance {
        pub async fn balance(&self) -> Decimal {
            Decimal::new(self.balance, Token::get_assert(self.token_id).precision)
        }

        pub async fn token(&self) -> Token {
            Token::get_assert(self.token_id)
        }

        pub async fn account(&self) -> AccountNumber {
            SubAccount::get_by_id(self.subaccount_id).unwrap().account
        }

        pub async fn subaccount(&self) -> String {
            SubAccount::get_by_id(self.subaccount_id)
                .unwrap()
                .sub_account
        }
    }
}
