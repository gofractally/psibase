use crate::bindings::host::common::types::{Error, PluginId};

#[derive(PartialEq, Eq, Hash)]
pub enum ErrorType {
    NotYetImplemented,
    PubKeyParse,
    SerializationError,
    DecodeInviteError,
    QueryError,
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
            ErrorType::PubKeyParse => Error {
                code: self as u32,
                producer: my_plugin_id(),
                message: format!("Failed to parse pubkey: {}", msg),
            },
            ErrorType::SerializationError => Error {
                code: self as u32,
                producer: my_plugin_id(),
                message: format!("Failed to serialize: {}", msg),
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
        }
    }
}
