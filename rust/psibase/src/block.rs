// TODO: Add missing types after they stabilize
// TODO: Attributes to set case correctly on JSON field names

use crate::{psibase, AccountNumber, Fracpack, MethodNumber, TimePointSec};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Fracpack, Serialize, Deserialize)]
pub struct Action {
    pub sender: AccountNumber,
    pub service: AccountNumber,
    pub method: MethodNumber,
    pub raw_data: Vec<u8>,
}

#[derive(Debug, Clone, Fracpack, Serialize, Deserialize)]
pub struct SharedAction<'a> {
    pub sender: AccountNumber,
    pub service: AccountNumber,
    pub method: MethodNumber,
    pub raw_data: &'a [u8],
}

/// The genesis action is the first action of the first transaction of
/// the first block. The action struct's fields are ignored, except
/// rawData, which contains this struct.
#[derive(Debug, Clone, Fracpack, Serialize, Deserialize)]
pub struct GenesisActionData {
    pub memo: String,
    pub services: Vec<GenesisService>,
}

#[derive(Debug, Clone, Fracpack, Serialize, Deserialize)]
pub struct SharedGenesisActionData<'a> {
    pub memo: String,
    #[serde(borrow)]
    pub services: Vec<SharedGenesisService<'a>>,
}

#[derive(Debug, Clone, Fracpack, Serialize, Deserialize)]
pub struct GenesisService {
    pub service: AccountNumber,
    pub auth_service: AccountNumber,
    pub flags: u64,
    pub vm_type: u8,
    pub vm_version: u8,
    pub code: Vec<u8>,
}

#[derive(Debug, Clone, Fracpack, Serialize, Deserialize)]
pub struct SharedGenesisService<'a> {
    pub service: AccountNumber,
    pub flags: u64,
    pub vm_type: u8,
    pub vm_version: u8,
    pub code: &'a [u8],
}

#[derive(Debug, Clone, Fracpack, Serialize, Deserialize)]
pub struct Claim {
    pub service: AccountNumber,
    pub raw_data: Vec<u8>,
}

#[derive(Debug, Clone, Fracpack, Serialize, Deserialize)]
#[fracpack(definition_will_not_change)]
pub struct Tapos {
    pub expiration: TimePointSec,
    pub ref_block_suffix: u32,
    pub flags: u16,
    pub ref_block_index: u8,
}

#[derive(Debug, Clone, Fracpack, Serialize, Deserialize)]
pub struct Transaction {
    pub tapos: Tapos,
    pub actions: Vec<Action>,
    pub claims: Vec<Claim>,
}

#[derive(Debug, Clone, Fracpack, Serialize, Deserialize)]
pub struct SignedTransaction {
    pub transaction: Vec<u8>, // TODO
    pub proofs: Vec<Vec<u8>>,
}
