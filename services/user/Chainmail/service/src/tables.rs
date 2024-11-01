use async_graphql::SimpleObject;
use psibase::{AccountNumber, Fracpack, TableRecord, TimePointSec};
use serde::{Deserialize, Serialize};

impl TableRecord for SavedMessage {
    type PrimaryKey = u64;

    const SECONDARY_KEYS: u8 = 0;

    fn get_primary_key(&self) -> Self::PrimaryKey {
        self.msg_id
    }
}

#[derive(Debug, Fracpack, Serialize, Deserialize, SimpleObject)]
pub struct SavedMessage {
    pub msg_id: u64,
    pub receiver: AccountNumber,
    pub sender: AccountNumber,
    pub subject: String,
    pub body: String,
    pub datetime: TimePointSec,
}
