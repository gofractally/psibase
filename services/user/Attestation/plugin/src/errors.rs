use crate::bindings::common::plugin::types::{Error, PluginId};

#[derive(PartialEq, Eq, Hash)]
pub enum ErrorType {
    NotYetImplemented,
    InvalidAccountNumber,
}

fn my_plugin_id() -> PluginId {
    return PluginId {
        service: "attestation".to_string(),
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
        }
    }
}
