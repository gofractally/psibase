//! Interfaces for standard services

pub mod accounts;
pub mod auth_delegate;
pub mod auth_k1;
pub mod auth_sig;
pub mod common_api;
pub mod cpu_limit;
pub mod http_server;
#[allow(non_snake_case)]
pub mod invite_sys;
#[allow(non_snake_case)]
pub mod nft_sys;
pub mod package_sys;
pub mod producers;
pub mod psispace_sys;
pub mod setcode;
pub mod transact;
