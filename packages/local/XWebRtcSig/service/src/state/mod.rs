//! Subjective socket/session tables for `x-wrtcsig`.

// `#[psibase::service_tables]` requires an inline module body (file-backed
// `mod tables;` is rejected as "non-inline module in proc macro input"), so
// the table definitions are `include!`d here rather than declared as a
// normal `mod`.
include!("tables.rs");

mod pending;
mod session;
mod socket;
pub mod subjective;

#[cfg(test)]
mod tests;

pub use pending::*;
pub use session::*;
pub use socket::*;
