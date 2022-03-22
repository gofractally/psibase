// TODO: Add missing types after they stabilize

use serde::{Deserialize, Serialize};

pub type AccountNum = u32;

#[derive(psi_macros::Fracpack, Serialize, Deserialize)]
pub struct Action {
    sender: AccountNum,
    contract: AccountNum,
    raw_data: Vec<u8>,
}
