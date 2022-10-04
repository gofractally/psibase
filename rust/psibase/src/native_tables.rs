#![allow(non_snake_case)]

use crate::{AccountNumber, BlockHeader, BlockInfo, BlockNum, Claim, DbId, Fracpack, Producer};
use serde::{Deserialize, Serialize};

pub type NativeTable = u16;
pub type NativeIndex = u8;

pub const STATUS_TABLE: NativeTable = 1;
pub const CODE_TABLE: NativeTable = 2;
pub const CODE_BY_HASH_TABLE: NativeTable = 3;
pub const DATABASE_STATUS_TABLE: NativeTable = 4;
pub const TRANSACTION_WASM_CONFIG_TABLE: NativeTable = 5;
pub const PROOF_WASM_CONFIG_TABLE: NativeTable = 6; // Also for first auth
pub const CONFIG_TABLE: NativeTable = 7;
pub const PRODUCER_CONFIG_TABLE: NativeTable = 8;

pub const NATIVE_TABLE_PRIMARY_INDEX: NativeIndex = 0;

trait NativeRow {
    type Key;
    const DB: DbId;
    fn key(&self) -> Self::Key;
}

pub fn status_key() -> (NativeTable, NativeIndex) {
    (STATUS_TABLE, NATIVE_TABLE_PRIMARY_INDEX)
}

#[derive(Debug, Clone, Fracpack, Serialize, Deserialize)]
#[fracpack(fracpack_mod = "fracpack")]
pub struct StatusRow {
    pub current: BlockHeader,
    pub head: Option<BlockInfo>,
    pub producers: Vec<Producer>,
    pub nextProducers: Option<(Vec<Producer>, BlockNum)>,
}

impl NativeRow for StatusRow {
    type Key = (NativeTable, NativeIndex);
    const DB: DbId = DbId::NativeUnconstrained;
    fn key(&self) -> Self::Key {
        status_key()
    }
}

#[derive(Debug, Clone, Fracpack, Serialize, Deserialize)]
#[fracpack(fracpack_mod = "fracpack")]
pub struct ConfigRow {
    pub maxKeySize: u32,
    pub maxValueSize: u32,
}

impl NativeRow for ConfigRow {
    type Key = (NativeTable, NativeIndex);
    const DB: DbId = DbId::NativeConstrained;
    fn key(&self) -> Self::Key {
        (CONFIG_TABLE, NATIVE_TABLE_PRIMARY_INDEX)
    }
}

pub fn producer_config_key(producer: AccountNumber) -> (NativeTable, AccountNumber) {
    (PRODUCER_CONFIG_TABLE, producer)
}

#[derive(Debug, Clone, Fracpack, Serialize, Deserialize)]
#[fracpack(fracpack_mod = "fracpack")]
pub struct ProducerConfigRow {
    pub producerName: AccountNumber,
    pub producerAuth: Claim,
}

impl NativeRow for ProducerConfigRow {
    type Key = (NativeTable, AccountNumber);
    const DB: DbId = DbId::NativeConstrained;
    fn key(&self) -> Self::Key {
        producer_config_key(self.producerName)
    }
}
