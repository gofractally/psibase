#[allow(warnings)]
mod bindings;
use base64::{engine::general_purpose::URL_SAFE, Engine};
use bindings::auth_sig::plugin::types::{Keypair, Pem};
use bindings::exports::auth_sig::plugin::smart_auth;
use bindings::exports::auth_sig::plugin::{
    actions::Guest as Actions, keyvault::Guest as KeyVault, smart_auth::Guest as SmartAuth,
};

use bindings::clientdata::plugin::keyvalue as Keyvalue;

use bindings::host::common::server as Server;
use bindings::host::common::types as CommonTypes;

mod errors;
use errors::ErrorType::*;

use p256::ecdsa::{SigningKey, VerifyingKey};
use p256::pkcs8::{DecodePrivateKey, EncodePrivateKey, EncodePublicKey, LineEnding};
use rand_core::OsRng;

use psibase::fracpack::Pack;
use psibase::services::auth_sig::action_structs as MyService;

trait TryFromPemStr: Sized {
    fn try_from_pem_str(p: Pem) -> Result<Self, CommonTypes::Error>;
}

impl TryFromPemStr for pem::Pem {
    fn try_from_pem_str(key_string: Pem) -> Result<Self, CommonTypes::Error> {
        Ok(pem::parse(key_string.trim()).map_err(|e| CryptoError.err(&e.to_string()))?)
    }
}
struct AuthSig;

impl SmartAuth for AuthSig {
    fn get_claim() -> Result<smart_auth::Claim, CommonTypes::Error> {
        Err(NotYetImplemented.err("get_claim"))
    }

    fn get_proof(_message: Vec<u8>) -> Result<smart_auth::Proof, CommonTypes::Error> {
        Err(NotYetImplemented.err("get_proof"))
    }
}

impl KeyVault for AuthSig {
    fn generate_keypair() -> Result<String, CommonTypes::Error> {
        let keypair = AuthSig::generate_unmanaged_keypair()?;
        let b64 = URL_SAFE.encode(&AuthSig::to_der(keypair.public_key.clone())?);

        // Trim off the DER metadata, and then take the first 32 characters as a key
        let trimmed = b64.get(36..).unwrap_or("").get(..32).unwrap_or("");
        assert!(trimmed.len() == 32, "Error generating new keypair");

        Keyvalue::set(trimmed, &AuthSig::to_der(keypair.private_key)?)?;
        Ok(keypair.public_key)
    }

    fn generate_unmanaged_keypair() -> Result<Keypair, CommonTypes::Error> {
        let signing_key = SigningKey::random(&mut OsRng);
        let verifying_key: &VerifyingKey = signing_key.verifying_key();

        let private_key = signing_key
            .to_pkcs8_pem(LineEnding::LF)
            .map_err(|e| CryptoError.err(&e.to_string()))?
            .to_string();
        let public_key = verifying_key
            .to_public_key_pem(LineEnding::LF)
            .map_err(|e| CryptoError.err(&e.to_string()))?;

        Ok(Keypair {
            public_key,
            private_key,
        })
    }

    fn pub_from_priv(private_key: Pem) -> Result<Pem, CommonTypes::Error> {
        let pem = pem::Pem::try_from_pem_str(private_key)?;
        let signing_key = SigningKey::from_pkcs8_der(&pem.contents())
            .map_err(|e| CryptoError.err(&e.to_string()))?;
        let verifying_key = signing_key.verifying_key();

        Ok(verifying_key
            .to_public_key_pem(LineEnding::LF)
            .map_err(|e| CryptoError.err(&e.to_string()))?)
    }

    fn to_der(key: Pem) -> Result<Vec<u8>, CommonTypes::Error> {
        let pem = pem::Pem::try_from_pem_str(key)?;
        Ok(pem.contents().to_vec())
    }
}

impl Actions for AuthSig {
    fn set_key(public_key: Pem) -> Result<(), CommonTypes::Error> {
        Server::add_action_to_transaction(
            "setKey",
            &MyService::setKey {
                key: AuthSig::to_der(public_key)?,
            }
            .packed(),
        )?;

        Ok(())
    }
}

bindings::export!(AuthSig with_types_in bindings);
