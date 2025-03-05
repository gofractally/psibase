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
        println!("AccessGrants::get().caller: {}, callee: {}", caller, callee);
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
        )?;
        // .expect("Failed to set current access request")
        Ok(req_id)
    }

    pub fn get_valid_perm_request(
        id: &str,
        // caller: &str,
        // callee: &str,
    ) -> Result<Option<ValidPermissionRequest>, Error> {
        println!("get_valid_perm_request().id: {}", id);
        let perms_req = Keyvalue::get(PERM_OAUTH_REQ_KEY).map(|p| {
            PermissionRequest::unpacked(&p).expect("Failed to unpack current access request")
        });
        println!("get_valid_perm_request().2.perms_req: {:?}", perms_req);
        if perms_req.is_some() {
            println!("get_valid_perm_request().3");
            // let perms_req = serde_json::from_str::<PermissionRequest>(
            //     &String::from_utf8(perms_req.unwrap()).unwrap(),
            // )
            // .map_err(|err| ErrorType::SerderError(err.to_string()))?;
            let perms_req = perms_req.unwrap();
            println!("get_valid_perm_request().4.id: {}", perms_req.id);

            let is_expired = (TimePointSec::from(Utc::now()).seconds
                - perms_req.expiry_timestamp.seconds)
                >= PERM_REQUEST_EXPIRATION;
            println!("get_valid_perm_request().5");

            // return Ok(perms_req.id == id
            //     && perms_req.caller == caller
            //     // && perms_req.callee == callee
            //     && !is_expired);
            if is_expired {
                return Ok(None);
            }
            return Ok(Some(ValidPermissionRequest {
                id: perms_req.id,
                caller: perms_req.caller,
                callee: perms_req.callee,
            }));
        }
        println!("get_valid_perm_request().6");
        Ok(None)
    }
    pub fn delete() -> Result<(), Error> {
        Ok(Keyvalue::delete(PERM_OAUTH_REQ_KEY))
    }
}
