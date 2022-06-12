use crate::Fracpack;
use serde::{Deserialize, Serialize};

#[derive(Fracpack, Serialize, Deserialize)]
#[fracpack(definition_will_not_change)]
pub struct TimePointSec {
    pub seconds: u32,
}

// TODO: implement trait with the time functions helpers
