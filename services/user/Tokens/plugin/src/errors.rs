use crate::bindings::common::plugin::types::{Error, PluginId};

#[derive(PartialEq, Eq, Hash)]
pub enum ErrorType {
    QueryError,
    InvalidTokenId,
    TokenNumberMismatch,
    NotImplemented,
}

fn my_plugin_id() -> PluginId {
    PluginId {
        service: "tokens".to_string(),
        plugin: "plugin".to_string(),
    }
}

impl ErrorType {
    pub fn err(self, msg: &str) -> Error {
        match self {
            ErrorType::QueryError => Error {
                code: self as u32,
                producer: my_plugin_id(),
                message: format!("Failed to post graphql query: {}", msg),
            },
            ErrorType::InvalidTokenId => Error {
                code: self as u32,
                producer: my_plugin_id(),
                message: format!("Invalid token ID: {}", msg),
            },
            ErrorType::TokenNumberMismatch => Error {
                code: self as u32,
                producer: my_plugin_id(),
                message: format!("Token number mismatch: {}", msg),
            },
            ErrorType::NotImplemented => Error {
                code: self as u32,
                producer: my_plugin_id(),
                message: format!("Feature not implemented: {}", msg),
            },
        }
    }
}
