#[allow(warnings)]
mod bindings;
use bindings::*;

use auth_scope::plugin::api::AllowedAction;
use exports::x_portal::plugin::api::Guest as Api;
use host::types::types::Error;

const AC_CREATOR: &str = "ac-creator";

struct XPortalPlugin;

impl Api for XPortalPlugin {
    fn create_admin_accounts(
        pubkey_pem: String,
        owner: String,
        allowed: Vec<AllowedAction>,
    ) -> Result<(), Error> {
        assert_eq!(
            host::client::api::get_sender(),
            host::client::api::get_receiver()
        );
        auth_scope::plugin::api::new_account(AC_CREATOR, &pubkey_pem, &owner, &allowed)?;

        transact::plugin::api::set_propose_latch(Some(AC_CREATOR))?;
        tokens::plugin::user_config::enable_user_auto_debit(true)?;
        transact::plugin::api::set_propose_latch(None)?;
        Ok(())
    }
}

bindings::export!(XPortalPlugin with_types_in bindings);
