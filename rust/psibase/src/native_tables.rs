#![allow(non_snake_case)]

use crate::{
    AccountNumber, Action, BlockHeader, BlockInfo, BlockNum, Checksum256, Claim, DbId, Hex,
    JointConsensus, MethodNumber, MicroSeconds, Pack, ToSchema, Unpack,
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
pub const BLOCK_DATA_TABLE: NativeTable = 9;
pub const CONSENSUS_CHANGE_TABLE: NativeTable = 10;
pub const SNAPSHOT_TABLE: NativeTable = 11;
pub const SCHEDULED_SNAPSHOT_TABLE: NativeTable = 12;
pub const LOG_TRUNCATE_TABLE: NativeTable = 13;
pub const SOCKET_TABLE: NativeTable = 14;
pub const RUN_TABLE: NativeTable = 15;
pub const HOST_CONFIG_TABLE: NativeTable = 17;

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
    pub consensus: JointConsensus,
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
    pub codeNum: AccountNumber,
    pub flags: u64,

    pub codeHash: Checksum256,
    pub vmType: u8,
    pub vmVersion: u8,
}

impl CodeRow {
    pub const DB: DbId = DbId::Native;
    pub const IS_PRIVILEGED: u64 = 1u64 << 0;
    pub const IS_VERIFY: u64 = 1u64 << 1;
    pub const IS_REPLACEMENT: u64 = 1u64 << 32;
    pub fn key(&self) -> (NativeTable, NativeIndex, AccountNumber) {
        (CODE_TABLE, NATIVE_TABLE_PRIMARY_INDEX, self.codeNum)
    }
}

/// where code is actually stored, duplicate services are reused
#[derive(Debug, Clone, Pack, Unpack, ToSchema, Serialize, Deserialize)]
#[fracpack(fracpack_mod = "fracpack")]
pub struct CodeByHashRow {
    pub codeHash: Checksum256,
    pub vmType: u8,
    pub vmVersion: u8,

    pub code: Hex<Vec<u8>>,
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

#[derive(Debug, Clone, Pack, Unpack, ToSchema, Serialize, Deserialize)]
#[fracpack(fracpack_mod = "fracpack")]
pub struct BlockDataRow {
    pub blockId: Checksum256,
    pub auxConsensusData: Option<Hex<Vec<u8>>>,
}

impl BlockDataRow {
    pub const DB: DbId = DbId::NativeSubjective;
    pub fn key(&self) -> (NativeTable, NativeIndex, Checksum256) {
        (
            BLOCK_DATA_TABLE,
            NATIVE_TABLE_PRIMARY_INDEX,
            self.blockId.clone(),
        )
    }
}

#[derive(Debug, Clone, Pack, Unpack, ToSchema, Serialize, Deserialize)]
#[fracpack(fracpack_mod = "fracpack")]
pub struct ConsensusChangeRow {
    pub start: BlockNum,
    pub commit: BlockNum,
    pub end: BlockNum,
}

impl ConsensusChangeRow {
    pub const DB: DbId = DbId::NativeSubjective;
    pub fn key(&self) -> (NativeTable, NativeIndex, BlockNum) {
        (
            CONSENSUS_CHANGE_TABLE,
            NATIVE_TABLE_PRIMARY_INDEX,
            self.start,
        )
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Pack, Unpack, ToSchema, Serialize, Deserialize)]
#[fracpack(fracpack_mod = "fracpack")]
pub struct StateChecksum {
    pub serviceRoot: Checksum256,
    pub nativeRoot: Checksum256,
}

#[derive(Debug, Clone, Pack, Unpack, ToSchema, Serialize, Deserialize)]
#[fracpack(fracpack_mod = "fracpack")]
pub struct StateSignature {
    pub account: AccountNumber,
    pub claim: Claim,
    pub rawData: Hex<Vec<u8>>,
}

#[derive(Debug, Clone, Pack, Unpack, ToSchema, Serialize, Deserialize)]
#[fracpack(fracpack_mod = "fracpack")]
pub struct SnapshotStateItem {
    pub state: StateChecksum,
    pub signatures: Vec<StateSignature>,
}

#[derive(Debug, Clone, Pack, Unpack, ToSchema, Serialize, Deserialize)]
#[fracpack(fracpack_mod = "fracpack")]
pub struct SnapshotRow {
    pub id: Checksum256,
    pub state: Option<SnapshotStateItem>,
    pub other: Vec<SnapshotStateItem>,
}

impl SnapshotRow {
    pub const DB: DbId = DbId::NativeSubjective;
    pub fn key(&self) -> (NativeTable, NativeIndex, Checksum256) {
        (SNAPSHOT_TABLE, NATIVE_TABLE_PRIMARY_INDEX, self.id.clone())
    }
}

#[derive(Debug, Clone, Pack, Unpack, ToSchema, Serialize, Deserialize)]
#[fracpack(fracpack_mod = "fracpack")]
pub struct ScheduledSnapshotRow {
    pub blockNum: BlockNum,
}

impl ScheduledSnapshotRow {
    pub const DB: DbId = DbId::Native;
    pub fn key(&self) -> (NativeTable, NativeIndex, BlockNum) {
        (
            SCHEDULED_SNAPSHOT_TABLE,
            NATIVE_TABLE_PRIMARY_INDEX,
            self.blockNum,
        )
    }
}

// If this row is present it indicates the height the block log starts at.
#[derive(Debug, Clone, Pack, Unpack, ToSchema, Serialize, Deserialize)]
#[fracpack(fracpack_mod = "fracpack")]
pub struct LogTruncateRow {
    pub start: BlockNum,
}

impl LogTruncateRow {
    pub const DB: DbId = DbId::NativeSubjective;
    pub fn key(&self) -> (NativeTable, NativeIndex) {
        (LOG_TRUNCATE_TABLE, NATIVE_TABLE_PRIMARY_INDEX)
    }
}

#[derive(Debug, Clone, Pack, Unpack, ToSchema, Serialize, Deserialize)]
#[fracpack(fracpack_mod = "fracpack")]
pub struct ProducerMultiCastSocketInfo {}

#[derive(Debug, Clone, Pack, Unpack, ToSchema, Serialize, Deserialize)]
#[fracpack(fracpack_mod = "fracpack")]
pub struct HttpSocketInfo {}

#[derive(Debug, Clone, Pack, Unpack, ToSchema, Serialize, Deserialize)]
#[fracpack(fracpack_mod = "fracpack")]
pub enum SocketInfo {
    ProducerMultiCastSocketInfo(ProducerMultiCastSocketInfo),
    HttpSocketInfo(HttpSocketInfo),
}

#[derive(Debug, Clone, Pack, Unpack, ToSchema, Serialize, Deserialize)]
#[fracpack(fracpack_mod = "fracpack")]
pub struct SocketRow {
    fd: i32,
    info: SocketInfo,
}

impl SocketRow {
    // Well-known fds
    pub const PRODUCER_MULTICAST: i32 = 0;

    pub const DB: DbId = DbId::NativeSubjective;
    pub fn key(&self) -> (NativeTable, NativeIndex, i32) {
        (SOCKET_TABLE, NATIVE_TABLE_PRIMARY_INDEX, self.fd)
    }
}

#[derive(Debug, Clone, Pack, Unpack, ToSchema, Serialize, Deserialize)]
#[fracpack(fracpack_mod = "fracpack")]
#[repr(transparent)]
pub struct RunMode(u8);

impl RunMode {
    pub const VERIFY: RunMode = RunMode(0);
    pub const SPECULATIVE: RunMode = RunMode(1);
    pub const RPC: RunMode = RunMode(2);
    pub const CALLBACK: RunMode = RunMode(3);
}

pub type RunToken = Vec<u8>;

#[derive(Debug, Clone, Pack, Unpack, ToSchema, Serialize, Deserialize)]
#[fracpack(fracpack_mod = "fracpack")]
pub struct BoundMethod {
    service: AccountNumber,
    method: MethodNumber,
}

#[derive(Debug, Clone, Pack, Unpack, ToSchema, Serialize, Deserialize)]
#[fracpack(fracpack_mod = "fracpack")]
pub struct RunRow {
    id: u64,
    mode: RunMode,
    maxTime: MicroSeconds,
    action: Action,
    continuation: BoundMethod,
}

impl RunRow {
    pub const DB: DbId = DbId::NativeSubjective;
    pub fn key(&self) -> (NativeTable, NativeIndex, u64) {
        (RUN_TABLE, NATIVE_TABLE_PRIMARY_INDEX, self.id)
    }
}

#[derive(Debug, Clone, Pack, Unpack, ToSchema, Serialize, Deserialize)]
#[fracpack(fracpack_mod = "fracpack")]
pub struct HostConfigRow {
    pub hostVersion: String,
    pub config: String,
}

impl HostConfigRow {
    pub const DB: DbId = DbId::NativeSession;
    pub fn key(&self) -> (NativeTable, NativeIndex) {
        (HOST_CONFIG_TABLE, NATIVE_TABLE_PRIMARY_INDEX)
    }
}
