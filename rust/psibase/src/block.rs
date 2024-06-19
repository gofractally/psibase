#![allow(non_snake_case)]

use crate::{AccountNumber, Hex, MethodNumber, Pack, Reflect, TimePointSec, ToKey, Unpack};
use async_graphql::{InputObject, SimpleObject, Union};
use serde::{Deserialize, Serialize};

// TODO: move
pub type Checksum256 = Hex<[u8; 32]>;

pub type BlockNum = u32;

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
    Pack,
    Unpack,
    Reflect,
    ToKey,
    Serialize,
    Deserialize,
    SimpleObject,
    InputObject,
)]
#[fracpack(fracpack_mod = "fracpack")]
#[reflect(psibase_mod = "crate")]
#[to_key(psibase_mod = "crate")]
#[graphql(input_name = "ActionInput")]
pub struct Action {
    /// Account sending the action
    pub sender: AccountNumber,

    /// Service to execute the action
    pub service: AccountNumber,

    /// Service method to execute
    pub method: MethodNumber,

    /// Data for the method
    pub rawData: Hex<Vec<u8>>,
}

#[derive(Debug, Clone, Default, Pack, Unpack, Reflect, ToKey, Serialize)]
#[fracpack(fracpack_mod = "fracpack")]
#[reflect(psibase_mod = "crate")]
#[to_key(psibase_mod = "crate")]
pub struct SharedAction<'a> {
    pub sender: AccountNumber,
    pub service: AccountNumber,
    pub method: MethodNumber,
    pub rawData: Hex<&'a [u8]>,
}

/// The genesis action is the first action of the first transaction of
/// the first block. The action struct's fields are ignored, except
/// rawData, which contains this struct.
#[derive(Debug, Clone, Default, Pack, Unpack, Reflect, ToKey, Serialize, Deserialize)]
#[fracpack(fracpack_mod = "fracpack")]
#[reflect(psibase_mod = "crate")]
#[to_key(psibase_mod = "crate")]
pub struct GenesisActionData {
    pub memo: String,
    pub services: Vec<GenesisService>,
}

#[derive(Debug, Clone, Default, Pack, Unpack, Reflect, ToKey, Serialize)]
#[fracpack(fracpack_mod = "fracpack")]
#[reflect(psibase_mod = "crate")]
#[to_key(psibase_mod = "crate")]
pub struct SharedGenesisActionData<'a> {
    pub memo: String,
    #[serde(borrow)]
    pub services: Vec<SharedGenesisService<'a>>,
}

#[derive(Debug, Clone, Default, Pack, Unpack, Reflect, ToKey, Serialize, Deserialize)]
#[fracpack(fracpack_mod = "fracpack")]
#[reflect(psibase_mod = "crate")]
#[to_key(psibase_mod = "crate")]
pub struct GenesisService {
    pub service: AccountNumber,
    pub flags: u64,
    pub vmType: u8,
    pub vmVersion: u8,
    pub code: Hex<Vec<u8>>,
}

#[derive(Debug, Clone, Default, Pack, Unpack, Reflect, ToKey, Serialize)]
#[fracpack(fracpack_mod = "fracpack")]
#[reflect(psibase_mod = "crate")]
#[to_key(psibase_mod = "crate")]
pub struct SharedGenesisService<'a> {
    pub service: AccountNumber,
    pub flags: u64,
    pub vmType: u8,
    pub vmVersion: u8,
    pub code: Hex<&'a [u8]>,
}

#[derive(
    Debug,
    Clone,
    Default,
    Pack,
    Unpack,
    Reflect,
    ToKey,
    Serialize,
    Deserialize,
    SimpleObject,
    InputObject,
)]
#[fracpack(fracpack_mod = "fracpack")]
#[reflect(psibase_mod = "crate")]
#[to_key(psibase_mod = "crate")]
#[graphql(input_name = "ClaimInput")]
pub struct Claim {
    pub service: AccountNumber,
    pub rawData: Hex<Vec<u8>>,
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
    Pack,
    Unpack,
    Reflect,
    ToKey,
    Serialize,
    Deserialize,
    SimpleObject,
    InputObject,
)]
#[fracpack(definition_will_not_change, fracpack_mod = "fracpack")]
#[reflect(psibase_mod = "crate")]
#[to_key(psibase_mod = "crate")]
#[graphql(input_name = "TaposInput")]
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
    Pack,
    Unpack,
    Reflect,
    ToKey,
    Serialize,
    Deserialize,
    SimpleObject,
    InputObject,
)]
#[fracpack(fracpack_mod = "fracpack")]
#[reflect(psibase_mod = "crate")]
#[to_key(psibase_mod = "crate")]
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
    Pack,
    Unpack,
    Reflect,
    ToKey,
    Serialize,
    Deserialize,
    SimpleObject,
    InputObject,
)]
#[fracpack(fracpack_mod = "fracpack")]
#[reflect(psibase_mod = "crate")]
#[to_key(psibase_mod = "crate")]
#[graphql(input_name = "SignedTransactionInput")]
pub struct SignedTransaction {
    // Contains a packed `Transaction`. TODO: shared_view_ptr
    pub transaction: Hex<Vec<u8>>,
    pub proofs: Vec<Hex<Vec<u8>>>,
}

type TermNum = u32;

#[derive(
    Debug,
    Clone,
    Default,
    Pack,
    Unpack,
    Reflect,
    ToKey,
    Serialize,
    Deserialize,
    SimpleObject,
    InputObject,
)]
#[fracpack(fracpack_mod = "fracpack")]
#[reflect(psibase_mod = "crate")]
#[to_key(psibase_mod = "crate")]
#[graphql(input_name = "ProducerInput")]
pub struct Producer {
    pub name: AccountNumber,
    pub auth: Claim,
}

#[derive(
    Debug, Clone, Default, Pack, Unpack, Reflect, Serialize, Deserialize, SimpleObject, InputObject,
)]
#[fracpack(fracpack_mod = "fracpack")]
#[reflect(psibase_mod = "crate")]
pub struct CftConsensus {
    pub producers: Vec<Producer>,
}

#[derive(
    Debug, Clone, Default, Pack, Unpack, Reflect, Serialize, Deserialize, SimpleObject, InputObject,
)]
#[fracpack(fracpack_mod = "fracpack")]
#[reflect(psibase_mod = "crate")]
pub struct BftConsensus {
    pub producers: Vec<Producer>,
}

#[derive(Debug, Clone, Pack, Unpack, Reflect, Serialize, Deserialize, Union)]
#[fracpack(fracpack_mod = "fracpack")]
#[reflect(psibase_mod = "crate")]
pub enum Consensus {
    CFT(CftConsensus),
    BFT(BftConsensus),
}

#[derive(
    Debug,
    Clone,
    Default,
    Pack,
    Unpack,
    Reflect,
    ToKey,
    Serialize,
    Deserialize,
    SimpleObject,
    InputObject,
)]
#[fracpack(fracpack_mod = "fracpack")]
#[fracpack(definition_will_not_change)]
#[reflect(psibase_mod = "crate")]
#[to_key(psibase_mod = "crate")]
pub struct ConsensusBytes {
    pub consensusVariantIdx: u8,
    pub consensusData: Vec<u8>,
}

#[derive(
    Debug,
    Clone,
    Default,
    Pack,
    Unpack,
    Reflect,
    ToKey,
    Serialize,
    Deserialize,
    SimpleObject,
    InputObject,
)]
#[fracpack(fracpack_mod = "fracpack")]
#[reflect(psibase_mod = "crate")]
#[to_key(psibase_mod = "crate")]
pub struct BlockHeaderAuthAccount {
    pub codeNum: AccountNumber,
    pub codeHash: Checksum256,
    pub vmType: u8,
    pub vmVersion: u8,
}

#[derive(
    Debug,
    Clone,
    Default,
    Pack,
    Unpack,
    Reflect,
    ToKey,
    Serialize,
    Deserialize,
    SimpleObject,
    InputObject,
)]
#[fracpack(fracpack_mod = "fracpack")]
#[reflect(psibase_mod = "crate")]
#[to_key(psibase_mod = "crate")]
pub struct BlockHeaderCode {
    pub vmType: u8,
    pub vmVersion: u8,
    pub code: Vec<u8>,
}

#[derive(Debug, Clone, Default, Pack, Unpack, Reflect, Serialize, Deserialize)]
#[fracpack(fracpack_mod = "fracpack")]
#[reflect(psibase_mod = "crate")]
pub struct BlockHeader {
    pub previous: Checksum256,
    pub blockNum: BlockNum,
    pub time: TimePointSec,
    pub producer: AccountNumber,
    pub term: TermNum,
    pub commitNum: BlockNum,

    // Holds a merkle root of the transactions in the block.
    // This does not depend on execution, so that it can be
    // verified early. The leaves of the tree have type
    // TransactionInfo.
    trxMerkleRoot: Checksum256,

    // The merkle root of events generated while processing the block.
    // The leaves have type EventInfo.
    eventMerkleRoot: Checksum256,

    // If newConsensus is set, activates joint consensus on
    // this block. Joint consensus must not be active already.
    // Joint consensus ends after this block becomes irreversible.
    newConsensus: Option<Consensus>,

    // If this is specified, it should should contain the full set of
    // of services that can be used for verifying block signatures.
    authServices: Option<Vec<BlockHeaderAuthAccount>>,

    // This contains the code for authServices
    // It MUST contain all code that was added in this block
    // It MUST NOT contain code that is not in authServices
    // It MAY contain code that is unchanged from the previous block
    // authCode MUST NOT be included when calculating a block hash.
    authCode: Option<Vec<BlockHeaderCode>>,
}

#[derive(Debug, Clone, Default, Pack, Unpack, Reflect, Serialize, Deserialize)]
#[fracpack(fracpack_mod = "fracpack")]
#[reflect(psibase_mod = "crate")]
pub struct Block {
    pub header: BlockHeader,
    pub transactions: Vec<SignedTransaction>,
    pub subjectiveData: Vec<Hex<Vec<u8>>>,
}

#[derive(Debug, Clone, Default, Pack, Unpack, Reflect, Serialize, Deserialize)]
#[fracpack(fracpack_mod = "fracpack")]
#[reflect(psibase_mod = "crate")]
pub struct SignedBlock {
    pub block: Block,
    pub signature: Hex<Vec<u8>>,
}

#[derive(Debug, Clone, Default, Pack, Unpack, Reflect, Serialize, Deserialize)]
#[fracpack(fracpack_mod = "fracpack")]
#[reflect(psibase_mod = "crate")]
pub struct BlockInfo {
    pub header: BlockHeader,
    pub blockId: Checksum256,
}
