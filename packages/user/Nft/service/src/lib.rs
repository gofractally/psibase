#[psibase::service_tables]
pub mod tables {
    use async_graphql::SimpleObject;
    use psibase::{
        abort_message, check, check_none, check_some, define_flags, get_sender, AccountNumber,
        ConfigRow, FlagsType, Fracpack, Memo, Table, ToSchema,
    };
    use serde::{Deserialize, Serialize};

    pub type NID = u64;

    define_flags!(NftHolderFlags, u8, {
        manual_debit,
    });

    #[table(name = "InitTable", index = 0)]
    #[derive(Fracpack, ToSchema, Serialize, Deserialize, Debug)]
    pub struct InitRow {
        pub next_id: NID,
    }

    impl InitRow {
        #[primary_key]
        fn pk(&self) {}

        pub fn add() {
            check_none(Self::get(), "init row already exists");
            let new_instance = Self { next_id: 0 };
            new_instance.save();
        }

        pub fn get() -> Option<Self> {
            InitTable::read().get_index_pk().get(&())
        }

        pub fn get_assert() -> Self {
            check_some(Self::get(), "init row does not exist")
        }

        pub fn get_next_id(&mut self) -> NID {
            let next_id = self
                .next_id
                .checked_add(1)
                .expect("overflow in id generation");
            self.next_id = next_id;
            self.save();
            next_id
        }

        fn save(&self) {
            InitTable::read_write().put(&self).unwrap();
        }
    }

    #[table(name = "NftTable", index = 1)]
    #[derive(Fracpack, ToSchema, Serialize, Deserialize, Debug, Clone, SimpleObject)]
    pub struct Nft {
        #[primary_key]
        pub id: NID,
        pub issuer: AccountNumber,
        pub owner: AccountNumber,
    }

    impl Nft {
        #[secondary_key(1)]
        fn by_owner(&self) -> (AccountNumber, NID) {
            (self.owner, self.id)
        }

        #[secondary_key(2)]
        fn by_issuer(&self) -> (AccountNumber, NID) {
            (self.issuer, self.id)
        }

        pub fn new(owner_and_issuer: AccountNumber) -> Self {
            Self {
                id: InitRow::get_assert().get_next_id(),
                issuer: owner_and_issuer,
                owner: owner_and_issuer,
            }
        }

        pub fn get(nft_id: NID) -> Option<Self> {
            NftTable::read().get_index_pk().get(&nft_id)
        }

        pub fn check_is_owner(&self, account: AccountNumber) {
            check(self.owner == account, "Missing required auth");
        }

        pub fn get_assert(nft_id: NID) -> Self {
            Self::get(nft_id).unwrap_or_else(|| {
                if nft_id <= InitRow::get_assert().next_id {
                    abort_message("NFT was burned")
                } else {
                    abort_message("NFT does not exist")
                }
            })
        }

        pub fn add() -> Self {
            let sender = get_sender();
            let new_instance = Self::new(sender);
            new_instance.save();

            super::Wrapper::emit()
                .history()
                .minted(new_instance.id, sender);

            new_instance
        }

        pub fn burn(&self) {
            check_none(CreditRecord::get(self.id), "cannot burn nft while credited");
            super::Wrapper::emit().history().burned(self.id, self.owner);
            self.erase();
        }

        pub fn set_owner(&mut self, owner: AccountNumber) {
            self.owner = owner;
            self.save();
        }

        fn erase(&self) {
            NftTable::read_write().erase(&self.id);
        }

        fn save(&self) {
            NftTable::read_write().put(&self).unwrap()
        }
    }

    #[table(name = "NftHolderTable", index = 2)]
    #[derive(Fracpack, ToSchema, Serialize, Deserialize, SimpleObject, Debug, Clone)]
    pub struct NftHolder {
        #[primary_key]
        pub account: AccountNumber,
        pub config: u8,
    }

    #[table(name = "CreditTable", index = 3)]
    #[derive(Fracpack, ToSchema, Serialize, Deserialize, Debug, Clone, SimpleObject)]
    #[allow(non_snake_case)]
    pub struct CreditRecord {
        #[primary_key]
        pub nftId: NID,
        pub creditor: AccountNumber,
        pub debitor: AccountNumber,
    }
    impl CreditRecord {
        #[secondary_key(1)]
        fn by_creditor(&self) -> (AccountNumber, NID) {
            (self.creditor, self.nftId)
        }

        #[secondary_key(2)]
        fn by_debitor(&self) -> (AccountNumber, NID) {
            (self.debitor, self.nftId)
        }

        fn new(nftId: NID, creditor: AccountNumber, debitor: AccountNumber) -> Self {
            Self {
                nftId,
                creditor,
                debitor,
            }
        }

        pub fn get(nft_id: NID) -> Option<Self> {
            CreditTable::read().get_index_pk().get(&nft_id)
        }

        pub fn get_assert(nft_id: NID) -> Self {
            check_some(Self::get(nft_id), "no credit record")
        }

        pub fn add(
            nft_id: NID,
            creditor: AccountNumber,
            debitor: AccountNumber,
            memo: Memo,
        ) -> Self {
            check_none(Self::get(nft_id), "NFT already credited to an account");
            check(
                creditor != debitor,
                "Creditor and debitor cannot be the same",
            );
            check_some(
                psibase::services::accounts::Wrapper::call().getAccount(debitor),
                "Receiver DNE",
            );

            let new_instance = Self::new(nft_id, creditor, debitor);
            new_instance.save();

            super::Wrapper::emit()
                .history()
                .credited(nft_id, creditor, debitor, memo.to_string());

            new_instance
        }

        pub fn debit(&self, memo: Memo) {
            Nft::get_assert(self.nftId).set_owner(self.debitor);

            super::Wrapper::emit().merkle().transferred(
                self.nftId,
                self.creditor,
                self.debitor,
                memo,
            );
            self.erase();
        }

        pub fn uncredit(&self, memo: Memo) {
            check(
                Nft::get_assert(self.nftId).owner == get_sender(),
                "must be owner to uncredit",
            );

            super::Wrapper::emit().history().uncredited(
                self.nftId,
                self.creditor,
                self.debitor,
                memo.to_string(),
            );
            self.erase();
        }

        fn save(&self) {
            CreditTable::read_write().put(&self).unwrap();
        }

        fn erase(&self) {
            CreditTable::read_write().erase(&self.nftId);
        }
    }

    impl NftHolder {
        pub fn get_or_default(account: AccountNumber) -> Self {
            NftHolderTable::read()
                .get_index_pk()
                .get(&account)
                .unwrap_or(Self { account, config: 0 })
        }

        pub fn get_flag(&self, flag: NftHolderFlags) -> bool {
            psibase::Flags::new(self.config).get(flag)
        }

        pub fn set_flag(&mut self, flag: NftHolderFlags, enable: bool) {
            self.config = psibase::Flags::new(self.config).set(flag, enable).value();
            self.save();
            super::Wrapper::emit()
                .history()
                .userConfSet(self.account, flag.index(), enable);
        }

        pub fn save(&self) {
            NftHolderTable::read_write().put(self).unwrap();
        }
    }
}

#[psibase::service(name = "nft", tables = "tables", recursive = true)]
pub mod service {
    use crate::tables::*;
    use psibase::{check, check_some, get_sender, AccountNumber, Memo};

    pub type NID = u64;

    #[action]
    fn init() {
        if InitRow::get().is_none() {
            InitRow::add();
            NftHolder::get_or_default(get_sender()).set_flag(NftHolderFlags::MANUAL_DEBIT, true);
        }
    }

    #[pre_action(exclude(init))]
    fn check_init() {
        check_some(InitRow::get(), "service not initialized");
    }

    #[action]
    pub fn mint() -> NID {
        Nft::add().id
    }

    #[action]
    pub fn burn(nft_id: NID) {
        let nft = Nft::get_assert(nft_id);
        nft.check_is_owner(get_sender());
        nft.burn();
    }

    #[action]
    pub fn credit(nft_id: NID, debitor: AccountNumber, memo: Memo) {
        let creditor = get_sender();
        Nft::get_assert(nft_id).check_is_owner(creditor);

        let credit_record = CreditRecord::add(nft_id, creditor, debitor, memo.clone());

        let receiver_holder = NftHolder::get_or_default(debitor);
        let manual_debit = receiver_holder.get_flag(NftHolderFlags::MANUAL_DEBIT);
        if !manual_debit {
            credit_record.debit(memo);
        }
    }

    #[action]
    #[allow(non_snake_case)]
    fn getNftHolder(account: AccountNumber) -> NftHolder {
        NftHolder::get_or_default(account)
    }

    #[action]
    #[allow(non_snake_case)]
    fn getCredRecord(nftId: NID) -> CreditRecord {
        CreditRecord::get_assert(nftId)
    }

    #[action]
    pub fn uncredit(nft_id: NID, memo: Memo) {
        CreditRecord::get_assert(nft_id).uncredit(memo);
    }

    #[action]
    pub fn debit(nft_id: NID, memo: Memo) {
        let credit_record = CreditRecord::get_assert(nft_id);
        check(
            credit_record.debitor == get_sender(),
            "missing required auth",
        );
        credit_record.debit(memo);
    }

    #[action]
    #[allow(non_snake_case)]
    pub fn setUserConf(index: u8, enable: bool) {
        NftHolder::get_or_default(get_sender()).set_flag(index.into(), enable);
    }

    #[action]
    #[allow(non_snake_case)]
    pub fn getUserConf(account: AccountNumber, index: u8) -> bool {
        NftHolder::get_or_default(account).get_flag(index.into())
    }

    #[action]
    #[allow(non_snake_case)]
    pub fn getNft(nft_id: NID) -> Nft {
        Nft::get_assert(nft_id)
    }

    #[action]
    pub fn exists(nft_id: NID) -> bool {
        Nft::get(nft_id).is_some()
    }

    #[event(history)]
    pub fn minted(nft_id: NID, issuer: AccountNumber) {}

    #[event(history)]
    pub fn burned(nft_id: NID, owner: AccountNumber) {}

    #[event(history)]
    pub fn credited(nftId: NID, sender: AccountNumber, receiver: AccountNumber, memo: String) {}

    #[event(history)]
    pub fn uncredited(nftId: NID, sender: AccountNumber, receiver: AccountNumber, memo: String) {}

    #[event(merkle)]
    pub fn transferred(nft_id: NID, from: AccountNumber, to: AccountNumber, memo: Memo) {}

    #[event(history)]
    pub fn userConfSet(account: AccountNumber, index: u8, enable: bool) {}
}
