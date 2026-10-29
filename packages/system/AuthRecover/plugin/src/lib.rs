#[allow(warnings)]
mod bindings;
mod helpers;
use helpers::*;

use bindings::exports::auth_recover::plugin::{
    actions::Guest as Actions, keyvault::Guest as KeyVault,
};
use bindings::exports::transact_hook_user_auth::{Guest as HookUserAuth, *};

use bindings::host::crypto::keyvault as HostCrypto;
use bindings::transact::plugin::api as Transact;
use psibase_plugin::types as HostTypes;

use psibase::services::auth_recover::Wrapper as MyService;
use psibase_plugin::{
    authorized,
    trust::{Capabilities, TrustConfig},
    Transact as _,
};

mod errors;
use errors::ErrorType;

struct AuthRecoverPlugin;

impl TrustConfig for AuthRecoverPlugin {
    fn capabilities() -> Capabilities {
        Capabilities {
            low: &["Import keypairs"],
            medium: &["Create new accounts"],
            high: &[
                "Set the public key for your account",
                "Sign transactions on your behalf",
            ],
        }
    }
}

impl HookUserAuth for AuthRecoverPlugin {
    fn on_user_auth_claim(account_name: String) -> Result<Option<Claim>, HostTypes::Error> {
        if !from_transact() {
            return Err(ErrorType::Unauthorized("on_user_auth_claim").into());
        }

        Ok(Some(to_claim(HostCrypto::to_der(&get_pubkey(
            &account_name,
        )?)?)))
    }

    fn on_user_auth_proof(
        account_name: String,
        transaction_hash: Vec<u8>,
    ) -> Result<Option<Proof>, HostTypes::Error> {
        if !from_transact() {
            return Err(ErrorType::Unauthorized("get_proofs").into());
        }

        let public_key = HostCrypto::to_der(&get_pubkey(&account_name)?)?;
        let signature = HostCrypto::sign(&transaction_hash, &public_key)?;
        Ok(Some(Proof { signature }))
    }
}

impl KeyVault for AuthRecoverPlugin {
    #[authorized(High, whitelist = ["transact"])]
    fn sign(hashed_message: Vec<u8>, public_key: Vec<u8>) -> Result<Vec<u8>, HostTypes::Error> {
        HostCrypto::sign(&hashed_message, &public_key)
    }

    #[authorized(Low, whitelist = ["accounts", "x-admin", "invite", "namemarket", "homepage"])]
    fn import_key(private_key: HostTypes::Pem) -> Result<HostTypes::Pem, HostTypes::Error> {
        HostCrypto::import_key(&private_key)
    }
}

impl Actions for AuthRecoverPlugin {
    #[authorized(High, whitelist = ["accounts", "namemarket", "homepage"])]
    fn set_key(public_key: HostTypes::Pem) -> Result<(), HostTypes::Error> {
        let pubkey = HostCrypto::to_der(&public_key)?;
        Transact::add_signature(&to_claim(pubkey.clone()))?;
        MyService::add_to_tx().setKey(pubkey.into());
        MyService::add_to_tx().activate();

        Ok(())
    }

    #[authorized(High, whitelist = ["homepage"])]
    fn set_recovery(account: String) -> Result<(), HostTypes::Error> {
        let name = psibase::AccountNumber::from_exact(&account)
            .map_err(|_| ErrorType::InvalidAccountName(&account))?;
        MyService::add_to_tx().setRecovery(name);
        Ok(())
    }

    #[authorized(Medium, whitelist = ["accounts"])]
    fn create_account(new_account_name: String) -> Result<String, HostTypes::Error> {
        let name = psibase::AccountNumber::from_exact(&new_account_name)
            .map_err(|_| ErrorType::InvalidAccountName(&new_account_name))?;

        let keypair = HostCrypto::generate_unmanaged_keypair()?;
        let key = HostCrypto::to_der(&keypair.public_key)?;

        MyService::add_to_tx().newAccount(name, key.into());

        Ok(keypair.private_key)
    }
}

bindings::export!(AuthRecoverPlugin with_types_in bindings);
