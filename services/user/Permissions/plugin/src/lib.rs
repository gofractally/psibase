#[allow(warnings)]
mod bindings;

use authority::verify_caller_is_this_app;
use bindings::exports::permissions::plugin::{api::Guest as Api, users::Guest as UsersApi};
use bindings::host::common::{client as HostClient, types::Error};

mod authority;
mod db;
mod errors;
use db::AccessGrants;

struct PermissionsPlugin;

impl Api for PermissionsPlugin {
    fn save_permission(caller: String, callee: String) -> Result<(), Error> {
        verify_caller_is_this_app()?;
        Ok(AccessGrants::set(&caller, &callee))
    }
}

impl UsersApi for PermissionsPlugin {
    fn is_auth_or_prompt(caller: String) -> Result<bool, Error> {
        let callee = HostClient::get_sender_app().app.unwrap();

        let perms_pref = AccessGrants::get(&caller, &callee);
        if perms_pref.is_some() {
            Ok(true)
        } else {
            let user_prompt_payload = serde_json::json!({
                "caller": caller,
                "callee": callee
            })
            .to_string();
            HostClient::prompt_user(Some("/permissions.html"), Some(&user_prompt_payload))?;
            unreachable!();
        }
    }

    fn is_auth(caller: String) -> Result<bool, Error> {
        let callee = HostClient::get_sender_app().app.unwrap();
        Ok(AccessGrants::get(&caller, &callee).is_some())
    }
}

bindings::export!(PermissionsPlugin with_types_in bindings);
