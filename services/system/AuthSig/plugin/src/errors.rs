use crate::bindings::host::common::types::{Error, PluginId};

#[derive(PartialEq, Eq, Hash)]
pub enum ErrorType {
    CryptoError,
    Unauthorized,
    JsonDecodeError,
    KeyNotFound,
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
            ErrorType::CryptoError => Error {
                code: self as u32,
                producer: my_plugin_id(),
                message: format!("Crypto error: {}", msg),
            },
            ErrorType::Unauthorized => Error {
                code: self as u32,
                producer: my_plugin_id(),
                message: format!("Unauthorized: {}", msg),
            },
            ErrorType::JsonDecodeError => Error {
                code: self as u32,
                producer: my_plugin_id(),
                message: format!("JSON decode error: {}", msg),
            },
            ErrorType::KeyNotFound => Error {
                code: self as u32,
                producer: my_plugin_id(),
                message: format!("Key not found: {}", msg),
            },
        }
    }
}
