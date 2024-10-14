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

impl Intf for AuthInvite {
    fn notify(token: InviteToken) -> Result<(), Error> {
        let mut tokens: Tokens = Keyvalue::get("tokens")
            .map(|a| <Tokens>::unpacked(&a).expect("[finish_tx] Failed to unpack"))
            .unwrap_or(Tokens { tokens: vec![] });

        if tokens.tokens.contains(&token) {
            return Ok(());
        }

        tokens.tokens.push(token);
        Keyvalue::set("tokens", &tokens.packed())?;

        Ok(())
    }
}

// Database keys
const KEY_INVITE_TOKENS: &str = "tokens";
const KEY_ACTIVE_PK: &str = "active_claim";

impl SmartAuth for AuthInvite {
    fn get_claims(account_name: String, actions: Vec<Action>) -> Result<Vec<Claim>, Error> {
        if !from_transact() {
            return Err(Unauthorized.err("get_claims"));
        }

        let current_user = Client::get_logged_in_user()?;
        if current_user.is_some() {
            return Err(Unauthorized.err("get_claims: use auth of the logged-in user"));
        }

        let payer_account = psibase::services::invite::PAYER_ACCOUNT.to_string();
        if account_name != payer_account {
            return Err(Unauthorized.err(&format!(
                "get_claims: can only provide claims for {}",
                payer_account
            )));
        }

        if actions.len() != 1 {
            return Err(Unauthorized.err("get_claims: must have exactly one action"));
        }

        let action = actions.first().unwrap();
        if action.method != InviteActions::acceptCreate::ACTION_NAME
            && action.method != InviteActions::reject::ACTION_NAME
        {
            return Err(Unauthorized.err("get_claims: action must be acceptCreate or reject"));
        }

        let tokens = Keyvalue::get(KEY_INVITE_TOKENS)
            .map(|a| <Tokens>::unpacked(&a).expect("get_claims: Failed to unpack invite tokens"));

        if tokens.is_none() || tokens.as_ref().unwrap().tokens.is_empty() {
            return Err(MissingInviteToken.err("get_claims"));
        }

        // Consume an available token
        let mut tokens = tokens.unwrap().tokens;
        let token = tokens.pop().unwrap();
        Keyvalue::set(KEY_INVITE_TOKENS, &Tokens { tokens }.packed())?;

        let inv_keys = deserialize(&token).map_err(|_| DecodeInviteError.err("get_claims"))?;

        Keyvalue::set(KEY_ACTIVE_PK, &inv_keys.priv_key)?;

        Ok(vec![Claim {
            verify_service: psibase::services::auth_invite::VERIFY_SERVICE.to_string(),
            raw_data: inv_keys.pub_key,
        }])
    }

    fn get_proofs(account_name: String, message: Vec<u8>) -> Result<Vec<Proof>, Error> {
        if !from_transact() {
            return Err(Unauthorized.err("get_proofs"));
        }

        let payer_account = psibase::services::invite::PAYER_ACCOUNT.to_string();
        if account_name != payer_account {
            return Err(Unauthorized.err(&format!(
                "get_proofs: can only provide proofs for {}",
                payer_account
            )));
        }

        let pk = Keyvalue::get(KEY_ACTIVE_PK).expect("get_proofs: Failed to get active pk");

        let signature = KeyVault::sign(&message, &pk)?;

        Ok(vec![Proof { signature }])
    }
}

bindings::export!(AuthInvite with_types_in bindings);
