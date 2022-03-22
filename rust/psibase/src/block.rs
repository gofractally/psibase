// TODO: Add missing types after they stabilize

use serde::{Deserialize, Serialize};

pub type AccountNum = u32;

#[derive(psi_macros::Fracpack, Serialize, Deserialize)]
pub struct Action {
    pub sender: AccountNum,
    pub contract: AccountNum,
    pub raw_data: Vec<u8>,
}

#[derive(psi_macros::Fracpack, Serialize, Deserialize)]
pub struct SharedAction<'a> {
    pub sender: AccountNum,
    pub contract: AccountNum,
    pub raw_data: &'a [u8],
}
