#![allow(non_snake_case)]

use crate::{
    AccountNumber, Action, BlockHeader, BlockInfo, BlockNum, Checksum256, Claim, DbId, JointConsensus, MethodNumber, MicroSeconds, };
use async_graphql::{InputObject, SimpleObject};

pub type NativeTable = u16;
pub type NativeIndex = u8;

/// Execution policy versions (`CodeRow::vmVersion`). A service keeps the
/// version it was deployed under until it is next deployed. Strict is the
/// WebAssembly deterministic profile; performance fuses relaxed SIMD
/// multiply-add. Both are deterministic on every engine.
pub const VM_VERSION_STRICT: u8 = 0;
pub const VM_VERSION_PERFORMANCE: u8 = 1;
/// What genesis services get. SetCode stamps its own default on later
/// deployments that do not ask for a version.
pub const DEFAULT_VM_VERSION: u8 = VM_VERSION_PERFORMANCE;

pub const STATUS_TABLE: NativeTable = 1;
pub const CODE_TABLE: NativeTable = 2;
pub const CODE_BY_HASH_TABLE: NativeTable = 3;
// pub const DATABASE_STATUS_TABLE: NativeTable = 4;
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
pub const ENV_TABLE: NativeTable = 16;
pub const HOST_CONFIG_TABLE: NativeTable = 17;
pub const PENDING_SHUTDOWN_TABLE: NativeTable = 18;

pub const NATIVE_TABLE_PRIMARY_INDEX: NativeIndex = 0;

pub fn status_key() -> (NativeTable, NativeIndex) {
    (STATUS_TABLE, NATIVE_TABLE_PRIMARY_INDEX)
}

#[derive(Debug, Clone, psio::PsszPack, psio::PsszUnpack, psio::PsszView, psio::ToPsszSchema, psio::JsonText, psio::Serde)]
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

#[derive(Debug, Clone, psio::PsszPack, psio::PsszUnpack, psio::PsszView, psio::ToPsszSchema, psio::JsonText, psio::Serde)]
pub struct ConfigRow {
    #[psio(default = 128)]
    pub maxKeySize: u32,
    #[psio(default = 8388608)]
    pub maxValueSize: u32,
    /// The most bytes of transactions a block may hold.
    #[psio(default = 4194304)]
    pub maxBlockSize: u32,
}

impl ConfigRow {
    pub const DB: DbId = DbId::Native;

    pub fn key(&self) -> (NativeTable, NativeIndex) {
        (CONFIG_TABLE, NATIVE_TABLE_PRIMARY_INDEX)
    }
}

#[derive(
    Debug,
    Clone,
    psio::PsszPack,
    psio::PsszUnpack,
    psio::PsszView,
    psio::ToPsszSchema,
    psio::JsonText,
    psio::Serde,
)]
pub struct VMOptions {
    #[psio(default = 1024)]
    max_mutable_global_bytes: u32,
    #[psio(default = 512)]
    max_pages: u32,
    #[psio(default = 8192)]
    max_table_elements: u32,
    #[psio(default = 1048576)]
    max_stack_bytes: u32,
}

#[derive(
    Debug,
    Clone,
    psio::PsszPack,
    psio::PsszUnpack,
    psio::PsszView,
    psio::ToPsszSchema,
    psio::JsonText,
    psio::Serde,
)]
pub struct WasmConfigRow {
    #[psio(default = 32)]
    numExecutionMemories: u32,
    vmOptions: VMOptions,
}

impl WasmConfigRow {
    pub const DB: DbId = DbId::Native;
    pub fn key(table: NativeTable) -> (NativeTable, NativeIndex) {
        (table, NATIVE_TABLE_PRIMARY_INDEX)
    }
}

#[derive(Debug, Clone, psio::PsszPack, psio::PsszUnpack, psio::PsszView, psio::ToPsszSchema, psio::JsonText, psio::Serde)]
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
#[derive(Debug, Clone, psio::PsszPack, psio::PsszUnpack, psio::PsszView, psio::ToPsszSchema, psio::JsonText, psio::Serde)]
pub struct CodeByHashRow {
    pub codeHash: Checksum256,
    pub vmType: u8,
    pub vmVersion: u8,

    pub code: Vec<u8>,
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

#[derive(Debug, Clone, psio::PsszPack, psio::PsszUnpack, psio::PsszView, psio::ToPsszSchema, psio::JsonText, psio::Serde)]
pub struct NotifyRow {
    #[serde(rename = "type")]
    type_: u32,
    actions: Vec<Action>,
}

impl NotifyRow {
    pub const DB: DbId = DbId::Native;
    pub fn key(&self) -> (NativeTable, NativeIndex, u32) {
        (NOTIFY_TABLE, NATIVE_TABLE_PRIMARY_INDEX, self.type_)
    }
}

#[derive(Debug, Clone, psio::PsszPack, psio::PsszUnpack, psio::PsszView, psio::ToPsszSchema, psio::JsonText, psio::Serde)]
pub struct BlockDataRow {
    pub blockId: Checksum256,
    pub auxConsensusData: Option<Vec<u8>>,
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

#[derive(
    Debug,
    Clone,
    psio::PsszPack,
    psio::PsszUnpack,
    psio::PsszView,
    psio::ToPsszSchema,
    psio::JsonText,
    psio::Serde,
)]
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

#[derive(Debug, Clone, PartialEq, Eq, psio::PsszPack, psio::PsszUnpack, psio::PsszView, psio::ToPsszSchema, psio::JsonText, psio::Serde)]
pub struct StateChecksum {
    pub serviceRoot: Checksum256,
    pub nativeRoot: Checksum256,
}

#[derive(Debug, Clone, psio::PsszPack, psio::PsszUnpack, psio::PsszView, psio::ToPsszSchema, psio::JsonText, psio::Serde)]
pub struct StateSignature {
    pub account: AccountNumber,
    pub claim: Claim,
    pub rawData: Vec<u8>,
}

#[derive(Debug, Clone, psio::PsszPack, psio::PsszUnpack, psio::PsszView, psio::ToPsszSchema, psio::JsonText, psio::Serde)]
pub struct SnapshotStateItem {
    pub state: StateChecksum,
    pub signatures: Vec<StateSignature>,
}

#[derive(Debug, Clone, psio::PsszPack, psio::PsszUnpack, psio::PsszView, psio::ToPsszSchema, psio::JsonText, psio::Serde)]
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

#[derive(
    Debug,
    Clone,
    psio::PsszPack,
    psio::PsszUnpack,
    psio::PsszView,
    psio::ToPsszSchema,
    psio::JsonText,
    psio::Serde,
)]
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
#[derive(
    Debug,
    Clone,
    psio::PsszPack,
    psio::PsszUnpack,
    psio::PsszView,
    psio::ToPsszSchema,
    psio::JsonText,
    psio::Serde,
)]
pub struct LogTruncateRow {
    pub start: BlockNum,
}

impl LogTruncateRow {
    pub const DB: DbId = DbId::NativeSubjective;
    pub fn key(&self) -> (NativeTable, NativeIndex) {
        (LOG_TRUNCATE_TABLE, NATIVE_TABLE_PRIMARY_INDEX)
    }
}

#[derive(
    Debug,
    Clone,
    PartialEq,
    Eq,
    psio::PsszPack,
    psio::PsszUnpack,
    psio::PsszView,
    psio::ToPsszSchema,
    psio::JsonText,
    psio::Serde,
)]
#[psio(definition_will_not_change)]
pub struct IPV4Address {
    pub bytes: [u8; 4],
}

#[derive(
    Debug,
    Clone,
    PartialEq,
    Eq,
    psio::PsszPack,
    psio::PsszUnpack,
    psio::PsszView,
    psio::ToPsszSchema,
    psio::JsonText,
    psio::Serde,
)]
#[psio(definition_will_not_change)]
pub struct IPV6Address {
    pub bytes: [u8; 16],
    pub zone: u32,
}

/// An IP address. Packed, it is the variant; its text, which is its JSON,
/// is one string: `"127.0.0.1"`, `"::1"` (C++ `psibase::IPAddress`, the
/// authority; `ip_text.rs` has the printer and the parser).
#[derive(Debug, Clone, PartialEq, Eq, psio::PsszPack, psio::PsszUnpack, psio::ToPsszSchema, psio::Serde)]
#[psio(custom = "IPAddress")]
pub enum IPAddress {
    IPV4Address(IPV4Address),
    IPV6Address(IPV6Address),
}

impl psio::json::TextForm for IPAddress {
    fn to_text(&self, out: &mut String) {
        crate::ip_text::write_address(self, out)
    }
    fn from_text(text: &str) -> Option<Self> {
        crate::ip_text::parse_address(text)
    }
}
psio::json_text_form!(IPAddress);

impl std::fmt::Display for IPAddress {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        let mut text = String::new();
        crate::ip_text::write_address(self, &mut text);
        f.write_str(&text)
    }
}

impl std::str::FromStr for IPAddress {
    type Err = &'static str;
    fn from_str(text: &str) -> Result<Self, Self::Err> {
        crate::ip_text::parse_address(text).ok_or("IPAddress: not an IP address")
    }
}

#[derive(
    Debug,
    Clone,
    PartialEq,
    Eq,
    psio::PsszPack,
    psio::PsszUnpack,
    psio::PsszView,
    psio::ToPsszSchema,
    psio::JsonText,
    psio::Serde,
)]
#[psio(definition_will_not_change)]
pub struct IPV4Endpoint {
    pub address: IPV4Address,
    pub port: u16,
}

#[derive(
    Debug,
    Clone,
    PartialEq,
    Eq,
    psio::PsszPack,
    psio::PsszUnpack,
    psio::PsszView,
    psio::ToPsszSchema,
    psio::JsonText,
    psio::Serde,
)]
#[psio(definition_will_not_change)]
pub struct IPV6Endpoint {
    pub address: IPV6Address,
    pub port: u16,
}

#[derive(
    Debug,
    Clone,
    PartialEq,
    Eq,
    psio::PsszPack,
    psio::PsszUnpack,
    psio::PsszView,
    psio::ToPsszSchema,
    psio::JsonText,
    psio::Serde,
)]
#[psio(definition_will_not_change)]
pub struct LocalEndpoint {
    pub path: psio::pssz::RawString,
}

/// The address of a socket. Packed, it is the variant; its text, which is
/// its JSON, is one string: `"127.0.0.1:8080"`, `"[::1]:8080"`, and any
/// other text is the path of a local socket (C++ `psibase::SocketEndpoint`,
/// the authority).
#[derive(Debug, Clone, PartialEq, Eq, psio::PsszPack, psio::PsszUnpack, psio::ToPsszSchema, psio::Serde)]
#[psio(custom = "SocketEndpoint")]
pub enum SocketEndpoint {
    IPV4Endpoint(IPV4Endpoint),
    IPV6Endpoint(IPV6Endpoint),
    LocalEndpoint(LocalEndpoint),
}

impl psio::json::TextForm for SocketEndpoint {
    fn to_text(&self, out: &mut String) {
        crate::ip_text::write_endpoint(self, out)
    }
    fn from_text(text: &str) -> Option<Self> {
        Some(crate::ip_text::parse_endpoint(text))
    }
}
psio::json_text_form!(SocketEndpoint);

impl std::fmt::Display for SocketEndpoint {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        let mut text = String::new();
        crate::ip_text::write_endpoint(self, &mut text);
        f.write_str(&text)
    }
}

impl std::str::FromStr for SocketEndpoint {
    type Err = std::convert::Infallible;
    fn from_str(text: &str) -> Result<Self, Self::Err> {
        Ok(crate::ip_text::parse_endpoint(text))
    }
}

#[derive(
    Debug,
    Clone,
    psio::PsszPack,
    psio::PsszUnpack,
    psio::PsszView,
    psio::ToPsszSchema,
    psio::JsonText,
    psio::Serde,
)]
pub struct TLSInfo {}

#[derive(Debug, Clone, psio::PsszPack, psio::PsszUnpack, psio::PsszView, psio::ToPsszSchema, psio::JsonText, psio::Serde)]
pub struct ProducerMulticastSocketInfo {}

#[derive(Debug, Clone, psio::PsszPack, psio::PsszUnpack, psio::PsszView, psio::ToPsszSchema, psio::JsonText, psio::Serde)]
pub struct LogSocketInfo {}

#[derive(Debug, Clone, psio::PsszPack, psio::PsszUnpack, psio::PsszView, psio::ToPsszSchema, psio::JsonText, psio::Serde)]
pub struct HttpSocketInfo {
    endpoint: Option<SocketEndpoint>,
    tls: Option<TLSInfo>,
}

#[derive(Debug, Clone, psio::PsszPack, psio::PsszUnpack, psio::PsszView, psio::ToPsszSchema, psio::JsonText, psio::Serde)]
pub struct HttpClientSocketInfo {
    endpoint: Option<SocketEndpoint>,
    tls: Option<TLSInfo>,
}

#[derive(Debug, Clone, psio::PsszPack, psio::PsszUnpack, psio::PsszView, psio::ToPsszSchema, psio::JsonText, psio::Serde)]
pub struct WebSocketInfo {
    endpoint: Option<SocketEndpoint>,
    tls: Option<TLSInfo>,
}

#[derive(Debug, Clone, psio::PsszPack, psio::PsszUnpack, psio::PsszView, psio::ToPsszSchema, psio::JsonText, psio::Serde)]
pub struct P2PSocketInfo {
    endpoint: Option<SocketEndpoint>,
    tls: Option<TLSInfo>,
}

/// What a socket is. The alternatives and their order are those of the
/// C++ variant (`psibase/SocketInfo.hpp`).
#[derive(Debug, Clone, psio::PsszPack, psio::PsszUnpack, psio::ToPsszSchema, psio::JsonText, psio::Serde)]
pub enum SocketInfo {
    ProducerMulticastSocketInfo(ProducerMulticastSocketInfo),
    LogSocketInfo(LogSocketInfo),
    HttpSocketInfo(HttpSocketInfo),
    HttpClientSocketInfo(HttpClientSocketInfo),
    WebSocketInfo(WebSocketInfo),
    P2PSocketInfo(P2PSocketInfo),
}

#[derive(Debug, Clone, psio::PsszPack, psio::PsszUnpack, psio::PsszView, psio::ToPsszSchema, psio::JsonText, psio::Serde)]
pub struct LogMessage {
    #[psio(default = 1)]
    pub severity: u32,
    pub message: String,
    pub service: Option<AccountNumber>,
}

impl LogMessage {
    pub const DEBUG: u32 = 0;
    pub const INFO: u32 = 1;
    pub const NOTICE: u32 = 2;
    pub const WARNING: u32 = 3;
    pub const ERROR: u32 = 4;
    pub const CRITICAL: u32 = 5;
}

#[derive(Debug, Clone, psio::PsszPack, psio::PsszUnpack, psio::PsszView, psio::ToPsszSchema, psio::JsonText, psio::Serde)]
pub struct SocketRow {
    fd: i32,
    info: SocketInfo,
}

impl SocketRow {
    // Well-known fds
    pub const PRODUCER_MULTICAST: i32 = 0;
    pub const LOG: i32 = 1;

    pub const DB: DbId = DbId::NativeSubjective;
    pub fn key(&self) -> (NativeTable, NativeIndex, i32) {
        (SOCKET_TABLE, NATIVE_TABLE_PRIMARY_INDEX, self.fd)
    }
}

/// How an action is run. In every format it is its number, as the C++
/// `enum class RunMode : std::uint8_t` is (the legacy derive already packs
/// a struct of one unnamed member as that member).
#[derive(
    Debug,
    Clone,
    Copy,
    PartialEq,
    Eq,
    psio::PsszPack,
    psio::PsszUnpack,
    psio::ToPsszSchema,
    psio::Key,
    psio::JsonText,
    psio::Serde,
)]
#[psio(transparent)]
#[repr(transparent)]
pub struct RunMode(u8);

impl RunMode {
    pub const VERIFY: RunMode = RunMode(0);
    pub const SPECULATIVE: RunMode = RunMode(1);
    pub const RPC: RunMode = RunMode(2);
    pub const CALLBACK: RunMode = RunMode(3);
}

pub type RunToken = Vec<u8>;

/// Identify a service and method
#[derive(
    Copy,
    Clone,
    Debug,
    SimpleObject,
    InputObject,
    psio::PsszPack,
    psio::PsszUnpack,
    psio::PsszView,
    psio::ToPsszSchema,
    psio::Key,
    psio::JsonText,
    psio::Serde,
)]
#[graphql(input_name = "ServiceMethodInput")]
#[psio(custom = "ServiceMethod")]
pub struct ServiceMethod {
    pub service: AccountNumber,
    pub method: MethodNumber,
}

impl ServiceMethod {
    pub fn new(service: AccountNumber, method: MethodNumber) -> Self {
        Self { service, method }
    }
}

#[derive(
    Debug,
    Clone,
    psio::PsszPack,
    psio::PsszUnpack,
    psio::PsszView,
    psio::ToPsszSchema,
    psio::JsonText,
    psio::Serde,
)]
pub struct RunRow {
    id: u64,
    mode: RunMode,
    maxTime: MicroSeconds,
    action: Action,
    continuation: ServiceMethod,
}

impl RunRow {
    pub const DB: DbId = DbId::NativeSubjective;
    pub fn key(&self) -> (NativeTable, NativeIndex, u64) {
        (RUN_TABLE, NATIVE_TABLE_PRIMARY_INDEX, self.id)
    }
}

#[derive(
    Debug,
    Clone,
    psio::PsszPack,
    psio::PsszUnpack,
    psio::PsszView,
    psio::ToPsszSchema,
    psio::JsonText,
    psio::Serde,
)]
pub struct EnvRow {
    pub name: psio::pssz::RawString,
    pub value: psio::pssz::RawString,
}

impl EnvRow {
    pub const DB: DbId = DbId::NativeSession;
    pub fn key(&self) -> (NativeTable, NativeIndex, psio::pssz::RawString) {
        (ENV_TABLE, NATIVE_TABLE_PRIMARY_INDEX, self.name.clone())
    }
}

#[derive(
    Debug,
    Clone,
    psio::PsszPack,
    psio::PsszUnpack,
    psio::PsszView,
    psio::ToPsszSchema,
    psio::JsonText,
    psio::Serde,
)]
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

#[derive(
    Debug,
    Clone,
    psio::PsszPack,
    psio::PsszUnpack,
    psio::PsszView,
    psio::ToPsszSchema,
    psio::JsonText,
    psio::Serde,
)]
pub struct PendingShutdownRow {
    pub args: String,
}

impl PendingShutdownRow {
    pub const DB: DbId = DbId::NativeSession;
    pub fn key(&self) -> (NativeTable, NativeIndex) {
        (PENDING_SHUTDOWN_TABLE, NATIVE_TABLE_PRIMARY_INDEX)
    }
}
