use crate::bindings::host::common::types::{Error, PluginId};

#[derive(PartialEq, Eq, Hash)]
pub enum ErrorType {
    NotYetImplemented,
    CryptoError,
}

fn my_plugin_id() -> PluginId {
    return PluginId {
        service: "auth-sig".to_string(),
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
            ErrorType::CryptoError => Error {
                code: self as u32,
                producer: my_plugin_id(),
                message: format!("Crypto error: {}", msg),
            },
        }
    }
}
