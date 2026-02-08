//! # psibase_plugin::host
//!
//! A module that provides access to plugin host functionality.
//! The plugin host is the runtime environment in which the plugin is executed.
//!
/// Common calls related to client interactions
pub mod client {
    use crate::wasm::bindings::host::common::client;

    /// Get account name of the active app (the top level app with which the user is interacting).
    /// If the user is interacting with a prompt, the "top level app" is the app with which the user
    /// was interacting when the prompt was triggered.
    pub fn get_active_app() -> String {
        client::get_active_app()
    }

    /// Gets the account name of the caller app
    pub fn get_sender() -> String {
        client::get_sender()
    }

    /// Gets the account name of the receiver of the current call (the account name
    /// of the currently running app).
    pub fn get_receiver() -> String {
        client::get_receiver()
    }

    /// Gets the URL of the specified app on the current root domain.
    pub fn get_app_url(app: String) -> String {
        client::get_app_url(&app)
    }
}

/// Common calls related to interactions with the server
pub mod server {
    use crate::wasm::bindings::host::common::server;
    use crate::wasm::bindings::host::types::types::{BodyTypes, Error, PostRequest};

    /// Used to call a GET endpoint on the app's own http server to retrieve a JSON payload.
    ///
    /// Parameters
    /// * `endpoint` - The subpath being requested (e.g. `/common/tapos/head` or `/api/some-request`)
    pub fn get_json(endpoint: &str) -> Result<String, Error> {
        server::get_json(endpoint)
    }

    /// Used to make a post request to the app's own http server.
    ///
    /// Parameters
    /// * `request`: The required details of the post request
    pub fn post(request: PostRequest) -> Result<BodyTypes, Error> {
        server::post(&request)
    }

    /// Used to post graphql to the server and get a JSON response back.
    /// The graphql payload is automatically posted to the app's own `/graphql` endpoint.
    ///
    /// Parameters
    /// * `graphql`: The graphql data for the request
    pub fn post_graphql_get_json(graphql: &str) -> Result<String, Error> {
        server::post_graphql_get_json(&graphql)
    }
}

/// Methods related to key management
pub mod crypto {
    use crate::wasm::bindings::host::crypto::keyvault;
    use crate::wasm::bindings::host::types::types::Error;
    use crate::wasm::types::{Keypair, Pem};

    /// Generates a new keypair that is unmanaged (nothing is stored).
    /// The full keypair is returned to the caller.
    pub fn generate_unmanaged_keypair() -> Result<Keypair, Error> {
        keyvault::generate_unmanaged_keypair()
    }

    /// Returns the public key corresponding to the specified
    /// private key.
    pub fn pub_from_priv(private_key: Pem) -> Result<Pem, Error> {
        keyvault::pub_from_priv(&private_key)
    }

    /// Returns the DER encoded key
    pub fn to_der(key: Pem) -> Result<Vec<u8>, Error> {
        keyvault::to_der(&key)
    }

    /// Signs a pre-hashed message with the private key corresponding
    ///   to the specified DER-encoded public key
    pub fn sign(hashed_message: Vec<u8>, public_key: Vec<u8>) -> Result<Vec<u8>, Error> {
        keyvault::sign(&hashed_message, &public_key)
    }

    /// Signs a pre-hashed message with the specified DER-encoded private key
    pub fn sign_explicit(hashed_message: Vec<u8>, private_key: Vec<u8>) -> Result<Vec<u8>, Error> {
        keyvault::sign_explicit(&hashed_message, &private_key)
    }

    /// Imports a PEM-encoded private key into the keyvault.
    /// Returns the corresponding public key in PEM format.
    pub fn import_key(private_key: Pem) -> Result<Pem, Error> {
        keyvault::import_key(&private_key)
    }
}

/// A keyvalue interface that provides key-value operations.
///
/// Once a write operation completes, all subsequent read operations will return the value that
/// was written. Another client running in a different context may or may not immediately see the
/// result.
pub mod store {
    use crate::wasm::bindings::host::common::store;

    pub use store::{Bucket, Database, DbMode, StorageDuration};
}
