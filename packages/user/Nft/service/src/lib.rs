#[psibase::service_tables]
pub mod tables {
    use psibase::{
        check, check_none, check_some, define_flags, get_sender, AccountNumber, Fracpack, Table,
        ToSchema,
    };
    use serde::{Deserialize, Serialize};

    pub type NID = u64;

    // Exactly like tokens
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

        pub fn init() {
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
            let next_id = self.next_id + 1;
            self.next_id = next_id;
            self.save();
            next_id
        }

        fn save(&self) {
            InitTable::read_write().put(&self).unwrap();
        }
    }

    #[table(name = "NftTable", index = 1)]
    #[derive(Fracpack, ToSchema, Serialize, Deserialize, Debug, Clone)]
    pub struct NftRecord {
        #[primary_key]
        pub id: NID,
        pub issuer: AccountNumber,
        pub owner: AccountNumber,
    }
    impl NftRecord {
        #[secondary_key(1)]
        fn by_owner(&self) -> (AccountNumber, NID) {
            (self.owner, self.id)
        }
        #[secondary_key(2)]
        fn by_issuer(&self) -> (AccountNumber, NID) {
            (self.issuer, self.id)
        }

        pub fn get(nft_id: NID) -> Option<Self> {
            NftTable::read().get_index_pk().get(&nft_id)
        }

        pub fn get_assert(nft_id: NID) -> Self {
            check_some(Self::get(nft_id), "NFT does not exist")
        }

        pub fn add() -> Self {
            let sender = get_sender();
            let new_instance = Self {
                id: InitRow::get_assert().get_next_id(),
                issuer: sender,
                owner: sender,
            };
            new_instance.save();
            new_instance
        }

        pub fn burn(&self) {
            check(get_sender() == self.owner, "must be owner to burn");
            self.erase();
        }

        fn erase(&self) {
            NftTable::read_write().erase(&self.id);
        }

        fn save(&self) {
            NftTable::read_write().put(&self).unwrap()
        }
    }

    #[table(name = "NftHolderTable", index = 2)]
    #[derive(Fracpack, ToSchema, Serialize, Deserialize, Debug, Clone)]
    pub struct NftHolderRecord {
        #[primary_key]
        pub account: AccountNumber,
        pub config: u8,
    }

    #[table(name = "CreditTable", index = 3)]
    #[derive(Fracpack, ToSchema, Serialize, Deserialize, Debug, Clone)]
    pub struct CreditRecord {
        #[primary_key]
        pub nft_id: NID,
        pub creditor: AccountNumber,
        pub debitor: AccountNumber,
    }
    impl CreditRecord {
        #[secondary_key(1)]
        fn by_creditor(&self) -> (AccountNumber, NID) {
            (self.creditor, self.nft_id)
        }

        #[secondary_key(2)]
        fn by_debitor(&self) -> (AccountNumber, NID) {
            (self.debitor, self.nft_id)
        }

        pub fn get(nft_id: NID) -> Option<Self> {
            CreditTable::read().get_index_pk().get(&nft_id)
        }

        pub fn get_assert(nft_id: NID) -> Self {
            check_some(Self::get(nft_id), "no credit record")
        }
    }

    impl NftHolderRecord {
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
        }

        pub fn save(&self) {
            NftHolderTable::read_write().put(self).unwrap();
        }
    }
}

#[psibase::service(name = "nft", tables = "tables", recursive = true)]
pub mod service {
    use crate::tables::*;
    use psibase::Table;
    use psibase::{check, check_some, get_sender, AccountNumber, Memo};

    pub type NID = u64;

    #[action]
    fn init() {
        InitRow::init();

        // Set service itself to manual_debit = true using index 0
        Wrapper::call().setUserConf(0, true);
    }

    #[pre_action(exclude(init))]
    fn check_init() {
        check_some(InitRow::get(), "service not initialized");
    }

    #[action]
    pub fn mint() -> NID {
        let nft = NftRecord::add();
        // Wrapper::emit().history().minted(new_id, issuer);
        nft.id
    }

    #[action]
    pub fn burn(nft_id: NID) {
        let nft = NftRecord::get_assert(nft_id);
        check(nft.owner == get_sender(), "missing required auth");
        NftTable::new().erase(&nft_id);
        Wrapper::emit().history().burned(nft_id, nft.owner);
    }

    #[action]
    pub fn credit(nft_id: NID, receiver: AccountNumber, memo: Memo) {
        let mut nft = NftRecord::get_assert(nft_id);
        let sender = get_sender();

        check(nft.owner == sender, "missing required auth");
        check(receiver != sender, "cannot credit to self");
        check(CreditRecord::get(nft_id).is_none(), "already credited");

        let receiver_holder = NftHolderRecord::get_or_default(receiver);
        let manual_debit = receiver_holder.get_flag(NftHolderFlags::MANUAL_DEBIT);

        Wrapper::emit()
            .history()
            .credited(nft_id, sender, receiver, memo.clone());

        if !manual_debit {
            nft.owner = receiver;
            Wrapper::emit()
                .merkle()
                .transferred(nft_id, sender, receiver, memo);
        } else {
            CreditTable::new()
                .put(&CreditRecord {
                    nft_id,
                    creditor: sender,
                    debitor: receiver,
                })
                .unwrap();
        }

        NftTable::new().put(&nft).unwrap();
        receiver_holder.save();
    }

    #[action]
    pub fn uncredit(nft_id: NID, memo: Memo) {
        let nft = NftRecord::get_assert(nft_id);
        let sender = get_sender();
        check(nft.owner == sender, "only creditor can uncredit");

        let credit = CreditRecord::get_assert(nft_id);
        CreditTable::new().erase(&nft_id);
        Wrapper::emit()
            .history()
            .uncredited(nft_id, sender, credit.debitor, memo);
    }

    #[action]
    pub fn debit(nft_id: NID, memo: Memo) {
        let mut nft = NftRecord::get_assert(nft_id);
        let debitor = get_sender();

        let credit = CreditRecord::get_assert(nft_id);
        check(credit.debitor == debitor, "missing required auth");

        nft.owner = debitor;
        NftTable::new().put(&nft).unwrap();
        CreditTable::new().erase(&nft_id);
        Wrapper::emit()
            .merkle()
            .transferred(nft_id, credit.creditor, debitor, memo);
    }

    // Exactly like tokens — use u8 index
    #[action]
    #[allow(non_snake_case)]
    pub fn setUserConf(index: u8, enable: bool) {
        let sender = get_sender();
        let mut holder = NftHolderRecord::get_or_default(sender);

        let flag = match index {
            0 => NftHolderFlags::MANUAL_DEBIT,
            _ => return, // ignore unknown
        };

        if holder.get_flag(flag) != enable {
            holder.set_flag(flag, enable);
            holder.save();
            Wrapper::emit().history().userConfSet(sender, index, enable);
        }
    }

    #[action]
    #[allow(non_snake_case)]
    pub fn getUserConf(account: AccountNumber, index: u8) -> bool {
        let holder = NftHolderRecord::get_or_default(account);
        match index {
            0 => holder.get_flag(NftHolderFlags::MANUAL_DEBIT),
            _ => false,
        }
    }

    #[action]
    #[allow(non_snake_case)]
    pub fn getNft(nft_id: NID) -> NftRecord {
        NftRecord::get_assert(nft_id)
    }

    #[action]
    pub fn exists(nft_id: NID) -> bool {
        NftRecord::get(nft_id).is_some()
    }

    #[event(history)]
    pub fn minted(nft_id: NID, issuer: AccountNumber) {}

    #[event(history)]
    pub fn burned(nft_id: NID, owner: AccountNumber) {}

    #[event(history)]
    pub fn credited(nft_id: NID, from: AccountNumber, to: AccountNumber, memo: Memo) {}

    #[event(history)]
    pub fn uncredited(nft_id: NID, creditor: AccountNumber, debitor: AccountNumber, memo: Memo) {}

    #[event(merkle)]
    pub fn transferred(nft_id: NID, from: AccountNumber, to: AccountNumber, memo: Memo) {}

    #[event(history)]
    pub fn userConfSet(account: AccountNumber, index: u8, enable: bool) {}
}
