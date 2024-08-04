use crate::bindings::host::common::types::{Error, PluginId};

#[derive(PartialEq, Eq, Hash)]
pub enum ErrorType {
    NotYetImplemented,
    InvalidAccountNumber,
    Deserialization,
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
            ErrorType::InvalidAccountNumber => Error {
                code: self as u32,
                producer: my_plugin_id(),
                message: format!("Invalid account number: {}", msg),
            },
            ErrorType::Deserialization => Error {
                code: self as u32,
                producer: my_plugin_id(),
                message: format!("Failed to deserialize into expected type: {}", msg),
            },
        }
    }
}
