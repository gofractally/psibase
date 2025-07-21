#[allow(warnings)]
mod bindings;
mod errors;
use errors::ErrorType::*;
mod helpers;
use helpers::*;
mod db;
use db::*;
mod types;
use types::*;

// Other plugins
use bindings::auth_sig::plugin::types::{Keypair, Pem};
use bindings::host::common::client::get_sender_app;
use bindings::host::common::types as CommonTypes;
use bindings::permissions::plugin::{api::authorize, types::Risk};
use bindings::transact::plugin::intf as Transact;

// Exported interfaces
use bindings::exports::auth_sig::plugin::{actions::Guest as Actions, keyvault::Guest as KeyVault};
use bindings::exports::transact_hook_user_auth::{Guest as HookUserAuth, *};

// Services
use psibase::services::auth_sig::action_structs as MyService;

// Third-party crates
use p256::ecdsa::{signature::hazmat::PrehashSigner, Signature, SigningKey, VerifyingKey};
use p256::pkcs8::{DecodePrivateKey, EncodePrivateKey, EncodePublicKey, LineEnding};
use psibase::fracpack::Pack;
use rand_core::OsRng;
use std::collections::HashMap;

struct AuthSig;

fn get_risk_description(level: u8) -> &'static str {
    match level {
        2 => indoc::indoc! {"
            - Create new keypairs
            - Import existing keypairs
            - Consume account resources
        "},
        5 => indoc::indoc! {"
            - Set the public key for your account
            - Sign transactions on your behalf
            - Extract your private key from your public key
            - Consume account resources
        "},
        _ => "",
    }
}

fn get_risk_levels() -> HashMap<&'static str, u8> {
    let mut map = HashMap::new();
    map.insert("generate_keypair", 2);
    map.insert("generate_unmanaged_keypair", 0);
    map.insert("pub_from_priv", 0);
    map.insert("priv_from_pub", 5);
    map.insert("to_der", 0);
    map.insert("sign", 5);
    map.insert("import_key", 2);
    map.insert("set_key", 5);
    map
}

lazy_static::lazy_static! {
    static ref RISK_LEVELS: HashMap<&'static str, u8> = get_risk_levels();
}

fn check_authorization(fn_name: &str) -> Result<(), Error> {
    let level = RISK_LEVELS.get(fn_name).unwrap_or(&6);
    let description = get_risk_description(*level).to_string();
    let r = Risk {
        level: *level,
        description,
    };
    let result = authorize(&get_sender_app().app.unwrap(), &r)?;
    if !result {
        return Err(Unauthorized("authorize").into());
    }
    Ok(())
}

impl HookUserAuth for AuthSig {
    fn on_user_auth_claim(account_name: String) -> Result<Option<Claim>, Error> {
        if !from_transact() {
            return Err(Unauthorized("on_user_auth_claim").into());
        }

        let pubkey = get_pubkey(&account_name)?;
        if !ManagedKeys::has(&pubkey) {
            return Err(KeyNotFound("on_user_auth_claim").into());
        }

        Ok(Some(Claim {
            verify_service: psibase::services::verify_sig::SERVICE.to_string(),
            raw_data: AuthSig::to_der(pubkey)?,
        }))
    }

    fn on_user_auth_proof(
        account_name: String,
        transaction_hash: Vec<u8>,
    ) -> Result<Option<Proof>, Error> {
        if !from_transact() {
            return Err(Unauthorized("get_proofs").into());
        }

        let pubkey = get_pubkey(&account_name)?;
        let private_key = ManagedKeys::get(&pubkey);
        let signature = AuthSig::sign(transaction_hash, private_key)?;
        Ok(Some(Proof { signature }))
    }
}

impl KeyVault for AuthSig {
    fn generate_keypair() -> Result<String, CommonTypes::Error> {
        check_authorization("generate_keypair")?;
        let keypair = AuthSig::generate_unmanaged_keypair()?;
        ManagedKeys::add(&keypair.public_key, &AuthSig::to_der(keypair.private_key)?);
        Ok(keypair.public_key)
    }

    fn generate_unmanaged_keypair() -> Result<Keypair, CommonTypes::Error> {
        check_authorization("generate_unmanaged_keypair")?;

        let signing_key = SigningKey::random(&mut OsRng);
        let verifying_key: &VerifyingKey = signing_key.verifying_key();

        let private_key = signing_key
            .to_pkcs8_pem(LineEnding::LF)
            .map_err(|e| CryptoError(e.to_string()))?
            .to_string();
        let public_key = verifying_key
            .to_public_key_pem(LineEnding::LF)
            .map_err(|e| CryptoError(e.to_string()))?;

        Ok(Keypair {
            public_key,
            private_key,
        })
    }

    fn pub_from_priv(private_key: Pem) -> Result<Pem, CommonTypes::Error> {
        check_authorization("pub_from_priv")?;

        let pem = pem::Pem::try_from_pem_str(&private_key)?;
        let signing_key =
            SigningKey::from_pkcs8_der(&pem.contents()).map_err(|e| CryptoError(e.to_string()))?;
        let verifying_key = signing_key.verifying_key();

        Ok(verifying_key
            .to_public_key_pem(LineEnding::LF)
            .map_err(|e| CryptoError(e.to_string()))?)
    }

    fn priv_from_pub(public_key: Pem) -> Result<Pem, CommonTypes::Error> {
        check_authorization("priv_from_pub")?;

        let private_key = ManagedKeys::get(&public_key);
        Ok(SigningKey::from_pkcs8_der(&private_key)
            .map_err(|e| CryptoError(e.to_string()))?
            .to_pkcs8_pem(LineEnding::LF)
            .map_err(|e| CryptoError(e.to_string()))?
            .to_string())
    }

    fn to_der(key: Pem) -> Result<Vec<u8>, CommonTypes::Error> {
        check_authorization("to_der")?;

        let pem = pem::Pem::try_from_pem_str(&key)?;
        Ok(pem.contents().to_vec())
    }

    fn sign(hashed_message: Vec<u8>, private_key: Vec<u8>) -> Result<Vec<u8>, CommonTypes::Error> {
        check_authorization("sign")?;

        let signing_key =
            SigningKey::from_pkcs8_der(&private_key).map_err(|e| CryptoError(e.to_string()))?;
        let signature: Signature = signing_key
            .sign_prehash(&hashed_message)
            .map_err(|e| CryptoError(e.to_string()))?;
        Ok(signature.to_bytes().to_vec())
    }

    fn import_key(private_key: Pem) -> Result<Pem, CommonTypes::Error> {
        check_authorization("import_key")?;

        let public_key = AuthSig::pub_from_priv(private_key.clone())?;
        ManagedKeys::add(&public_key, &AuthSig::to_der(private_key)?);
        Ok(public_key)
    }
}

impl Actions for AuthSig {
    fn set_key(public_key: Pem) -> Result<(), CommonTypes::Error> {
        check_authorization("set_key")?;

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
