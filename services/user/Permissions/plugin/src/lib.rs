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
            // [x] TODO: caller and callee should both be here, and this should be a single payload (for generic use of user_prompt())
            // [x] TODO: this is the place to specify the default permissions path
            let payload = format!("{{\"caller\":\"{}\",\"callee\":\"{}\"}}", caller, callee);
            // Q: I need subdomain here, right? Otherwise, nothing downstream knows how to determine subdomain
            HostClient::prompt_user("/permissions.html", &payload)?;
            unreachable!();
        }
    }

    fn is_auth(caller: String) -> Result<bool, Error> {
        let callee = HostClient::get_sender_app().app.unwrap();
        Ok(AccessGrants::get(&caller, &callee).is_some())
    }
}

bindings::export!(PermissionsPlugin with_types_in bindings);
