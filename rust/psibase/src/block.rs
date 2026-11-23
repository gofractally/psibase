#![allow(non_snake_case)]

use crate::{
    AccountNumber, MethodNumber, TimePointSec, TimePointUSec, WasmConfigRow,
};
use async_graphql::{InputObject, SimpleObject, Union};

// TODO: move
/// A SHA-256 digest: 32 bytes, hex in JSON (C++ `psibase::Checksum256`).
pub type Checksum256 = [u8; 32];

pub type BlockNum = u32;
pub type BlockTime = TimePointUSec;

/// A synchronous call
///
/// An Action represents a synchronous call between services.
/// It is the argument to [crate::native_raw::call] and can be fetched
/// using [crate::native_raw::getCurrentAction].
///
/// Transactions also contains actions requested by the
/// transaction authorizers.
#[derive(
    Debug,
    Clone,
    Default,
    SimpleObject,
    InputObject,
    PartialEq,
    Eq,
    psio::PsszPack,
    psio::PsszUnpack,
    psio::PsszView,
    psio::ToPsszSchema,
    psio::Key,
    psio::JsonText,
    psio::Serde,
)]
#[psio(custom = "Action")]
#[graphql(input_name = "ActionInput")]
#[graphql(complex)]
pub struct Action {
    /// Account sending the action
    pub sender: AccountNumber,

    /// Service to execute the action
    pub service: AccountNumber,

    /// Service method to execute
    pub method: MethodNumber,

    /// Data for the method
    #[graphql(skip_output)]
    pub rawData: Vec<u8>,
}

/// In GraphQL the bytes are hex text, as in JSON.
#[async_graphql::ComplexObject]
impl Action {
    #[allow(non_snake_case)]
    async fn rawData(&self) -> String {
        crate::to_hex(&self.rawData)
    }
}

/// The genesis action is the first action of the first transaction of
/// the first block. The action struct's fields are ignored, except
/// rawData, which contains this struct.
#[derive(Debug, Clone, Default, psio::PsszPack, psio::PsszUnpack, psio::PsszView, psio::ToPsszSchema, psio::Key, psio::JsonText, psio::Serde)]
pub struct GenesisActionData {
    pub memo: String,
    pub services: Vec<GenesisService>,
}

#[derive(Debug, Clone, Default, psio::PsszPack, psio::PsszUnpack, psio::PsszView, psio::ToPsszSchema, psio::Key, psio::JsonText, psio::Serde)]
pub struct GenesisService {
    pub service: AccountNumber,
    pub flags: u64,
    pub vmType: u8,
    pub vmVersion: u8,
    pub code: Vec<u8>,
}

#[derive(
    Debug,
    Clone,
    Default,
    SimpleObject,
    InputObject,
    PartialEq,
    Eq,
    psio::PsszPack,
    psio::PsszUnpack,
    psio::PsszView,
    psio::ToPsszSchema,
    psio::Key,
    psio::JsonText,
    psio::Serde,
)]
#[graphql(input_name = "ClaimInput")]
#[graphql(complex)]
pub struct Claim {
    pub service: AccountNumber,
    #[graphql(skip_output)]
    pub rawData: Vec<u8>,
}

/// In GraphQL the bytes are hex text, as in JSON.
#[async_graphql::ComplexObject]
impl Claim {
    #[allow(non_snake_case)]
    async fn rawData(&self) -> String {
        crate::to_hex(&self.rawData)
    }
}

/// Rules for TAPOS:
/// * Reference block's number must be either:
///    * One of the most-recent 128 blocks. For this case, refBlockIndex = blockNum & 0x7f
///    * A multiple of 8192. For this case, refBlockIndex = (blockNum >> 13) | 0x80
/// * refBlockSuffix = last 4 bytes of the block ID, bit-casted to u32     .
///
/// Transact maintains block suffixes for:
/// * The most-recent 128 blocks. This allows transactions to depend on other recent transactions.
/// * The most-recent 128 blocks which have block numbers which are a multiple of 8192. This gives
///   users which sign transactions offline plenty of time to do so.
///
/// If the blocks are all 1 second apart, then the second case allows up to 12 days to sign and execute
/// a transaction. If the blocks have variable length, then the amount of available time will vary with
/// network activity. If we assume a max sustained block rate of 4 per sec, then this still allows 3 days.
///
/// A transaction will be rejected if:
/// * It is expired.
/// * It arrives earlier than (expired - maxTrxLifetime). maxTrxLifetime
///   is defined in Transact.cpp and may be changed in the future.
/// * It references a block that isn't on the current fork, or a block which
///   is too old. For best results, use the most-recent irreversible block which
///   meets the criteria.
#[derive(
    Debug,
    Clone,
    Default,
    SimpleObject,
    InputObject,
    PartialEq,
    Eq,
    psio::PsszPack,
    psio::PsszUnpack,
    psio::PsszView,
    psio::ToPsszSchema,
    psio::Key,
    psio::JsonText,
    psio::Serde,
)]
#[graphql(input_name = "TaposInput")]
#[psio(definition_will_not_change)]
pub struct Tapos {
    pub expiration: TimePointSec,
    pub refBlockSuffix: u32,
    pub flags: u16,
    pub refBlockIndex: u8,
}

impl Tapos {
    pub const DO_NOT_BROADCAST_FLAG: u16 = 1 << 0;
    pub const VALID_FLAGS: u16 = 0x0001;
}

#[derive(
    Debug,
    Clone,
    Default,
    SimpleObject,
    InputObject,
    PartialEq,
    Eq,
    psio::PsszPack,
    psio::PsszUnpack,
    psio::PsszView,
    psio::ToPsszSchema,
    psio::Key,
    psio::JsonText,
    psio::Serde,
)]
#[graphql(input_name = "TransactionInput")]
pub struct Transaction {
    pub tapos: Tapos,
    pub actions: Vec<Action>,
    pub claims: Vec<Claim>,
}

#[derive(
    Debug,
    Clone,
    Default,
    PartialEq,
    Eq,
    psio::PsszPack,
    psio::PsszUnpack,
    psio::PsszView,
    psio::ToPsszSchema,
    psio::Key,
    psio::JsonText,
    psio::Serde,
)]
pub struct SignedTransaction {
    /// The packed transaction: a byte list holding the PSSZ of a
    /// `Transaction` (C++ `psio::nested<Transaction>`).
    pub transaction: psio::pssz::Nested<Transaction>,
    pub proofs: Vec<Vec<u8>>,
    pub subjectiveData: Option<Vec<Vec<u8>>>,
}

type TermNum = u32;

#[derive(
    Debug,
    Clone,
    Default,
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
#[graphql(input_name = "ProducerInput")]
pub struct Producer {
    pub name: AccountNumber,
    pub auth: Claim,
}

#[derive(
    Debug,
    Clone,
    Default,
    SimpleObject,
    InputObject,
    psio::PsszPack,
    psio::PsszUnpack,
    psio::PsszView,
    psio::ToPsszSchema,
    psio::JsonText,
    psio::Serde,
)]
pub struct CftConsensus {
    pub producers: Vec<Producer>,
}

#[derive(
    Debug,
    Clone,
    Default,
    SimpleObject,
    InputObject,
    psio::PsszPack,
    psio::PsszUnpack,
    psio::PsszView,
    psio::ToPsszSchema,
    psio::JsonText,
    psio::Serde,
)]
pub struct BftConsensus {
    pub producers: Vec<Producer>,
}

#[derive(Debug, Clone, Union, psio::PsszPack, psio::PsszUnpack, psio::ToPsszSchema, psio::JsonText, psio::Serde)]
pub enum ConsensusData {
    CftConsensus(CftConsensus),
    BftConsensus(BftConsensus),
}

impl ConsensusData {
    pub fn producers(&self) -> &Vec<Producer> {
        match self {
            ConsensusData::CftConsensus(cft) => &cft.producers,
            ConsensusData::BftConsensus(bft) => &bft.producers,
        }
    }
}

#[derive(
    Debug,
    Clone,
    Default,
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
#[psio(definition_will_not_change)]
pub struct ConsensusBytes {
    pub consensusVariantIdx: u8,
    pub consensusData: Vec<u8>,
}

#[derive(
    Debug,
    Clone,
    Default,
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
#[graphql(complex)]
pub struct BlockHeaderAuthAccount {
    pub codeNum: AccountNumber,
    #[graphql(skip_output)]
    pub codeHash: Checksum256,
    pub vmType: u8,
    pub vmVersion: u8,
}

/// In GraphQL the bytes are hex text, as in JSON.
#[async_graphql::ComplexObject]
impl BlockHeaderAuthAccount {
    #[allow(non_snake_case)]
    async fn codeHash(&self) -> String {
        crate::to_hex(&self.codeHash)
    }
}

#[derive(Debug, Clone, psio::PsszPack, psio::PsszUnpack, psio::PsszView, psio::ToPsszSchema, psio::JsonText, psio::Serde)]
pub struct Consensus {
    pub data: ConsensusData,
    pub services: Vec<BlockHeaderAuthAccount>,
    pub wasmConfig: WasmConfigRow,
}

#[derive(Debug, Clone, psio::PsszPack, psio::PsszUnpack, psio::PsszView, psio::ToPsszSchema, psio::JsonText, psio::Serde)]
pub struct PendingConsensus {
    pub consensus: Consensus,
    pub blockNum: BlockNum,
}

#[derive(Debug, Clone, psio::PsszPack, psio::PsszUnpack, psio::PsszView, psio::ToPsszSchema, psio::JsonText, psio::Serde)]
pub struct JointConsensus {
    pub current: Consensus,
    pub next: Option<PendingConsensus>,
}

#[derive(
    Debug,
    Clone,
    Default,
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
pub struct BlockHeaderCode {
    pub vmType: u8,
    pub vmVersion: u8,
    pub code: Vec<u8>,
}

#[derive(Debug, Clone, Default, psio::PsszPack, psio::PsszUnpack, psio::PsszView, psio::ToPsszSchema, psio::JsonText, psio::Serde)]
pub struct BlockHeader {
    pub previous: Checksum256,
    pub blockNum: BlockNum,
    pub time: BlockTime,
    pub producer: AccountNumber,
    pub term: TermNum,
    pub commitNum: BlockNum,

    // Holds a sha256 of the current JointConsensus
    consensusState: Checksum256,

    // Holds a merkle root of the transactions in the block.
    // This does not depend on execution, so that it can be
    // verified early. The leaves of the tree have type
    // TransactionInfo.
    trxMerkleRoot: Checksum256,

    // The merkle root of events generated while processing the block.
    // It is zero-initialized at the start of a block and
    // may be updated by services..
    eventMerkleRoot: Checksum256,

    // If newConsensus is set, activates joint consensus on
    // this block. Joint consensus must not be active already.
    // Joint consensus ends after this block becomes irreversible.
    newConsensus: Option<Consensus>,

    // This contains the code for authServices
    // It MUST contain all code that was added in this block
    // It MUST NOT contain code that is not in authServices
    // It MAY contain code that is unchanged from the previous block
    // authCode MUST NOT be included when calculating a block hash.
    authCode: Option<Vec<BlockHeaderCode>>,
}

#[derive(Debug, Clone, Default, psio::PsszPack, psio::PsszUnpack, psio::PsszView, psio::ToPsszSchema, psio::JsonText, psio::Serde)]
pub struct Block {
    pub header: BlockHeader,
    pub transactions: Vec<SignedTransaction>,
}

#[derive(Debug, Clone, Default, psio::PsszPack, psio::PsszUnpack, psio::PsszView, psio::ToPsszSchema, psio::JsonText, psio::Serde)]
pub struct SignedBlock {
    pub block: Block,
    pub signature: Vec<u8>,
    /// Additional signatures, where the consensus algorithm requires them.
    pub auxConsensusData: Option<Vec<u8>>,
}

#[derive(Debug, Clone, Default, psio::PsszPack, psio::PsszUnpack, psio::PsszView, psio::ToPsszSchema, psio::JsonText, psio::Serde)]
pub struct BlockInfo {
    pub header: BlockHeader,
    pub blockId: Checksum256,
}
