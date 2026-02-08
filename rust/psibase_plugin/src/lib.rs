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
    pub mod types;
    pub use types::Error;

    mod permissions;
    pub mod trust;

    pub mod graphql;

    pub mod error_trait;

    mod transact;
    pub use transact::Transact;
}

#[cfg(target_family = "wasm")]
pub use wasm::*;

#[cfg(target_family = "wasm")]
pub use psibase::authorized;

#[cfg(target_family = "wasm")]
pub use psibase::PluginError as ErrorEnum;

mod graphql_utils;

/* TODO: Add modules for:
 * - host:crypto
 * - host:db
 * - host:prompt
*/
