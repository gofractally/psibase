#[allow(warnings)]
mod bindings;
mod errors;
use errors::ErrorType::*;

// Other plugins
use bindings::auth_invite::plugin::types::InviteToken;
use bindings::auth_sig::plugin::keyvault as KeyVault;
use bindings::clientdata::plugin::keyvalue as Keyvalue;
use bindings::host::common::{client as Client, types::Error};
use bindings::invite::plugin::advanced::deserialize;
use bindings::transact::plugin::auth as Transact;

// Exported interfaces/types
use bindings::accounts::smart_auth::types::{Action, Claim, Proof};
use bindings::exports::accounts::smart_auth::smart_auth::Guest as SmartAuth;

use bindings::exports::auth_invite::plugin::intf::Guest as Intf;

// Services
use psibase::services::invite::action_structs as InviteActions;

// Third-party crates
use psibase::fracpack::{Pack, Unpack};

struct AuthInvite;

fn from_transact() -> bool {
    Client::get_sender_app().app.map_or(false, |app| {
        app == psibase::services::transact::SERVICE.to_string()
    })
}

#[derive(Pack, Unpack)]
struct Tokens {
    tokens: Vec<InviteToken>,
}

// Database keys
const KEY_PUB: &str = "pub_key";
const KEY_PRV: &str = "prv_key";

impl Intf for AuthInvite {
    fn notify(token: InviteToken) -> Result<(), Error> {
        let inv_keys = deserialize(&token).map_err(|_| DecodeInviteError.err("notify"))?;

        Keyvalue::set(KEY_PUB, &inv_keys.pub_key)?;
        Keyvalue::set(KEY_PRV, &inv_keys.priv_key)?;

        // This will notify transact that auth-invite has a claim/proof for this transaction.
        Transact::notify();

        Ok(())
    }
}

impl SmartAuth for AuthInvite {
    fn get_claims(account_name: String, actions: Vec<Action>) -> Result<Vec<Claim>, Error> {
        if !from_transact() {
            return Err(Unauthorized.err("get_claims"));
        }

        let payer_account = psibase::services::invite::PAYER_ACCOUNT.to_string();
        if account_name == payer_account {
            // If the invite is itself paying for this transaction, we restrict the tx
            // to only a single action: acceptCreate or reject
            let e = Err(Unauthorized.err(&format!(
                "{} can only authorize acceptCreate or reject action",
                payer_account
            )));
            if actions.len() != 1 {
                return e;
            }

            let action = actions.first().unwrap();
            if action.method != InviteActions::acceptCreate::ACTION_NAME
                && action.method != InviteActions::reject::ACTION_NAME
            {
                return e;
            }
        } else {
            // If an existing account is authorizing this transaction but wants to respond
            // to an invite, we allow any number of actions, but there must be an invite action
            // among them (accept, acceptCreate, reject) in order for the consumption of an invite
            // token to occur
            let has_invite_action = actions.iter().any(|action| {
                action.method == InviteActions::acceptCreate::ACTION_NAME
                    || action.method == InviteActions::reject::ACTION_NAME
                    || action.method == InviteActions::accept::ACTION_NAME
            });

            if !has_invite_action {
                return Err(Unauthorized.err("get_claims: must have an invite action"));
            }
        }

        let pub_key = Keyvalue::get(KEY_PUB).ok_or_else(|| MissingInviteToken.err("get_claims"))?;
        Ok(vec![Claim {
            verify_service: psibase::services::auth_invite::VERIFY_SERVICE.to_string(),
            raw_data: pub_key,
        }])
    }

    fn get_proofs(_account_name: String, message: Vec<u8>) -> Result<Vec<Proof>, Error> {
        if !from_transact() {
            return Err(Unauthorized.err("get_proofs"));
        }

        let prv_key = Keyvalue::get(KEY_PRV).ok_or_else(|| MissingInviteToken.err("get_proofs"))?;
        let signature = KeyVault::sign(&message, &prv_key)?;

        // Free the local storage space
        Keyvalue::delete(KEY_PUB);
        Keyvalue::delete(KEY_PRV);

        Ok(vec![Proof { signature }])
    }
}

bindings::export!(AuthInvite with_types_in bindings);
