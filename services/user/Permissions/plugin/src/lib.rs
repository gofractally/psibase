#[allow(warnings)]
mod bindings;

use authority::verify_caller_is_this_app;
use bindings::exports::permissions::plugin::{
    admin::Guest as Admin, api::Guest as Api, users::Guest as UsersApi,
};
use bindings::host::common::{client as HostClient, types::Error, web as CommonWeb};

mod authority;
mod db;
mod errors;
use db::{AccessGrants, CurrentAccessRequest};
use errors::ErrorType;

struct PermissionsPlugin;

impl Api for PermissionsPlugin {
    fn save_permission(caller: String, callee: String, _remember: bool) -> Result<(), Error> {
        verify_caller_is_this_app()?;
        Ok(AccessGrants::set(&caller, &callee))
    }
}

impl UsersApi for PermissionsPlugin {
    fn is_permitted(caller: String) -> Result<bool, Error> {
        let callee = HostClient::get_sender_app().app.unwrap();

        let perms_pref = AccessGrants::get(&caller, &callee);
        if perms_pref.is_none() {
            CurrentAccessRequest::set(&caller, &callee)?;
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
        let is_valid = CurrentAccessRequest::is_valid_request(&caller, &callee)?;
        CurrentAccessRequest::delete()?;
        return Ok(is_valid);
    }
}

bindings::export!(PermissionsPlugin with_types_in bindings);
