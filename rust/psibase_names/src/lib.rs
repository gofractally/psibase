//! Rust support for Psibase name types
//!
//! [Psibase](https://psibase.io) compresses account names and method
//! names into 64 bits. This library provides the raw conversion
//! functions; the more-usable wrappers live in the
//! [psibase crate](https://docs.rs/psibase).

mod account_number;
mod account_to_number_converter;
mod constants;
mod frequency;
mod method_number;
mod method_to_number_converter;
mod number_to_string_converter;

pub use account_number::*;
pub use method_number::*;
