#[allow(warnings)]
mod bindings;
mod errors;
use errors::ErrorType::*;
mod helpers;
use helpers::*;
mod types;
use trust::*;

// Other plugins
use bindings::host::crypto::keyvault as HostCrypto;
use bindings::host::types::types as HostTypes;
use bindings::host::types::types::{Keypair, Pem};
use bindings::transact::plugin::intf as Transact;

// Exported interfaces
use bindings::exports::auth_sig::plugin::{actions::Guest as Actions, keyvault::Guest as KeyVault};
use bindings::exports::transact_hook_user_auth::{Guest as HookUserAuth, *};

// Services
use psibase::services::auth_sig::action_structs as MyService;

use psibase::fracpack::Pack;

psibase::define_trust! {
    descriptions {
        Low => "
        Low trust grants these abilities:
            - Create new keypairs
            - Import existing keypairs
        ",
        Medium => "",
        High => "
        High trust grants the abilities of all lower trust levels, plus these abilities:
            - Set the public key for your account
            - Sign transactions on your behalf
        ",
    }
    functions {
        None => [generate_unmanaged_keypair, pub_from_priv, to_der],
        Low => [import_key, sign_explicit],
        High => [set_key, sign],
    }
}

struct AuthSig;

impl HookUserAuth for AuthSig {
    fn on_user_auth_claim(account_name: String) -> Result<Option<Claim>, Error> {
        if !from_transact() {
            return Err(Unauthorized("on_user_auth_claim".to_string()).into());
        }

        Ok(Some(Claim {
            verify_service: psibase::services::verify_sig::SERVICE.to_string(),
            raw_data: AuthSig::to_der(get_pubkey(&account_name)?)?,
        }))
    }

    fn on_user_auth_proof(
        account_name: String,
        transaction_hash: Vec<u8>,
    ) -> Result<Option<Proof>, Error> {
        if !from_transact() {
            return Err(Unauthorized("get_proofs".to_string()).into());
        }

        let public_key = HostCrypto::to_der(&get_pubkey(&account_name)?)?;
        let signature = AuthSig::sign(transaction_hash, public_key)?;
        Ok(Some(Proof { signature }))
    }
}

impl KeyVault for AuthSig {
    fn generate_unmanaged_keypair() -> Result<Keypair, HostTypes::Error> {
        assert_authorized(FunctionName::generate_unmanaged_keypair)?;
        HostCrypto::generate_unmanaged_keypair()
    }

    fn pub_from_priv(private_key: Pem) -> Result<Pem, HostTypes::Error> {
        assert_authorized(FunctionName::pub_from_priv)?;
        HostCrypto::pub_from_priv(&private_key)
    }

    fn to_der(key: Pem) -> Result<Vec<u8>, HostTypes::Error> {
        assert_authorized(FunctionName::to_der)?;
        HostCrypto::to_der(&key)
    }

    fn sign_explicit(
        hashed_message: Vec<u8>,
        private_key: Vec<u8>,
    ) -> Result<Vec<u8>, HostTypes::Error> {
        assert_authorized_with_whitelist(FunctionName::sign_explicit, vec!["auth-invite".into()])?;
        HostCrypto::sign_explicit(&hashed_message, &private_key)
    }

    fn sign(hashed_message: Vec<u8>, public_key: Vec<u8>) -> Result<Vec<u8>, HostTypes::Error> {
        assert_authorized_with_whitelist(FunctionName::sign, vec!["transact".into()])?;
        HostCrypto::sign(&hashed_message, &public_key)
    }

    fn import_key(private_key: Pem) -> Result<Pem, HostTypes::Error> {
        assert_authorized_with_whitelist(
            FunctionName::import_key,
            vec!["accounts".into(), "x-admin".into(), "invite".into()],
        )?;
        HostCrypto::import_key(&private_key)
    }
}

impl Actions for AuthSig {
    fn set_key(public_key: Pem) -> Result<(), HostTypes::Error> {
        assert_authorized(FunctionName::set_key)?;

        Transact::add_action_to_transaction(
            MyService::setKey::ACTION_NAME,
            &MyService::setKey {
                key: AuthSig::to_der(public_key)?.into(),
            }
            .packed(),
        )?;

        Ok(())
    }
}

bindings::export!(AuthSig with_types_in bindings);
