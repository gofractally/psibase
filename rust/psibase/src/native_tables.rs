#![allow(non_snake_case)]

use crate::{
    AccountNumber, BlockHeader, BlockHeaderAuthAccount, BlockInfo, BlockNum, Checksum256, Claim, Consensus, DbId, Pack, Reflect, Unpack
};
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

pub fn status_key() -> (NativeTable, NativeIndex) {
    (STATUS_TABLE, NATIVE_TABLE_PRIMARY_INDEX)
}

#[derive(Debug, Clone, Pack, Unpack, Reflect, Serialize, Deserialize)]
#[fracpack(fracpack_mod = "fracpack")]
#[reflect(psibase_mod = "crate")]
pub struct StatusRow {
    pub chainId: Checksum256,
    pub current: BlockHeader,
    pub head: Option<BlockInfo>,
    pub consensus: Consensus,
    pub nextConsensus: Option<(Consensus, BlockNum)>,
    pub authServices: Vec<BlockHeaderAuthAccount>,
}

impl StatusRow {
    pub const DB: DbId = DbId::NativeUnconstrained;

    pub fn key(&self) -> (NativeTable, NativeIndex) {
        status_key()
    }
}

#[derive(Debug, Clone, Pack, Unpack, Reflect, Serialize, Deserialize)]
#[fracpack(fracpack_mod = "fracpack")]
#[reflect(psibase_mod = "crate")]
pub struct ConfigRow {
    pub maxKeySize: u32,
    pub maxValueSize: u32,
}

impl ConfigRow {
    pub const DB: DbId = DbId::NativeConstrained;

    pub fn key(&self) -> (NativeTable, NativeIndex) {
        (CONFIG_TABLE, NATIVE_TABLE_PRIMARY_INDEX)
    }
}

pub fn producer_config_key(producer: AccountNumber) -> (NativeTable, AccountNumber) {
    (PRODUCER_CONFIG_TABLE, producer)
}

#[derive(Debug, Clone, Pack, Unpack, Reflect, Serialize, Deserialize)]
#[fracpack(fracpack_mod = "fracpack")]
#[reflect(psibase_mod = "crate")]
pub struct ProducerConfigRow {
    pub producerName: AccountNumber,
    pub producerAuth: Claim,
}

impl ProducerConfigRow {
    pub const DB: DbId = DbId::NativeConstrained;

    pub fn key(&self) -> (NativeTable, AccountNumber) {
        producer_config_key(self.producerName)
    }
}
