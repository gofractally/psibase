#[allow(warnings)]
mod bindings;
use bindings::*;

mod errors;
use errors::ErrorType::*;
mod types;
use types::*;

use bindings::exports::host::crypto::types::{Keypair, Pem};
use bindings::host::types::types as HostTypes;
use bindings::supervisor::bridge::intf as Supervisor;
use exports::host::crypto::keyvault::Guest as KeyVault;

use trust::*;

// Third-party crates
use p256::ecdsa::{SigningKey, VerifyingKey};
use p256::pkcs8::{DecodePrivateKey, EncodePrivateKey, EncodePublicKey, LineEnding};
use rand_core::OsRng;

psibase::define_trust! {
    descriptions {
        None => "
        No trust grants these abilities:
            - Create new keypairs
            - Get the public key for a given private key
            - Convert PEM to DER format
        ",
        Low => "
        Low trust grants these abilities:
            - Import existing keypairs
        ",
        High => "
        High trust grants the abilities of all lower trust levels, plus these abilities:
            - Sign transactions on your behalf
        ",
    }
    functions {
        None => [generate_unmanaged_keypair, pub_from_priv, to_der],
        Low => [import_key],
        High => [sign, sign_explicit],
    }
}

struct HostCrypto;

impl KeyVault for HostCrypto {
    fn generate_unmanaged_keypair() -> Result<Keypair, HostTypes::Error> {
        authorize(FunctionName::generate_unmanaged_keypair)?;

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

    fn sign(hashed_message: Vec<u8>, public_key: Vec<u8>) -> Result<Vec<u8>, HostTypes::Error> {
        authorize(FunctionName::sign)?;

        Ok(Supervisor::sign(&hashed_message, &public_key).unwrap())
    }

    fn sign_explicit(
        hashed_message: Vec<u8>,
        private_key: Vec<u8>,
    ) -> Result<Vec<u8>, HostTypes::Error> {
        authorize(FunctionName::sign_explicit)?;

        Ok(Supervisor::sign_explicit(&hashed_message, &private_key)?)
    }

    fn import_key(private_key: Pem) -> Result<Pem, HostTypes::Error> {
        authorize_with_whitelist(
            FunctionName::import_key,
            vec!["x-admin".into(), "invite".into(), "auth-sig".into()],
        )?;

        Supervisor::import_key(&private_key)
    }
}

bindings::export!(HostCrypto with_types_in bindings);
