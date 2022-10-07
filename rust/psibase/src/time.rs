use crate::{Fracpack, ToKey};
use serde::{Deserialize, Serialize};

#[derive(Debug, Copy, Clone, Fracpack, ToKey, Serialize, Deserialize)]
#[fracpack(definition_will_not_change, fracpack_mod = "fracpack")]
#[to_key(psibase_mod = "crate")]
pub struct TimePointSec {
    pub seconds: u32,
}

// TODO: implement trait with the time functions helpers
