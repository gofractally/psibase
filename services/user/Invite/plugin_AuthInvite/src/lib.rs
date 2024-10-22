#[allow(warnings)]
mod bindings;
mod errors;
use errors::ErrorType::*;

// Other plugins
use bindings::auth_invite::plugin::types::InviteToken;
use bindings::auth_sig::plugin::keyvault as KeyVault;
use bindings::clientdata::plugin::keyvalue as Keyvalue;
use bindings::host::common::{client as Client, types::Error};
use bindings::invite::plugin::advanced::{deserialize, InvKeys};
use bindings::transact::plugin::auth_notifier as Transact;

// Exported interfaces/types
use bindings::accounts::smart_auth::types::{Action, Claim, Proof};
use bindings::exports::accounts::smart_auth::smart_auth::Guest as SmartAuth;

use bindings::exports::auth_invite::plugin::intf::Guest as Intf;

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

// Database operation wrapper
struct InviteKeys {}
impl InviteKeys {
    const KEY_PUB: &'static str = "pub_key";
    const KEY_PRV: &'static str = "prv_key";

    fn add(keys: &InvKeys) {
        Keyvalue::set(Self::KEY_PUB, &keys.pub_key).expect("Failed to set pub key");
        Keyvalue::set(Self::KEY_PRV, &keys.priv_key).expect("Failed to set priv key");
    }

    fn delete() {
        Keyvalue::delete(Self::KEY_PUB);
        Keyvalue::delete(Self::KEY_PRV);
    }

    fn get_public_key() -> Vec<u8> {
        Keyvalue::get(Self::KEY_PUB).expect("Failed to get pub key")
    }

    fn get_private_key() -> Vec<u8> {
        Keyvalue::get(Self::KEY_PRV).expect("Failed to get priv key")
    }
}

impl Intf for AuthInvite {
    fn notify(token: InviteToken) -> Result<(), Error> {
        if let Some(app) = Client::get_sender_app().app {
            if app != psibase::services::invite::SERVICE.to_string() {
                return Err(Unauthorized.err("notify"));
            }
        }

        let inv_keys = deserialize(&token).map_err(|_| DecodeInviteError.err("notify"))?;

        InviteKeys::add(&inv_keys);

        Transact::notify();

        Ok(())
    }
}

impl SmartAuth for AuthInvite {
    fn get_claims(_: String, _: Vec<Action>) -> Result<Vec<Claim>, Error> {
        Ok(vec![Claim {
            verify_service: psibase::services::auth_invite::VERIFY_SERVICE.to_string(),
            raw_data: InviteKeys::get_public_key(),
        }])
    }

    fn get_proofs(_account_name: String, message: Vec<u8>) -> Result<Vec<Proof>, Error> {
        if !from_transact() {
            return Err(Unauthorized.err("get_proofs"));
        }

        let signature = KeyVault::sign(&message, &InviteKeys::get_private_key())?;

        // Free the local storage space
        InviteKeys::delete();

        Ok(vec![Proof { signature }])
    }
}

bindings::export!(AuthInvite with_types_in bindings);
