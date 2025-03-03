use crate::bindings;

use chrono::Utc;
use serde::{Deserialize, Serialize};

use psibase::fracpack::{Pack, Unpack};
use psibase::TimePointSec;

use bindings::clientdata::plugin::keyvalue as Keyvalue;
use bindings::host::common::types::Error;

const PERM_OAUTH_REQ_KEY: &str = "perm_oauth_request";
const PERM_REQUEST_EXPIRATION: i64 = 2 * 60;

#[derive(Serialize, Deserialize, Debug, Pack, Unpack)]
struct PermissionRequest {
    caller: String,
    callee: String,
    expiry_timestamp: TimePointSec,
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

pub struct CurrentAccessRequest;

impl CurrentAccessRequest {
    pub fn set(caller: &str, callee: &str) -> Result<(), Error> {
        Keyvalue::set(
            &PERM_OAUTH_REQ_KEY,
            &PermissionRequest {
                caller: String::from(caller),
                callee: String::from(callee),
                expiry_timestamp: TimePointSec::from(Utc::now()),
            }
            .packed(),
        )
        // .expect("Failed to set current access request")
    }

    pub fn is_valid_request(caller: &str, callee: &str) -> Result<bool, Error> {
        let perms_req = Keyvalue::get(PERM_OAUTH_REQ_KEY).map(|p| {
            PermissionRequest::unpacked(&p).expect("Failed to unpack current access request")
        });
        if perms_req.is_some() {
            // let perms_req = serde_json::from_str::<PermissionRequest>(
            //     &String::from_utf8(perms_req.unwrap()).unwrap(),
            // )
            // .map_err(|err| ErrorType::SerderError(err.to_string()))?;
            let perms_req = perms_req.unwrap();

            let is_expired = (TimePointSec::from(Utc::now()).seconds
                - perms_req.expiry_timestamp.seconds)
                >= PERM_REQUEST_EXPIRATION;

            return Ok(perms_req.caller == caller && perms_req.callee == callee && !is_expired);
        }
        Ok(false)
    }
    pub fn delete() -> Result<(), Error> {
        Ok(Keyvalue::delete(PERM_OAUTH_REQ_KEY))
    }
}
