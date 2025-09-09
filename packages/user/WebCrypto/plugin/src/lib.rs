#[allow(warnings)]
mod bindings;

mod errors;
use errors::ErrorType::*;
mod db;
use db::*;
mod types;
use types::*;

use bindings::exports::web_crypto::plugin::api::Guest as Api;
use bindings::host::common::client as HostCommon;
use bindings::host::crypto::types::Pem;
use bindings::host::types::types as HostTypes;

use trust::*;

// Third-party crates
use p256::ecdsa::{signature::hazmat::PrehashSigner, Signature, SigningKey, VerifyingKey};
use p256::pkcs8::{
    DecodePrivateKey, DecodePublicKey, EncodePrivateKey, EncodePublicKey, LineEnding,
};

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
            - Read the private key for a given public key
        ",
    }
    functions {
        None => [pub_from_priv, to_der, pub_from_der, priv_from_der, sign, sign_explicit],
        Low => [import_key],
        High => [],
    }
}

fn pub_from_priv(private_key: Pem) -> Result<Pem, HostTypes::Error> {
    authorize(FunctionName::pub_from_priv)?;

    let pem = pem::Pem::try_from_pem_str(&private_key)?;
    let signing_key =
        SigningKey::from_pkcs8_der(&pem.contents()).map_err(|e| CryptoError(e.to_string()))?;
    let verifying_key = signing_key.verifying_key();

    Ok(verifying_key
        .to_public_key_pem(LineEnding::LF)
        .map_err(|e| CryptoError(e.to_string()))?)
}

fn to_der(key: Pem) -> Result<Vec<u8>, HostTypes::Error> {
    authorize(FunctionName::to_der)?;

    let pem = pem::Pem::try_from_pem_str(&key)?;
    Ok(pem.contents().to_vec())
}

fn pub_from_der(key: Vec<u8>) -> Result<Pem, HostTypes::Error> {
    authorize(FunctionName::pub_from_der)?;

    Ok(VerifyingKey::from_public_key_der(&key)
        .map_err(|e| CryptoError(e.to_string()))?
        .to_public_key_pem(LineEnding::LF)
        .map_err(|e| CryptoError(e.to_string()))?
        .to_string())
}

struct WebCryptoShim;

impl Api for WebCryptoShim {
    fn sign_explicit(
        hashed_message: Vec<u8>,
        private_key: Vec<u8>,
    ) -> Result<Vec<u8>, HostTypes::Error> {
        authorize_with_whitelist(FunctionName::sign_explicit, vec!["supervisor".into()])?;

        // NOTE for future: this could very well not be an account's key, so I'd have to import it to WebCrypto and then sign
        // (perferably don't import it to WebCryto to avoid bloat)
        let signing_key =
            SigningKey::from_pkcs8_der(&private_key).map_err(|e| CryptoError(e.to_string()))?;
        let signature: Signature = signing_key
            .sign_prehash(&hashed_message)
            .map_err(|e| CryptoError(e.to_string()))?;
        Ok(signature.to_bytes().to_vec())
    }

    fn sign(hashed_message: Vec<u8>, public_key: Vec<u8>) -> Result<Vec<u8>, HostTypes::Error> {
        authorize_with_whitelist(FunctionName::sign, vec!["supervisor".into()])?;

        let private_key = ManagedKeys::get(&pub_from_der(public_key)?);
        Self::sign_explicit(hashed_message, private_key)
    }

    fn import_key(private_key: Pem) -> Result<Pem, HostTypes::Error> {
        authorize_with_whitelist(
            FunctionName::import_key,
            vec!["x-admin".into(), "supervisor".into()],
        )?;
        let public_key = pub_from_priv(private_key.clone())?;
        // Store private CryptoKey in Map by public_key
        ManagedKeys::add(&public_key, &to_der(private_key)?);

        // Hypothetical call out to SubtleCrypto
        // convert SubtleCrypto types to psibase types
        Ok(public_key)
    }
}

bindings::export!(WebCryptoShim with_types_in bindings);
