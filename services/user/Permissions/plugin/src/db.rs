use crate::bindings;

use serde::{Deserialize, Serialize};

use psibase::fracpack::{Pack, Unpack};
use psibase::TimePointSec;

use bindings::clientdata::plugin::keyvalue as Keyvalue;

#[derive(Serialize, Deserialize, Debug, Pack, Unpack)]
struct PermissionRequest {
    id: String,
    caller: String,
    callee: String,
    expiry_timestamp: TimePointSec,
}

#[derive(Serialize, Deserialize, Debug, Pack, Unpack)]
pub struct ValidPermissionRequest {
    pub id: String,
    pub caller: String,
    pub callee: String,
}

pub struct AccessGrants;

impl AccessGrants {
    pub fn set(caller: &str, callee: &str) {
        Keyvalue::set(&format!("{callee}<-{caller}"), &"1".as_bytes())
            .expect("Failed to set access grant")
    }
    pub fn get(caller: &str, callee: &str) -> Option<Vec<u8>> {
        Keyvalue::get(&format!("{callee}<-{caller}"))
    }
}
