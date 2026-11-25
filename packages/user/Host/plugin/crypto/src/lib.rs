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
use p256::pkcs8::{DecodePrivateKey, EncodePublicKey, LineEnding};

/// Returns the PEM SubjectPublicKeyInfo (uncompressed point) of a PKCS #8 DER
/// private key on P-256 or secp256k1.
fn public_pem_from_pkcs8_der(der: &[u8]) -> Result<String, String> {
    let p256_error = match p256::ecdsa::SigningKey::from_pkcs8_der(der) {
        Ok(key) => {
            return key
                .verifying_key()
                .to_public_key_pem(LineEnding::LF)
                .map_err(|e| e.to_string())
        }
        Err(e) => e,
    };
    match k256::ecdsa::SigningKey::from_pkcs8_der(der) {
        Ok(key) => key
            .verifying_key()
            .to_public_key_pem(LineEnding::LF)
            .map_err(|e| e.to_string()),
        Err(k256_error) => Err(format!(
            "not a P-256 ({p256_error}) or secp256k1 ({k256_error}) PKCS #8 private key"
        )),
    }
}

psibase::define_trust! {
    descriptions {
        None => "",
        Low => "
            - Import existing keypairs
        ",
        High => "
            - Sign transactions on your behalf
        ",
    }
    functions {
        None => [generate_unmanaged_keypair, pub_from_priv, to_der, sign_explicit, import_key_transient],
        Low => [import_key],
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
        Ok(public_pem_from_pkcs8_der(pem.contents()).map_err(CryptoError)?)
    }

    fn to_der(key: Pem) -> Result<Vec<u8>, HostTypes::Error> {
        assert_authorized(FunctionName::to_der)?;

        let pem = pem::Pem::try_from_pem_str(&key)?;
        Ok(pem.into_contents())
    }

    fn sign(hashed_message: Vec<u8>, public_key: Vec<u8>) -> Result<Vec<u8>, HostTypes::Error> {
        assert_authorized_with_whitelist(
            FunctionName::sign,
            vec!["transact".into(), "auth-sig".into(), "auth-rcovr".into()],
        )?;

        Supervisor::sign(&hashed_message, &public_key)
    }

    fn sign_explicit(
        hashed_message: Vec<u8>,
        private_key: Vec<u8>,
    ) -> Result<Vec<u8>, HostTypes::Error> {
        assert_authorized(FunctionName::sign_explicit)?;

        Supervisor::sign_explicit(&hashed_message, &private_key)
    }

    fn import_key(private_key: Pem) -> Result<Pem, HostTypes::Error> {
        assert_authorized_with_whitelist(
            FunctionName::import_key,
            vec!["x-admin".into(), "invite".into(), "auth-sig".into(), "auth-rcovr".into()],
        )?;

        Supervisor::import_key(&private_key)
    }

    fn import_key_transient(private_key: Pem) -> Result<Pem, HostTypes::Error> {
        assert_authorized(FunctionName::import_key_transient)?;
        Supervisor::import_key_transient(&private_key)
    }
}

bindings::export!(HostCrypto with_types_in bindings);
