use crate::Fracpack;
use serde::{Deserialize, Serialize};

#[derive(Debug, Copy, Clone, Fracpack, Serialize, Deserialize)]
#[fracpack(definition_will_not_change, fracpack_mod = "fracpack")]
pub struct TimePointSec {
    pub seconds: u32,
}

// TODO: implement trait with the time functions helpers
