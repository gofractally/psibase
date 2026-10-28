#[allow(warnings)]
mod bindings;
use bindings::*;

use auth_scope::plugin::api::AllowedAction;
use exports::x_portal::plugin::api::Guest as Api;
use host::types::types::{Error, PluginId};

const AC_CREATOR: &str = "ac-creator";

struct XPortalPlugin;

fn assert_caller_self() {
    assert_eq!(
        host::client::api::get_sender(),
        host::client::api::get_receiver()
    );
}

fn plugin_error(message: &str) -> Error {
    Error {
        code: 1,
        producer: PluginId {
            service: "x-portal".into(),
            plugin: "plugin".into(),
        },
        message: message.into(),
    }
}

impl Api for XPortalPlugin {
    fn create_admin_accounts(
        pubkey_pem: String,
        owner: String,
        allowed: Vec<AllowedAction>,
    ) -> Result<(), Error> {
        assert_caller_self();
        auth_scope::plugin::api::new_account(AC_CREATOR, &pubkey_pem, &owner, &allowed)?;

        transact::plugin::api::set_propose_latch(Some(AC_CREATOR))?;
        tokens::plugin::user_config::enable_user_auto_debit(true)?;
        transact::plugin::api::set_propose_latch(None)?;
        Ok(())
    }

    fn send_tokens(amount: String) -> Result<(), Error> {
        assert_caller_self();
        let Some(token) = tokens::plugin::helpers::get_system_token()? else {
            return Err(plugin_error("system token is not set"));
        };
        tokens::plugin::user::credit(token.id, AC_CREATOR, &amount, "")?;
        Ok(())
    }

    fn send_resources(amount: String) -> Result<(), Error> {
        assert_caller_self();
        virtual_server::plugin::billing::donate_gas(AC_CREATOR, &amount)?;
        Ok(())
    }

    fn set_creator_key(pubkey_pem: String) -> Result<(), Error> {
        assert_caller_self();
        auth_scope::plugin::api::set_key(AC_CREATOR, &pubkey_pem)?;
        Ok(())
    }
}

bindings::export!(XPortalPlugin with_types_in bindings);
