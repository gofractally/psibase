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
