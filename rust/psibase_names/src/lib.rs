//! Rust support for Psibase account names
//!
//! [Psibase](https://psibase.io) compresses account names into 64 bits.
//! This library provides the raw conversion functions; the more-usable
//! wrapper lives in the [psibase crate](https://docs.rs/psibase).
//!
//! Method names are numbered by PSIO (`psio::compress_name`).

mod account_number;
mod name_encoder;

pub use account_number::*;
