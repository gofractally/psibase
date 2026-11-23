//! Rust support for Psibase name types
//!
//! [Psibase](https://psibase.io) compresses account names and method
//! names into 64 bits. This library provides the raw conversion
//! functions; the more-usable wrappers live in the
//! [psibase crate](https://docs.rs/psibase).

mod account_number;
mod action_name;
mod method_number;
mod name_encoder;

pub use account_number::*;
pub use action_name::*;
pub use method_number::*;
