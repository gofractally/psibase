use crate::bindings::host::common::types::{Error, PluginId};

#[derive(PartialEq, Eq, Hash)]
pub enum ErrorType {
    NotYetImplemented,
    AccountDNE,
    InvalidAccountName,
    QueryError,
}

fn my_plugin_id() -> PluginId {
    return PluginId {
        service: "accounts".to_string(),
        plugin: "plugin".to_string(),
    };
}

impl ErrorType {
    pub fn err(self, msg: &str) -> Error {
        match self {
            ErrorType::NotYetImplemented => Error {
                code: self as u32,
                producer: my_plugin_id(),
                message: format!("Not yet implemented: {}", msg),
            },
            ErrorType::InvalidAccountName => Error {
                code: self as u32,
                producer: my_plugin_id(),
                message: format!("Invalid account name: {}", msg),
            },
            ErrorType::AccountDNE => Error {
                code: self as u32,
                producer: my_plugin_id(),
                message: format!("Account DNE: {}", msg),
            },
            ErrorType::QueryError => Error {
                code: self as u32,
                producer: my_plugin_id(),
                message: format!("Graphql query error: {}", msg),
            },
        }
    }
}
