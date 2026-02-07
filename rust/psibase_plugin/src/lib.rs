#[cfg(target_family = "wasm")]
mod wasm {
    #[allow(warnings)]
    mod bindings {
        wit_bindgen::generate!({
            path: "wit",
            world: "plugin-imports",
            generate_all,
        });
    }

    pub mod host;
    pub use bindings::host::types::types;

    mod permissions;
    pub mod trust;
    pub use trust::{Capabilities, TrustConfig, TrustLevel};

    pub mod graphql;
    pub use graphql::scalars::*;

    pub mod errors;
    pub use errors::PluginError;

    pub mod transact;
    pub use transact::{AddToTxCaller, Transact};
}

#[cfg(target_family = "wasm")]
pub use wasm::*;

pub mod graphql_utils;

/* TODO: Add modules for:
 * - host:crypto
 * - host:db
 * - host:prompt
*/
