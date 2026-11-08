#![allow(non_snake_case)]
#[psibase::service_tables]
pub mod tables {
    use async_graphql::SimpleObject;
    use psibase::{
        abort_message, get_sender, AccountNumber, Memo, Pack, ServiceWrapper, Table, ToSchema,
        Unpack,
    };
    use serde::{Deserialize, Serialize};

    use async_graphql::ComplexObject;

    pub type NID = u32;

    pub const MINTED: u8 = 0;
    pub const BURNED: u8 = 1;
    pub const CREDITED: u8 = 2;
    pub const DEBITED: u8 = 3;
    pub const UNCREDITED: u8 = 4;

    #[table(name = "ConfigTable", index = 0)]
    #[derive(Pack, Unpack, ToSchema, Serialize, Deserialize, Debug)]
    pub struct ConfigRow {
        pub next_id: NID,
    }

    impl ConfigRow {
        #[primary_key]
        fn pk(&self) {}

        pub fn add() {
            assert!(Self::get().is_none(), "config row already exists");
            let new_instance = Self { next_id: 0 };
            new_instance.save();
        }

        pub fn get() -> Option<Self> {
            ConfigTable::read().get_index_pk().get(&())
        }

        pub fn get_assert() -> Self {
            Self::get().expect("config row does not exist")
        }

        pub fn get_next_id(&mut self) -> NID {
            let next_id = Nft::first_available_id(self.next_id.wrapping_add(1));
            self.next_id = next_id;
            self.save();
            next_id
        }

        fn save(&self) {
            ConfigTable::read_write().put(&self).unwrap();
        }
    }

    #[table(name = "NftTable", index = 1)]
    #[derive(Pack, Unpack, ToSchema, Serialize, Deserialize, Debug, Clone, PartialEq, SimpleObject)]
    pub struct Nft {
        #[primary_key]
        pub id: NID,
        pub issuer: AccountNumber,
        pub owner: AccountNumber,
    }

    #[derive(PartialEq)]
    pub enum NftStatus {
        Available,
        Burned,
        Active(Nft),
    }

    impl Nft {
        #[secondary_key(1)]
        fn by_owner(&self) -> (AccountNumber, AccountNumber, NID) {
            (self.owner, self.issuer, self.id)
        }

        #[secondary_key(2)]
        fn by_issuer(&self) -> (AccountNumber, AccountNumber, NID) {
            (self.issuer, self.owner, self.id)
        }

        pub fn get(nft_id: NID) -> Option<Self> {
            NftTable::read().get_index_pk().get(&nft_id)
        }

        pub fn status(id: NID) -> NftStatus {
            if let Some(nft) = Self::get(id) {
                NftStatus::Active(nft)
            } else if Burned::contains(id) {
                NftStatus::Burned
            } else {
                NftStatus::Available
            }
        }

        /// First id at or after `begin` that mint can create. Wraps, and never returns 0.
        pub fn first_available_id(begin: NID) -> NID {
            let mut id = if begin == 0 { 1 } else { begin };
            let start = id;
            loop {
                if Self::status(id) == NftStatus::Available {
                    return id;
                }
                id = id.wrapping_add(1);
                if id == 0 {
                    id = 1;
                }
                if id == start {
                    abort_message("no NFT id available");
                }
            }
        }

        pub fn check_is_owner(&self, account: AccountNumber) {
            assert_eq!(self.owner, account, "Missing required authority");
        }

        pub fn get_assert(nft_id: NID) -> Self {
            match Self::status(nft_id) {
                NftStatus::Active(nft) => nft,
                NftStatus::Burned => abort_message("NFT was burned"),
                NftStatus::Available => abort_message("NFT does not exist"),
            }
        }

        pub fn new(sender: AccountNumber, id: NID) -> Self {
            Self {
                id,
                issuer: sender,
                owner: sender,
            }
        }

        pub fn add(id: Option<NID>) -> Self {
            let sender = get_sender();
            let id = match id {
                Some(id) => {
                    assert!(id != 0, "NFT ID invalid");
                    match Self::status(id) {
                        NftStatus::Available => id,
                        NftStatus::Active(_) | NftStatus::Burned => {
                            abort_message("NFT ID already taken")
                        }
                    }
                }
                None => ConfigRow::get_assert().get_next_id(),
            };
            let nft = Self::new(sender, id);
            nft.save();
            super::Wrapper::emit().history().ownerChange(
                nft.id,
                MINTED,
                sender,
                super::Wrapper::SERVICE,
                "Minted".into(),
            );
            nft
        }

        pub fn burn(&self) {
            assert!(
                CreditRecord::get(self.id).is_none(),
                "cannot burn nft while credited"
            );
            super::Wrapper::emit().history().ownerChange(
                self.id,
                BURNED,
                self.owner,
                super::Wrapper::SERVICE,
                "Burned".into(),
            );
            Burned::add(self.id);
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
    #[derive(Pack, Unpack, ToSchema, Serialize, Deserialize, SimpleObject, Debug, Clone)]
    pub struct NftHolder {
        #[primary_key]
        pub account: AccountNumber,
        pub autodebit: bool,
    }

    #[table(name = "CreditTable", index = 3)]
    #[derive(Pack, Unpack, ToSchema, Serialize, Deserialize, Debug, Clone, SimpleObject)]
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

        pub fn add(
            nft_id: NID,
            creditor: AccountNumber,
            debitor: AccountNumber,
            memo: Memo,
        ) -> Self {
            assert!(
                Self::get(nft_id).is_none(),
                "NFT already credited to an account"
            );
            assert!(
                creditor != debitor,
                "Creditor and debitor cannot be the same",
            );
            psibase::services::accounts::Wrapper::call()
                .getAccount(debitor)
                .expect("Receiver DNE");

            let new_instance = Self::new(nft_id, creditor, debitor);
            new_instance.save();

            super::Wrapper::emit().history().ownerChange(
                new_instance.nftId,
                CREDITED,
                creditor,
                debitor,
                memo,
            );

            UserPending::add(creditor, debitor, nft_id);

            new_instance
        }

        pub fn debit(&self, memo: Memo) {
            Nft::get_assert(self.nftId).set_owner(self.debitor);

            super::Wrapper::emit().history().ownerChange(
                self.nftId,
                DEBITED,
                self.debitor,
                self.creditor,
                memo,
            );

            UserPending::remove(self.creditor, self.debitor, self.nftId);
            self.erase();
        }

        pub fn uncredit(&self, memo: Memo) {
            assert!(
                Nft::get_assert(self.nftId).owner == get_sender(),
                "Only the creditor may perform this action",
            );

            super::Wrapper::emit().history().ownerChange(
                self.nftId,
                UNCREDITED,
                self.creditor,
                self.debitor,
                memo,
            );

            UserPending::remove(self.creditor, self.debitor, self.nftId);
            self.erase();
        }

        fn save(&self) {
            CreditTable::read_write().put(&self).unwrap();
        }

        fn erase(&self) {
            CreditTable::read_write().erase(&self.nftId);
        }
    }

    #[table(name = "UserPendingTable", index = 4)]
    #[derive(Pack, Unpack, ToSchema, Serialize, Deserialize, Debug, Clone, SimpleObject)]
    #[allow(non_snake_case)]
    #[graphql(complex)]
    pub struct UserPending {
        pub user: AccountNumber,
        pub nft_id: NID,
    }

    impl UserPending {
        #[primary_key]
        fn by_pk(&self) -> (AccountNumber, NID) {
            (self.user, self.nft_id)
        }

        fn new(user: AccountNumber, nft_id: NID) -> Self {
            Self { user, nft_id }
        }

        fn add(creditor: AccountNumber, debitor: AccountNumber, nft_id: NID) {
            Self::new(creditor, nft_id).save();
            Self::new(debitor, nft_id).save();
        }

        fn save(&self) {
            UserPendingTable::read_write().put(&self).unwrap();
        }

        fn remove(creditor: AccountNumber, debitor: AccountNumber, nft_id: NID) {
            let table = UserPendingTable::read_write();
            table.erase(&(creditor, nft_id));
            table.erase(&(debitor, nft_id));
        }
    }

    #[ComplexObject]
    impl UserPending {
        pub async fn credit(&self) -> CreditRecord {
            CreditTable::with_service(crate::Wrapper::SERVICE)
                .get_index_pk()
                .get(&self.nft_id)
                .unwrap()
        }
    }

    #[table(name = "BurnedTable", index = 5)]
    #[derive(Pack, Unpack, ToSchema, Serialize, Deserialize, Debug, Clone)]
    pub struct Burned {
        #[primary_key]
        pub id: NID,
    }

    impl Burned {
        pub fn get(id: NID) -> Option<Self> {
            BurnedTable::read().get_index_pk().get(&id)
        }

        pub fn contains(id: NID) -> bool {
            Self::get(id).is_some()
        }

        fn add(id: NID) {
            BurnedTable::read_write().put(&Self { id }).unwrap();
        }
    }

    fn account_has_service(account: AccountNumber) -> bool {
        let native = psibase::KvHandle::new(psibase::DbId::Native, &[], psibase::KvMode::Read);
        let key = (
            psibase::CODE_TABLE,
            psibase::NATIVE_TABLE_PRIMARY_INDEX,
            account,
        );
        psibase::kv_get::<psibase::CodeRow, _>(&native, &key)
            .unwrap()
            .is_some_and(|row| row.codeHash != psibase::Checksum256::default())
    }

    impl NftHolder {
        fn new(account: AccountNumber) -> Self {
            Self {
                account,
                autodebit: !account_has_service(account),
            }
        }

        fn get(account: AccountNumber) -> Option<Self> {
            NftHolderTable::read().get_index_pk().get(&account)
        }

        pub fn get_or_new(account: AccountNumber) -> Self {
            Self::get(account).unwrap_or_else(|| Self::new(account))
        }

        pub fn set(account: AccountNumber, autodebit: bool) {
            NftHolderTable::read_write()
                .put(&Self { account, autodebit })
                .unwrap();
        }
    }
}

#[psibase::service(name = "nft", tables = "tables", recursive = true)]
pub mod service {
    use crate::tables::*;
    use psibase::{
        get_sender, services::events, AccountNumber, EventDb, Memo, MethodNumber, ServiceWrapper,
    };

    pub type NID = u32;

    pub use crate::tables::{BURNED, CREDITED, DEBITED, MINTED, UNCREDITED};

    #[action]
    fn init() {
        if ConfigRow::get().is_none() {
            ConfigRow::add();

            let add_index = |column: u8| {
                events::Wrapper::call().addIndex(
                    EventDb::HistoryEvent,
                    Wrapper::SERVICE,
                    MethodNumber::from("ownerChange"),
                    column,
                );
            };

            add_index(0); // nftId
            add_index(2); // account
            add_index(3); // counter_party
        }
    }

    #[pre_action(exclude(init))]
    fn check_init() {
        ConfigRow::get().expect("service not initialized");
    }

    #[action]
    pub fn mint(nftId: Option<NID>) -> NID {
        Nft::add(nftId).id
    }

    #[action]
    pub fn burn(nftId: NID) {
        let nft = Nft::get_assert(nftId);
        nft.check_is_owner(get_sender());
        nft.burn();
    }

    #[action]
    pub fn credit(nft_id: NID, debitor: AccountNumber, memo: Memo) {
        let creditor = get_sender();
        Nft::get_assert(nft_id).check_is_owner(creditor);
        CreditRecord::add(nft_id, creditor, debitor, memo);
    }

    #[action]
    pub fn transfer(nft_id: NID, debitor: AccountNumber, memo: Memo) {
        let creditor = get_sender();
        Nft::get_assert(nft_id).check_is_owner(creditor);

        let credit_record = CreditRecord::add(nft_id, creditor, debitor, memo.clone());
        if NftHolder::get_or_new(debitor).autodebit {
            credit_record.debit(memo);
        }
    }

    #[action]
    fn getNftHolder(account: AccountNumber) -> NftHolder {
        NftHolder::get_or_new(account)
    }

    #[action]
    fn getCredRecord(nftId: NID) -> Option<CreditRecord> {
        CreditRecord::get(nftId)
    }

    #[action]
    pub fn uncredit(nftId: NID, memo: Memo) {
        CreditRecord::get(nftId)
            .expect("Nothing to uncredit. Must first credit.")
            .uncredit(memo);
    }

    #[action]
    pub fn debit(nftId: NID, memo: Memo) {
        let credit_record = CreditRecord::get(nftId).expect(&format!(
            "{} has no pending nft {} to debit.",
            get_sender().to_string(),
            nftId.to_string()
        ));
        assert_eq!(
            credit_record.debitor,
            get_sender(),
            "Missing required authority",
        );
        credit_record.debit(memo);
    }

    #[action]
    pub fn setAutoDebit(autodebit: bool) {
        NftHolder::set(get_sender(), autodebit);
    }

    #[action]
    pub fn getNft(nftId: NID) -> Option<Nft> {
        Nft::get(nftId)
    }

    #[action]
    pub fn exists(nftId: NID) -> bool {
        Nft::get(nftId).is_some()
    }

    #[event(history)]
    pub fn ownerChange(
        nftId: NID,
        action: u8,
        account: AccountNumber,
        counter_party: AccountNumber,
        memo: Memo,
    ) {
    }
}

