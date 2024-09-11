use crate::bindings::host::common::types::{Error, PluginId};

#[derive(PartialEq, Eq, Hash)]
pub enum ErrorType {
    NotYetImplemented,
    DecodeInviteError,
    QueryError,
    DatetimeError,
    InvalidInviteState,
    InvalidAccount,
    AccountExists,
}

fn my_plugin_id() -> PluginId {
    return PluginId {
        service: "invite".to_string(),
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
            ErrorType::DecodeInviteError => Error {
                code: self as u32,
                producer: my_plugin_id(),
                message: format!("Failed to decode invite ID: {}", msg),
            },
            ErrorType::QueryError => Error {
                code: self as u32,
                producer: my_plugin_id(),
                message: format!("Failed to post graphql query: {}", msg),
            },
            ErrorType::DatetimeError => Error {
                code: self as u32,
                producer: my_plugin_id(),
                message: format!("Datetime error: {}", msg),
            },
            ErrorType::InvalidInviteState => Error {
                code: self as u32,
                producer: my_plugin_id(),
                message: format!("Invalid invite state: {}", msg),
            },
            ErrorType::InvalidAccount => Error {
                code: self as u32,
                producer: my_plugin_id(),
                message: format!("Invalid account name: {}", msg),
            },
            ErrorType::AccountExists => Error {
                code: self as u32,
                producer: my_plugin_id(),
                message: format!("[{}] Error: Account already exists", msg),
            }
        }
    }
}
