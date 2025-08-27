#[allow(warnings)]
mod bindings;
use bindings::*;

// mod helpers;
// use helpers::*;

mod errors;
use errors::ErrorType::*;
mod db;
use db::*;
mod types;
use types::*;

use crate::supervisor::bridge::intf as Supervisor;
use bindings::exports::host::crypto::types::{Keypair, Pem};
use bindings::host::types::types as HostTypes;
use bindings::supervisor::bridge::{
    intf as Supervisor,
    // types::{self as BridgeTypes, HttpRequest, HttpResponse},
};
use exports::host::crypto::keyvault::Guest as KeyVault;

// use trust::*;

// Thurd-party crates
use p256::ecdsa::{signature::hazmat::PrehashSigner, Signature, SigningKey, VerifyingKey};
use p256::pkcs8::{DecodePrivateKey, EncodePrivateKey, EncodePublicKey, LineEnding};
use rand_core::OsRng;

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
        None => [generate_unmanaged_keypair, pub_from_priv, to_der, sign],
        Low => [generate_keypair, import_key],
        High => [priv_from_pub, set_key],
    }
}

struct HostCrypto;

impl KeyVault for HostCrypto {
    fn generate_keypair() -> Result<String, HostTypes::Error> {
        // authorize_with_whitelist(FunctionName::generate_keypair, vec!["invite".into()])?;

        let keypair = HostCrypto::generate_unmanaged_keypair()?;
        ManagedKeys::add(
            &keypair.public_key,
            &HostCrypto::to_der(keypair.private_key)?,
        );
        Ok(keypair.public_key)
    }

    fn generate_unmanaged_keypair() -> Result<Keypair, HostTypes::Error> {
        // authorize(FunctionName::generate_unmanaged_keypair)?;

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

    fn pub_from_priv(private_key: Pem) -> Result<Pem, HostTypes::Error> {
        // authorize(FunctionName::pub_from_priv)?;

        let pem = pem::Pem::try_from_pem_str(&private_key)?;
        let signing_key =
            SigningKey::from_pkcs8_der(&pem.contents()).map_err(|e| CryptoError(e.to_string()))?;
        let verifying_key = signing_key.verifying_key();

        Ok(verifying_key
            .to_public_key_pem(LineEnding::LF)
            .map_err(|e| CryptoError(e.to_string()))?)
    }

    fn priv_from_pub(public_key: Pem) -> Result<Pem, HostTypes::Error> {
        // authorize(FunctionName::priv_from_pub)?;

        let private_key = ManagedKeys::get(&public_key);
        Ok(SigningKey::from_pkcs8_der(&private_key)
            .map_err(|e| CryptoError(e.to_string()))?
            .to_pkcs8_pem(LineEnding::LF)
            .map_err(|e| CryptoError(e.to_string()))?
            .to_string())
    }

    fn to_der(key: Pem) -> Result<Vec<u8>, HostTypes::Error> {
        // authorize(FunctionName::to_der)?;

        let pem = pem::Pem::try_from_pem_str(&key)?;
        Ok(pem.contents().to_vec())
    }

    fn sign(hashed_message: Vec<u8>, private_key: Vec<u8>) -> Result<Vec<u8>, HostTypes::Error> {
        //     authorize(FunctionName::sign)?;

        let signing_key =
            SigningKey::from_pkcs8_der(&private_key).map_err(|e| CryptoError(e.to_string()))?;
        let signature: Signature = signing_key
            .sign_prehash(&hashed_message)
            .map_err(|e| CryptoError(e.to_string()))?;
        Ok(signature.to_bytes().to_vec())
    }

    fn import_key(private_key: Pem) -> Result<Pem, HostTypes::Error> {
        // authorize_with_whitelist(FunctionName::import_key, vec!["x-admin".into()])?;

        let public_key = Self::pub_from_priv(private_key.clone())?;
        // ManagedKeys::add(&public_key, &HostCrypto::to_der(private_key)?);
        Supervisor::import_key(private_key);
        Ok(public_key)
    }
}

bindings::export!(HostCrypto with_types_in bindings);
