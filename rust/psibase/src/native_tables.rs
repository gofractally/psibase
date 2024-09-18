#![allow(non_snake_case)]

use crate::{
    AccountNumber, Action, BlockHeader, BlockHeaderAuthAccount, BlockInfo, BlockNum, Checksum256,
    Consensus, DbId, Hex, Pack, ToSchema, Unpack,
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
pub const NOTIFY_TABLE: NativeTable = 8;

pub const NATIVE_TABLE_PRIMARY_INDEX: NativeIndex = 0;

pub fn status_key() -> (NativeTable, NativeIndex) {
    (STATUS_TABLE, NATIVE_TABLE_PRIMARY_INDEX)
}

#[derive(Debug, Clone, Pack, Unpack, ToSchema, Serialize, Deserialize)]
#[fracpack(fracpack_mod = "fracpack")]
pub struct StatusRow {
    pub chainId: Checksum256,
    pub current: BlockHeader,
    pub head: Option<BlockInfo>,
    pub consensus: Consensus,
    pub nextConsensus: Option<(Consensus, BlockNum)>,
    pub authServices: Vec<BlockHeaderAuthAccount>,
}

impl StatusRow {
    pub const DB: DbId = DbId::Native;

    pub fn key(&self) -> (NativeTable, NativeIndex) {
        status_key()
    }
}

#[derive(Debug, Clone, Pack, Unpack, ToSchema, Serialize, Deserialize)]
#[fracpack(fracpack_mod = "fracpack")]
pub struct ConfigRow {
    pub maxKeySize: u32,
    pub maxValueSize: u32,
}

impl ConfigRow {
    pub const DB: DbId = DbId::Native;

    pub fn key(&self) -> (NativeTable, NativeIndex) {
        (CONFIG_TABLE, NATIVE_TABLE_PRIMARY_INDEX)
    }
}

#[derive(Debug, Clone, Pack, Unpack, ToSchema, Serialize, Deserialize)]
#[fracpack(fracpack_mod = "fracpack")]
pub struct VMOptions {
    max_mutable_global_bytes: u32,
    max_pages: u32,
    max_table_elements: u32,
    max_stack_bytes: u32,
}

#[derive(Debug, Clone, Pack, Unpack, ToSchema, Serialize, Deserialize)]
#[fracpack(fracpack_mod = "fracpack")]
pub struct WasmConfigRow {
    numExecutionMemories: u32,
    vmOptions: VMOptions,
}

impl WasmConfigRow {
    pub const DB: DbId = DbId::Native;
    pub fn key(table: NativeTable) -> (NativeTable, NativeIndex) {
        (table, NATIVE_TABLE_PRIMARY_INDEX)
    }
}

#[derive(Debug, Clone, Pack, Unpack, ToSchema, Serialize, Deserialize)]
#[fracpack(fracpack_mod = "fracpack")]
pub struct CodeRow {
    codeNum: AccountNumber,
    flags: u64,

    codeHash: Checksum256,
    vmType: u8,
    vmVersion: u8,
}

impl CodeRow {
    pub const DB: DbId = DbId::Native;
    pub const ALLOW_SUDO: u64 = 1u64 << 0;
    pub const ALLOW_WRITE_NATIVE: u64 = 1u64 << 1;
    pub const IS_SUBJECTIVE: u64 = 1u64 << 2;
    pub const ALLOW_WRITE_SUBJECTIVE: u64 = 1u64 << 3;
    pub const CANNOT_TIME_OUT: u64 = 1u64 << 4;
    pub const CAN_SET_TIME_LIMIT: u64 = 1u64 << 5;
    pub const IS_AUTH_SERVICE: u64 = 1u64 << 6;
    pub const FORCE_REPLAY: u64 = 1u64 << 7;
    pub const ALLOW_SOCKET: u64 = 1u64 << 8;
    pub fn key(&self) -> (NativeTable, NativeIndex, AccountNumber) {
        (CODE_TABLE, NATIVE_TABLE_PRIMARY_INDEX, self.codeNum)
    }
}

/// where code is actually stored, duplicate services are reused
#[derive(Debug, Clone, Pack, Unpack, ToSchema, Serialize, Deserialize)]
#[fracpack(fracpack_mod = "fracpack")]
pub struct CodeByHashRow {
    codeHash: Checksum256,
    vmType: u8,
    vmVersion: u8,

    numRefs: u32,
    code: Hex<Vec<u8>>,
}

impl CodeByHashRow {
    pub const DB: DbId = DbId::Native;
    pub fn key(&self) -> (NativeTable, NativeIndex, Checksum256, u8, u8) {
        (
            CODE_BY_HASH_TABLE,
            NATIVE_TABLE_PRIMARY_INDEX,
            self.codeHash.clone(),
            self.vmType,
            self.vmVersion,
        )
    }
}

#[derive(Debug, Clone, Pack, Unpack, ToSchema, Serialize, Deserialize)]
#[fracpack(fracpack_mod = "fracpack")]
pub struct DatabaseStatusRow {
    nextHistoryEventNumber: u64,
    nextUIEventNumber: u64,
    nextMerkleEventNumber: u64,

    blockMerkleEventNumber: u64,
}

impl DatabaseStatusRow {
    pub const DB: DbId = DbId::Native;
    pub fn key(&self) -> (NativeTable, NativeIndex) {
        (DATABASE_STATUS_TABLE, NATIVE_TABLE_PRIMARY_INDEX)
    }
}

#[derive(Debug, Clone, Pack, Unpack, ToSchema, Serialize, Deserialize)]
#[fracpack(fracpack_mod = "fracpack")]
pub struct NotifyRow {
    type_: u32,
    actions: Vec<Action>,
}

impl NotifyRow {
    pub const DB: DbId = DbId::Native;
    pub fn key(&self) -> (NativeTable, NativeIndex) {
        (NOTIFY_TABLE, NATIVE_TABLE_PRIMARY_INDEX)
    }
}
