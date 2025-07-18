#[allow(warnings)]
mod bindings;
use bindings::*;

use accounts::plugin::api as Accounts;
use exports::permissions::plugin::{admin::Guest as PermsAdmin, api::Guest as Api};
use permissions::plugin::types::PromptContext;

use host::common::{
    client as HostClient,
    client::{get_sender_app, my_service_account},
    types::Error,
};
use host::prompt::web as HostPrompt;

mod errors;
use errors::*;

mod db;
use db::*;

struct PermissionsPlugin;

impl PermsAdmin for PermissionsPlugin {
    fn save_perm(user: String, caller: String, callee: String) {
        assert_eq!(get_sender_app().app.unwrap(), my_service_account());
        AccessGrants::set(&user, &caller, &callee);
    }

    fn get_context(context_id: String) -> PromptContext {
        let context_id = context_id.parse::<u32>().unwrap();
        let (user, caller, callee) = PromptContexts::get(context_id).unwrap();
        PromptContext {
            user,
            caller,
            callee,
        }
    }

    fn approve(context_id: String) {
        assert_eq!(get_sender_app().app.unwrap(), my_service_account());
        let context_id = context_id.parse::<u32>().unwrap();
        let (user, caller, callee) = PromptContexts::get(context_id).unwrap();
        AccessGrants::set(&user, &caller, &callee);
        PromptContexts::delete(context_id);
    }

    fn deny(context_id: String) {
        assert_eq!(get_sender_app().app.unwrap(), my_service_account());
        let context_id = context_id.parse::<u32>().unwrap();
        PromptContexts::delete(context_id);
    }
}

impl Api for PermissionsPlugin {
    fn prompt_auth(caller: String) -> Result<(), Error> {
        let callee = HostClient::get_sender_app().app.unwrap();
        let user = match Accounts::get_current_user() {
            Some(user) => user,
            None => return Err(ErrorType::LoggedInUserDNE().into()),
        };
        let context_id = PromptContexts::add(&user, &caller, &callee);
        HostPrompt::prompt_user(Some("/permissions.html"), Some(context_id))?;
        Ok(())
    }

    fn is_auth(caller: String) -> Result<bool, Error> {
        let callee = HostClient::get_sender_app().app.unwrap();
        match Accounts::get_current_user() {
            Some(current_user) => Ok(AccessGrants::get(&current_user, &caller, &callee).is_some()),
            None => Err(ErrorType::LoggedInUserDNE().into()),
        }
    }

    fn del_perm(user: String, caller: String, callee: String) {
        assert_eq!(get_sender_app().app.unwrap(), my_service_account());
        AccessGrants::delete(&user, &caller, &callee)
    }
}

export!(PermissionsPlugin with_types_in bindings);
