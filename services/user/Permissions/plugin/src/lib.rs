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
    // --> is_auth_or_prompt()
    fn is_permitted(caller: String) -> Result<bool, Error> {
        let callee = HostClient::get_sender_app().app.unwrap();

        let perms_pref = AccessGrants::get(&caller, &callee);
        if perms_pref.is_none() {
            HostClient::prompt_user("fake-redirect-url-path")?;
            unreachable!();
        } else {
            Ok(true)
        }
    }
}

bindings::export!(PermissionsPlugin with_types_in bindings);
