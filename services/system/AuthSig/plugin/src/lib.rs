#[allow(warnings)]
mod bindings;

use bindings::auth_sig::plugin::types::Keypair;
use bindings::host::common::server as Server;
use bindings::host::common::types as CommonTypes;
use bindings::exports::auth_sig::plugin::smart_auth;
use bindings::exports::auth_sig::plugin::{
    actions::Guest as Actions, keyvault::Guest as KeyVault, smart_auth::Guest as SmartAuth,
};

mod errors;
use errors::ErrorType::*;

use p256::ecdsa::{SigningKey, VerifyingKey};
use p256::pkcs8::Document;
use p256::pkcs8::{EncodePrivateKey, EncodePublicKey, LineEnding};
use rand_core::OsRng;

use psibase::fracpack::Pack;
use psibase::services::auth_sig::action_structs as MyService;

struct Component;

impl SmartAuth for Component {
    fn get_claim() -> Result<smart_auth::Claim, CommonTypes::Error> {
        Err(NotYetImplemented.err("get_claim"))
    }

    fn get_proof(_message: Vec<u8>) -> Result<smart_auth::Proof, CommonTypes::Error> {
        Err(NotYetImplemented.err("get_proof"))
    }
}

impl KeyVault for Component {
    fn generate_keypair() -> Result<String, CommonTypes::Error> {
        Err(NotYetImplemented.err("generate_keypair"))
    }

    fn generate_unmanaged_keypair() -> Result<Keypair, CommonTypes::Error> {
        let signing_key = SigningKey::random(&mut OsRng);
        let verifying_key: &VerifyingKey = signing_key.verifying_key();

        let priv_pem = signing_key
            .to_pkcs8_pem(LineEnding::LF)
            .map_err(|e| CryptoError.err(&e.to_string()))?
            .to_string();
        let pub_pem = verifying_key
            .to_public_key_pem(LineEnding::LF)
            .map_err(|e| CryptoError.err(&e.to_string()))?;

        Ok(Keypair {
            pub_pem: pub_pem,
            priv_pem: priv_pem,
        })
    }
}

impl Actions for Component {
    fn set_key(pub_pem: String) -> Result<(), CommonTypes::Error> {
        let (_, doc) = Document::from_pem(&pub_pem).map_err(|e| CryptoError.err(&e.to_string()))?;

        Server::add_action_to_transaction(
            "setKey",
            &MyService::setKey {
                key: doc.into_vec(),
            }
            .packed(),
        )?;

        Ok(())
    }
}

bindings::export!(Component with_types_in bindings);
