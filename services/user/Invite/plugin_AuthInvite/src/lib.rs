#[allow(warnings)]
mod bindings;
mod errors;
use errors::ErrorType::*;
mod db;
use db::*;

// Other plugins
use bindings::auth_invite::plugin::types::InviteToken;
use bindings::auth_sig::plugin::keyvault as KeyVault;
use bindings::host::common::{client as Client, types::Error};
use bindings::invite::plugin::advanced::deserialize;
use bindings::transact::plugin::{hooks::*, types::*};
use psibase::services::invite as Invite;

// Exported interfaces/types
use bindings::exports::auth_invite::plugin::intf::Guest as Intf;
use bindings::exports::transact_hook_action_auth::Guest as HookActionAuth;

fn from_transact() -> bool {
    Client::get_sender_app().app.map_or(false, |app| {
        app == psibase::services::transact::SERVICE.to_string()
    })
}

fn is_valid_action(service: &str, method: &str) -> bool {
    service == psibase::services::invite::SERVICE.to_string()
        && (method == Invite::action_structs::accept::ACTION_NAME
            || method == Invite::action_structs::acceptCreate::ACTION_NAME
            || method == Invite::action_structs::reject::ACTION_NAME)
}

struct AuthInvite;

impl Intf for AuthInvite {
    fn notify(token: InviteToken) -> Result<(), Error> {
        if let Some(app) = Client::get_sender_app().app {
            if app != psibase::services::invite::SERVICE.to_string() {
                return Err(Unauthorized("notify").into());
            }
        }

        let inv_keys = deserialize(&token).map_err(|_| DecodeInviteError("notify"))?;

        InviteKeys::add(&inv_keys);

        hook_action_auth();

        Ok(())
    }
}

impl HookActionAuth for AuthInvite {
    fn on_action_auth_claims(action: Action) -> Result<Vec<Claim>, Error> {
        if is_valid_action(&action.service, &action.method) {
            return Ok(vec![Claim {
                verify_service: psibase::services::auth_invite::VERIFY_SERVICE.to_string(),
                raw_data: InviteKeys::get_public_key(),
            }]);
        } else {
            println!(
                "[AuthInvite: on_action_auth_claims] Invalid action: {}:{}",
                action.service, action.method
            );
        }

        Ok(vec![])
    }

    fn on_action_auth_proofs(
        _claims: Vec<Claim>,
        transaction_hash: Vec<u8>,
    ) -> Result<Vec<Proof>, Error> {
        if !from_transact() {
            return Err(Unauthorized("get_proofs").into());
        }

        let private_key = InviteKeys::get_private_key();
        InviteKeys::delete(); // Free local storage

        Ok(vec![Proof {
            signature: KeyVault::sign(&transaction_hash, &private_key)?,
        }])
    }
}

bindings::export!(AuthInvite with_types_in bindings);
