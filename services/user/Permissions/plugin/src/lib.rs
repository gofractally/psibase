#[allow(warnings)]
mod bindings;

use authority::verify_caller_is_this_app;
use bindings::exports::permissions::plugin::{
    admin::Guest as Admin, api::Guest as Api, users::Guest as UsersApi,
};
use bindings::host::common::{client as HostClient, types::Error};

use bindings::exports::permissions::plugin::types::ValidPermissionsRequest;

mod authority;
mod db;
mod errors;
use db::{AccessGrants, CurrentAccessRequest};
use errors::ErrorType;

struct PermissionsPlugin;

impl Api for PermissionsPlugin {
    fn save_permission(caller: String, callee: String) -> Result<(), Error> {
        verify_caller_is_this_app()?;
        Ok(AccessGrants::set(&caller, &callee))
    }
}

impl UsersApi for PermissionsPlugin {
    fn is_permitted(caller: String) -> Result<bool, Error> {
        let callee = HostClient::get_sender_app().app.unwrap();

        let perms_pref = AccessGrants::get(&caller, &callee);
        if perms_pref.is_none() {
            let req_id = CurrentAccessRequest::set(&caller, &callee)?;
            return Err(ErrorType::RequestRedirect(format!("{}", req_id).to_string()).into());
        } else {
            Ok(true)
        }
    }
}

impl Admin for PermissionsPlugin {
    fn get_valid_perm_request(id: String) -> Result<Option<ValidPermissionsRequest>, Error> {
        verify_caller_is_this_app()?;
        let valid_perm_req = CurrentAccessRequest::get_valid_perm_request(&id)?; // , &caller, &callee)?;
        CurrentAccessRequest::delete()?;
        return Ok(valid_perm_req.map(|v| ValidPermissionsRequest {
            id: v.id,
            caller: v.caller,
            callee: v.callee,
        }));
    }
}

bindings::export!(PermissionsPlugin with_types_in bindings);
