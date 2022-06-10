// TODO: Add missing types after they stabilize

use serde::{Deserialize, Serialize};

use crate::{AccountNumber, MethodNumber, TimePointSec};

#[derive(psi_macros::Fracpack, Serialize, Deserialize)]
pub struct Action {
    pub sender: AccountNumber,
    pub contract: AccountNumber,
    pub method: MethodNumber,
    pub raw_data: Vec<u8>,
}

#[derive(psi_macros::Fracpack, Serialize, Deserialize)]
pub struct SharedAction<'a> {
    pub sender: AccountNumber,
    pub contract: AccountNumber,
    pub method: MethodNumber,
    pub raw_data: &'a [u8],
}

/// The genesis action is the first action of the first transaction of
/// the first block. The action struct's fields are ignored, except
/// rawData, which contains this struct.
#[derive(psi_macros::Fracpack, Serialize, Deserialize)]
pub struct GenesisActionData {
    pub memo: String,
    pub contracts: Vec<GenesisContract>,
}

#[derive(psi_macros::Fracpack, Serialize, Deserialize)]
pub struct SharedGenesisActionData<'a> {
    pub memo: String,
    #[serde(borrow)]
    pub contracts: Vec<SharedGenesisContract<'a>>,
}

#[derive(psi_macros::Fracpack, Serialize, Deserialize)]
pub struct GenesisContract {
    pub contract: AccountNumber,
    pub auth_contract: AccountNumber,
    pub flags: u64,
    pub vm_type: u8,
    pub vm_version: u8,
    pub code: Vec<u8>,
}

#[derive(psi_macros::Fracpack, Serialize, Deserialize)]
pub struct SharedGenesisContract<'a> {
    pub contract: AccountNumber,
    pub auth_contract: AccountNumber,
    pub flags: u64,
    pub vm_type: u8,
    pub vm_version: u8,
    pub code: &'a [u8],
}

#[derive(psi_macros::Fracpack, Serialize, Deserialize)]
pub struct Claim {
    pub contract: AccountNumber,
    pub raw_data: Vec<u8>,
}

#[derive(psi_macros::Fracpack, Serialize, Deserialize)]
#[fracpack(definition_will_not_change)]
pub struct Tapos {
    pub expiration: TimePointSec,
    pub flags: u16,
    pub ref_block_prefix: u32,
    pub ref_block_num: u16,
}

#[derive(psi_macros::Fracpack, Serialize, Deserialize)]
pub struct Transaction {
    pub tapos: Tapos,
    pub actions: Vec<Action>,
    pub claims: Vec<Claim>,
}

#[derive(psi_macros::Fracpack, Serialize, Deserialize)]
pub struct SignedTransaction {
    pub transaction: Vec<u8>, // TODO
    pub proofs: Vec<Vec<u8>>,
}
