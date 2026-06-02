//! # `psibase_plugin::types`
//!
//! Wraps the types defined in the `host:types` plugin.
//!
//! ## Usage
//!
//! Tell wit-bindgen in your plugin to map `host:types/types` to `psibase_plugin::types`.
//! If you're compiling your plugin using cargo-component, this is done via the following
//! configuration in your `Cargo.toml`:
//!
//! ```toml
//! [package.metadata.component.bindings.with]
//! "host:types/types" = "psibase_plugin::types"
//! ```
//!
//! This will ensure that your plugin does not generate separate bindings for the
//! types in the `host:types` plugin, but instead uses the bindings from `psibase_plugin`.
//!
pub use crate::wasm::bindings::host::types::types::*;
