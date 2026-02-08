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
    pub use bindings::host::types::types::Error;

    mod permissions;
    pub mod trust;

    pub mod graphql;

    pub mod errors;
    pub use errors::PluginError;

    pub mod transact;
    pub use transact::Transact;
}

#[cfg(target_family = "wasm")]
pub use wasm::*;

pub use psibase::PluginError as Error;

pub mod graphql_utils;

/* TODO: Add modules for:
 * - host:crypto
 * - host:db
 * - host:prompt
*/
