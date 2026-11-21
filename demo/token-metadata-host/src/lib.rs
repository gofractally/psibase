//! Compile the actual metadata DTO/test on the host. Only the unused WASM HTTP
//! import is stubbed; the real psibase Decimal/Precision/AccountNumber and serde
//! decoding are exercised, including null and populated administrator owners.
extern crate self as psibase_plugin;

pub mod errors {
    #[derive(Debug)]
    pub enum ErrorType { QueryError(String), TokenMismatch(String) }
}
pub mod host {
    pub mod server {
        pub struct QueryError { pub message: String }
        pub fn post_graphql_get_json(_: &str) -> Result<String, QueryError> {
            panic!("network import must never run in metadata decoding tests")
        }
    }
}

#[path = "../../../packages/user/Tokens/plugin/src/query/fetch_token.rs"]
pub mod fetch_token;
