//! Interfaces for standard services

pub mod accounts;
pub mod auth_delegate;
pub mod auth_invite;
pub mod auth_sig;
pub mod brotli_codec;
pub mod chainmail;
pub mod common_api;
pub mod cpu_limit;
pub mod evaluations;
pub mod events;
pub mod fractals;
pub mod http_server;
#[allow(non_snake_case)]
pub mod invite;
#[allow(non_snake_case)]
pub mod nft;
pub mod packages;
pub mod producers;
pub mod r_events;
pub mod setcode;
pub mod sites;
pub mod staged_tx;
pub mod subgroups;
pub mod symbol;
pub mod tokens;
pub mod transact;
pub mod verify_sig;
pub mod x_admin;
