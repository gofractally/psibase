#[allow(warnings)]
mod bindings;
mod errors;
use errors::ErrorType::*;
mod db;
use db::*;

// Other plugins
use bindings::auth_invite::plugin::types::InviteToken;
use bindings::auth_sig::plugin::keyvault as KeyVault;
use bindings::host::common::client as Client;
use bindings::host::crypto::types::Pem;
use bindings::host::types::types as HostTypes;
use bindings::host::types::types::Error;
use bindings::invite::plugin::advanced::deserialize;
use bindings::transact::plugin::{hooks::*, types::*};
use psibase::services::invite as Invite;

// Exported interfaces/types
use bindings::exports::auth_invite::plugin::intf::Guest as Intf;
use bindings::exports::transact_hook_action_auth::Guest as HookActionAuth;

use p256::ecdsa::{SigningKey, VerifyingKey};
use p256::pkcs8::{
    DecodePrivateKey, DecodePublicKey, EncodePrivateKey, EncodePublicKey, LineEnding,
};

use crate::bindings::auth_sig::plugin::keyvault::pub_from_priv;

fn from_transact() -> bool {
    Client::get_sender() == psibase::services::transact::SERVICE.to_string()
}

fn from_invite() -> bool {
    Client::get_sender() == psibase::services::invite::SERVICE.to_string()
}

fn is_valid_action(service: &str, method: &str) -> bool {
    service == psibase::services::invite::SERVICE.to_string()
        && (method == Invite::action_structs::accept::ACTION_NAME
            || method == Invite::action_structs::acceptCreate::ACTION_NAME
            || method == Invite::action_structs::reject::ACTION_NAME)
}

fn priv_from_der(key: Vec<u8>) -> Result<Pem, HostTypes::Error> {
    Ok(SigningKey::from_pkcs8_der(&key)
        .map_err(|e| CryptoError(e.to_string()))?
        .to_pkcs8_pem(LineEnding::LF)
        .map_err(|e| CryptoError(e.to_string()))?
        .to_string())
}

fn pub_from_der(key: Vec<u8>) -> Result<Pem, HostTypes::Error> {
    Ok(VerifyingKey::from_public_key_der(&key)
        .map_err(|e| CryptoError(e.to_string()))?
        .to_public_key_pem(LineEnding::LF)
        .map_err(|e| CryptoError(e.to_string()))?
        .to_string())
}

struct AuthInvite;

impl Intf for AuthInvite {
    fn notify(token: InviteToken) -> Result<(), Error> {
        if !from_invite() {
            return Err(Unauthorized("notify").into());
        }

        let priv_pem: String = priv_from_der(deserialize(&token)?.priv_key).unwrap();
        println!(
            "AuthInvite.notify: Invite public_key: {:?}",
            pub_from_priv(&priv_pem).unwrap()
        );

        println!("AuthInvite.notify: Invite private_key: {:?}", priv_pem);
        InviteKeys::add(&deserialize(&token)?);

        hook_action_auth();

        Ok(())
    }
}

impl HookActionAuth for AuthInvite {
    fn on_action_auth_claims(action: Action) -> Result<Vec<Claim>, Error> {
        if is_valid_action(&action.service, &action.method) {
            println!(
                "AuthInvite.on_action_auth_claims() Invite pubKey: {:?}",
                pub_from_der(InviteKeys::get_public_key()).unwrap()
            );
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
        println!(
            "AuthInvite.on_action_auth_proofs().0 tx_hash: {:?}",
            &transaction_hash
        );
        if !from_transact() {
            return Err(Unauthorized("get_proofs").into());
        }

        let private_key = InviteKeys::get_private_key();
        InviteKeys::delete(); // Free local storage

        let sig = KeyVault::sign_explicit(&transaction_hash, &private_key)?;
        let sig2 = KeyVault::sign_explicit2(&transaction_hash, &private_key)?;
        println!("AuthInvite.on_action_auth_proofs.sig: {:?}", sig);
        println!("AuthInvite.on_action_auth_proofs.sig2: {:?}", sig2);

        Ok(vec![Proof {
            signature: KeyVault::sign_explicit(&transaction_hash, &private_key)?,
        }])
    }
}

bindings::export!(AuthInvite with_types_in bindings);
