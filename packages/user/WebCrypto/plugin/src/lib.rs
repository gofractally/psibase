#[allow(warnings)]
mod bindings;

mod errors;
use errors::ErrorType::*;
mod db;
use db::*;
mod keys;
use keys::KeyStore;
mod sign;
mod types;
use types::*;

use bindings::exports::web_crypto::plugin::api::Guest as Api;
use bindings::host::client::api as Client;
use bindings::host::types::types as HostTypes;
use bindings::host::types::types::Pem;

fn import(store: &dyn KeyStore, private_key: Pem) -> Result<Pem, HostTypes::Error> {
    let pem = pem::Pem::try_from_pem_str(&private_key)?;
    let public_key = keys::import(store, pem.contents()).map_err(CryptoError)?;
    Ok(public_key.to_pem().map_err(CryptoError)?)
}

struct WebCryptoShim;

impl Api for WebCryptoShim {
    fn sign_explicit(
        hashed_message: Vec<u8>,
        private_key: Vec<u8>,
    ) -> Result<Vec<u8>, HostTypes::Error> {
        assert!(Client::get_sender() == "supervisor");

        // NOTE for future: this could very well not be an account's key, so I'd have to import it to WebCrypto and then sign
        // (perferably don't import it to WebCryto to avoid bloat)
        sign::sign_prehashed(&hashed_message, &private_key).map_err(|e| CryptoError(e).into())
    }

    fn sign(hashed_message: Vec<u8>, public_key: Vec<u8>) -> Result<Vec<u8>, HostTypes::Error> {
        assert!(Client::get_sender() == "supervisor");

        let private_key = keys::find(&[&ManagedKeys, &TempKeys], &public_key)
            .map_err(CryptoError)?
            .expect("WebCrypto::sign: Key not found");
        Self::sign_explicit(hashed_message, private_key)
    }

    fn import_key(private_key: Pem) -> Result<Pem, HostTypes::Error> {
        assert!(Client::get_sender() == "supervisor" || Client::get_sender() == "x-admin");

        // Store the private key under its public key
        import(&ManagedKeys, private_key)
    }

    fn import_key_transient(private_key: Pem) -> Result<Pem, HostTypes::Error> {
        assert!(Client::get_sender() == "supervisor");

        import(&TempKeys, private_key)
    }

    fn delete_key(public_key: Vec<u8>) -> Result<(), HostTypes::Error> {
        assert!(Client::get_sender() == "supervisor");

        Ok(keys::forget(&ManagedKeys, &public_key).map_err(CryptoError)?)
    }
}

bindings::export!(WebCryptoShim with_types_in bindings);
