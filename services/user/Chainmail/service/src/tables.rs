use async_graphql::SimpleObject;
use psibase::{AccountNumber, DbId, Fracpack, RawKey, TimePointSec, ToKey, ToSchema};
use serde::{Deserialize, Serialize};

pub struct SavedMessageTable {
    db_id: DbId,
    prefix: Vec<u8>,
}

impl SavedMessageTable {
    pub fn get_index_by_receiver(&self) -> psibase::TableIndex<AccountNumber, SavedMessage> {
        use psibase::Table;
        self.get_index(1u8)
    }
}

impl psibase::Table<SavedMessage> for SavedMessageTable {
    const TABLE_INDEX: u16 = 1u16;

    fn with_prefix(db_id: psibase::DbId, prefix: Vec<u8>) -> Self {
        SavedMessageTable { db_id, prefix }
    }

    fn prefix(&self) -> &[u8] {
        &self.prefix
    }

    fn db_id(&self) -> psibase::DbId {
        self.db_id
    }
}

// #[table(name = "SavedMessageTable", index = 1)]
#[derive(Debug, Fracpack, Serialize, Deserialize, ToSchema, SimpleObject)]
pub struct SavedMessage {
    pub msg_id: u64,
    pub receiver: AccountNumber,
    pub sender: AccountNumber,
    pub subject: String,
    pub body: String,
    pub datetime: TimePointSec,
}

impl SavedMessage {
    // #[primary_key]
    fn by_msg_id(&self) -> u64 {
        self.msg_id
    }

    // #[secondary_key(1)]
    fn by_receiver(&self) -> AccountNumber {
        self.receiver
    }
}

impl psibase::TableRecord for SavedMessage {
    type PrimaryKey = u64;
    const SECONDARY_KEYS: u8 = 1u8;
    const DB: psibase::DbId = psibase::DbId::Service;
    fn get_primary_key(&self) -> Self::PrimaryKey {
        self.by_msg_id()
    }

    fn get_secondary_keys(&self) -> Vec<psibase::RawKey> {
        vec![RawKey::new(self.by_receiver().to_key())]
        // (<[_]>::into_vec(
        //     #[rustc_box]
        //     alloc::boxed::Box::new([(psibase::RawKey::new(self.by_receiver().to_key()))]),
        // ))
    }
}
