#[allow(warnings)]
mod bindings;
use bindings::*;

mod errors;
use errors::ErrorType::*;
mod types;
use types::*;

use bindings::host::types::types as HostTypes;
use bindings::host::types::types::{Keypair, Pem};
use bindings::supervisor::bridge::intf as Supervisor;
use exports::host::crypto::keyvault::Guest as KeyVault;

use trust::*;

// Third-party crates
use p256::ecdsa::SigningKey;
use p256::pkcs8::{DecodePrivateKey, EncodePublicKey, LineEnding};

psibase::define_trust! {
    descriptions {
        None => "",
        Low => "
        Low trust grants these abilities:
            - Import existing keypairs
            - Sign transaction with explicit private key provided
        ",
        High => "
        High trust grants the abilities of all lower trust levels, plus these abilities:
            - Sign transactions on your behalf
        ",
    }
    functions {
        None => [generate_unmanaged_keypair, pub_from_priv, to_der],
        Low => [import_key, sign_explicit],
        High => [sign],
    }
}

struct HostCrypto;

impl KeyVault for HostCrypto {
    fn generate_unmanaged_keypair() -> Result<Keypair, HostTypes::Error> {
        assert_authorized(FunctionName::generate_unmanaged_keypair)?;

        let (public_key, private_key) =
            psibase::generate_keypair().map_err(|e| CryptoError(e.to_string()))?;

        Ok(Keypair {
            public_key,
            private_key,
        })
    }

    fn pub_from_priv(private_key: Pem) -> Result<Pem, HostTypes::Error> {
        assert_authorized(FunctionName::pub_from_priv)?;

        let pem = pem::Pem::try_from_pem_str(&private_key)?;
        let signing_key =
            SigningKey::from_pkcs8_der(&pem.contents()).map_err(|e| CryptoError(e.to_string()))?;
        let verifying_key = signing_key.verifying_key();

        Ok(verifying_key
            .to_public_key_pem(LineEnding::LF)
            .map_err(|e| CryptoError(e.to_string()))?)
    }

    fn to_der(key: Pem) -> Result<Vec<u8>, HostTypes::Error> {
        assert_authorized(FunctionName::to_der)?;

        let pem = pem::Pem::try_from_pem_str(&key)?;
        Ok(pem.into_contents())
    }

    fn sign(hashed_message: Vec<u8>, public_key: Vec<u8>) -> Result<Vec<u8>, HostTypes::Error> {
        assert_authorized_with_whitelist(
            FunctionName::sign,
            vec!["transact".into(), "auth-sig".into()],
        )?;

        Supervisor::sign(&hashed_message, &public_key)
    }

    fn sign_explicit(
        hashed_message: Vec<u8>,
        private_key: Vec<u8>,
    ) -> Result<Vec<u8>, HostTypes::Error> {
        assert_authorized_with_whitelist(
            FunctionName::sign_explicit,
            vec!["auth-sig".into(), "auth-invite".into()],
        )?;

        Supervisor::sign_explicit(&hashed_message, &private_key)
    }

    fn import_key(private_key: Pem) -> Result<Pem, HostTypes::Error> {
        assert_authorized_with_whitelist(
            FunctionName::import_key,
            vec!["x-admin".into(), "invite".into(), "auth-sig".into()],
        )?;

        Supervisor::import_key(&private_key)
    }
}

bindings::export!(HostCrypto with_types_in bindings);
