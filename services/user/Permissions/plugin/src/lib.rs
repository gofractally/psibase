#[allow(warnings)]
mod bindings;

use authority::verify_caller_is_this_app;
use bindings::accounts::plugin::api as Accounts;
use bindings::exports::permissions::plugin::{admin::Guest as PermsAdmin, api::Guest as Api};
use bindings::host::common::{client as HostClient, types::Error};

mod authority;
mod db;
mod errors;
use db::AccessGrants;
use errors::ErrorType;

struct PermissionsPlugin;

impl PermsAdmin for PermissionsPlugin {
    fn save_perm(user: String, caller: String, callee: String) -> Result<(), Error> {
        verify_caller_is_this_app()?;
        Ok(AccessGrants::set(&user, &caller, &callee))
    }

    fn del_perm(user: String, caller: String, callee: String) -> Result<(), Error> {
        verify_caller_is_this_app()?;
        Ok(AccessGrants::delete(&user, &caller, &callee))
    }
}

impl Api for PermissionsPlugin {
    fn prompt_auth(caller: String) -> Result<(), Error> {
        let callee = HostClient::get_sender_app().app.unwrap();
        let user_prompt_payload = serde_json::json!({
            "caller": caller,
            "callee": callee
        })
        .to_string();
        HostClient::prompt_user(Some("/permissions.html"), Some(&user_prompt_payload))?;
        unreachable!();
    }

    fn is_auth(caller: String) -> Result<bool, Error> {
        let callee = HostClient::get_sender_app().app.unwrap();
        match Accounts::get_current_user()? {
            Some(current_user) => Ok(AccessGrants::get(&current_user, &caller, &callee).is_some()),
            None => Err(ErrorType::LoggedInUserDNE().into()),
        }
    }
}

bindings::export!(PermissionsPlugin with_types_in bindings);
