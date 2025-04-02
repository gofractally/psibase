#[allow(warnings)]
mod bindings;

use authority::verify_caller_is_this_app;
use bindings::exports::permissions::plugin::{admin::Guest as PermsAdmin, api::Guest as Api};
use bindings::host::common::{client as HostClient, types::Error};

mod authority;
mod db;
mod errors;
use db::{AccessGrants, ActiveOauthRequest};

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
        // TODO: try this as a match block
        let active_oauth_req_opt = ActiveOauthRequest.get();
        if active_oauth_req_opt.is_none() {
            return Ok(false);
        }
        let active_oauth_req = active_oauth_req_opt.unwrap();
        Ok(AccessGrants::get(&active_oauth_req.user, &caller, &callee).is_some())
    }
}

bindings::export!(PermissionsPlugin with_types_in bindings);
