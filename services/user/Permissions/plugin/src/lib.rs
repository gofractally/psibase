#[allow(warnings)]
mod bindings;

use bindings::exports::permissions::plugin::api::Guest as Api;
use bindings::exports::permissions::plugin::queries::Guest as Queries;
use bindings::host::common::client as HostClient;
use bindings::host::common::types::Error;
use bindings::host::common::web as CommonWeb;
use bindings::{clientdata::plugin::keyvalue as Keyvalue, host::common::client::get_sender_app};

mod errors;
use errors::ErrorType;
use psibase::get_service;

struct PermissionsPlugin;

fn verify_caller_is_this_service() -> bool {
    let requester = get_sender_app().app.unwrap();
    let this_service = get_service().to_string();
    requester != this_service
}

fn save_permission_pref(caller: String, callee: String, _remember: bool) -> Result<(), Error> {
    if !verify_caller_is_this_service() {
        return Err(ErrorType::InvalidRequester().into());
    }

    let k = format!("{callee}<-{caller}");
    Keyvalue::set(&k, &"1".as_bytes())
}

impl Api for PermissionsPlugin {
    fn save_permission(caller: String, callee: String, remember: bool) -> Result<(), Error> {
        save_permission_pref(caller, callee, remember)
    }
}

impl Queries for PermissionsPlugin {
    fn is_permitted(caller: String) -> Result<bool, Error> {
        let callee = HostClient::get_sender_app().app.unwrap();

        // show dialog if not in local storage
        let k = format!("{callee}<-{caller}");
        let perms_pref = Keyvalue::get(&k);
        if perms_pref.is_none() {
            CommonWeb::open_subpage(&format!("permissions.html?caller={caller}&callee={callee}"))?;
            return Err(ErrorType::PermissionsDialogAsyncNotYetAvailable().into());
        } else {
            Ok(true)
        }
    }
}

bindings::export!(PermissionsPlugin with_types_in bindings);
