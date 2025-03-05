use crate::bindings;

use chrono::Utc;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use psibase::fracpack::{Pack, Unpack};
use psibase::TimePointSec;

use bindings::clientdata::plugin::keyvalue as Keyvalue;
use bindings::host::common::types::Error;

const PERM_OAUTH_REQ_KEY: &str = "perm_oauth_request";
const PERM_REQUEST_EXPIRATION: i64 = 2 * 60;

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

pub struct CurrentAccessRequest;

impl CurrentAccessRequest {
    pub fn set(caller: &str, callee: &str) -> Result<String, Error> {
        let req_id = Uuid::new_v4().to_string();
        Keyvalue::set(
            &PERM_OAUTH_REQ_KEY,
            &PermissionRequest {
                id: req_id.clone(),
                caller: String::from(caller),
                callee: String::from(callee),
                expiry_timestamp: TimePointSec::from(Utc::now()),
            }
            .packed(),
        )
        .expect("Failed to set current access request");
        Ok(req_id)
    }

    pub fn get_valid_perm_request(id: &str) -> Result<Option<ValidPermissionRequest>, Error> {
        let perms_req = Keyvalue::get(PERM_OAUTH_REQ_KEY).map(|p| {
            PermissionRequest::unpacked(&p).expect("Failed to unpack current access request")
        });
        if perms_req.is_some() {
            let perms_req = perms_req.unwrap();

            let is_expired = (TimePointSec::from(Utc::now()).seconds
                - perms_req.expiry_timestamp.seconds)
                >= PERM_REQUEST_EXPIRATION;

            if !is_expired && id == perms_req.id {
                return Ok(Some(ValidPermissionRequest {
                    id: perms_req.id,
                    caller: perms_req.caller,
                    callee: perms_req.callee,
                }));
            }
        }
        Ok(None)
    }
    pub fn delete() -> Result<(), Error> {
        Ok(Keyvalue::delete(PERM_OAUTH_REQ_KEY))
    }
}
