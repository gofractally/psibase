use crate::bindings;
use crate::errors::ErrorType;

use chrono::Utc;
use serde::{Deserialize, Serialize};

use psibase::TimePointSec;

use bindings::clientdata::plugin::keyvalue as Keyvalue;
use bindings::host::common::types::Error;

const PERM_OAUTH_REQ_KEY: &str = "perm_oauth_request";
const PERM_REQUEST_EXPIRATION: i64 = 2 * 60;

#[derive(Serialize, Deserialize, Debug)]
struct PermissionRequest {
    caller: String,
    callee: String,
    expiry_timestamp: TimePointSec,
}

pub struct AccessGrants;

impl AccessGrants {
    pub fn set(caller: String, callee: String) -> Result<(), Error> {
        let k = format!("{callee}<-{caller}");
        Keyvalue::set(&k, &"1".as_bytes())
    }
    pub fn get(caller: String, callee: String) -> Result<Option<Vec<u8>>, Error> {
        let k = format!("{callee}<-{caller}");
        Ok(Keyvalue::get(&k))
    }
}

pub struct CurrentAccessRequest;

impl CurrentAccessRequest {
    pub fn set(caller: String, callee: String) -> Result<(), Error> {
        let pr = serde_json::to_string(&PermissionRequest {
            caller,
            callee,
            expiry_timestamp: TimePointSec::from(Utc::now()),
        })
        .map_err(|err| ErrorType::SerderError(err.to_string()))?;

        Keyvalue::set(&PERM_OAUTH_REQ_KEY, &pr.as_bytes())
    }

    pub fn is_valid_request(caller: String, callee: String) -> Result<bool, Error> {
        let perms_req = Keyvalue::get(PERM_OAUTH_REQ_KEY);
        if perms_req.is_some() {
            let perms_req = serde_json::from_str::<PermissionRequest>(
                &String::from_utf8(perms_req.unwrap()).unwrap(),
            )
            .map_err(|err| ErrorType::SerderError(err.to_string()))?;

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
