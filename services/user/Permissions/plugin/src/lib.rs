#[allow(warnings)]
mod bindings;

use bindings::exports::permissions::plugin::admin::Guest as Admin;
use bindings::exports::permissions::plugin::api::Guest as Api;
use bindings::exports::permissions::plugin::users::Guest as UsersApi;
use bindings::host::common::client as HostClient;
use bindings::host::common::types::Error;
use bindings::host::common::web as CommonWeb;
use bindings::{
    clientdata::plugin::keyvalue as Keyvalue,
    host::common::client::{get_sender_app, my_service_account},
};

mod errors;
use chrono::Utc;
use errors::ErrorType;
use psibase::TimePointSec;
use serde::{Deserialize, Serialize};

struct PermissionsPlugin;

#[derive(Serialize, Deserialize, Debug)]
struct PermissionRequest {
    caller: String,
    callee: String,
    expiry_timestamp: TimePointSec,
}

const PERM_OAUTH_REQ_KEY: &str = "perm_oauth_request";
const PERM_REQUEST_EXPIRATION: i64 = 2 * 60;

fn verify_caller_is_this_app() -> Result<(), Error> {
    let requester = get_sender_app().app.unwrap();
    let this_plugin = my_service_account();
    if requester != this_plugin {
        return Err(ErrorType::InvalidRequester().into());
    } else {
        return Ok(());
    }
}

fn save_permission_pref(caller: String, callee: String, _remember: bool) -> Result<(), Error> {
    verify_caller_is_this_app()?;

    let k = format!("{callee}<-{caller}");
    Keyvalue::set(&k, &"1".as_bytes())
}

impl Api for PermissionsPlugin {
    fn save_permission(caller: String, callee: String, remember: bool) -> Result<(), Error> {
        save_permission_pref(caller, callee, remember)
    }
}

fn log_permission_request(caller: String, callee: String) -> Result<(), Error> {
    let p = PermissionRequest {
        caller,
        callee,
        expiry_timestamp: TimePointSec::from(Utc::now()),
    };
    let p_str = serde_json::to_string(&p);
    if p_str.is_err() {
        return Err(ErrorType::PermissionRequestFailure().into());
    }
    let p_str = p_str.unwrap();
    Keyvalue::set(PERM_OAUTH_REQ_KEY, &p_str.as_bytes())
}

impl UsersApi for PermissionsPlugin {
    fn is_permitted(caller: String) -> Result<bool, Error> {
        let callee = HostClient::get_sender_app().app.unwrap();

        // show dialog if not in local storage
        let k = format!("{callee}<-{caller}");
        let perms_pref = Keyvalue::get(&k);
        if perms_pref.is_none() {
            log_permission_request(caller.clone(), callee.clone())?;
            CommonWeb::popup(&format!("permissions.html?caller={caller}&callee={callee}"))?;
            return Err(ErrorType::PermissionsDialogAsyncNotYetAvailable().into());
        } else {
            Ok(true)
        }
    }
}

impl Admin for PermissionsPlugin {
    fn is_valid_request(caller: String, callee: String) -> Result<bool, Error> {
        verify_caller_is_this_app()?;
        let perms_req = Keyvalue::get(PERM_OAUTH_REQ_KEY);
        if perms_req.is_some() {
            let perms_req = perms_req.unwrap();
            let perms_req =
                serde_json::from_str::<PermissionRequest>(&String::from_utf8(perms_req).unwrap())
                    .unwrap();
            let is_expired = (TimePointSec::from(Utc::now()).seconds
                - perms_req.expiry_timestamp.seconds)
                >= PERM_REQUEST_EXPIRATION;
            if perms_req.caller == caller && perms_req.callee == callee && !is_expired {
                Keyvalue::delete(PERM_OAUTH_REQ_KEY);
                return Ok(true);
            }
        }
        Keyvalue::delete(PERM_OAUTH_REQ_KEY);
        return Ok(false);
    }
}

bindings::export!(PermissionsPlugin with_types_in bindings);
