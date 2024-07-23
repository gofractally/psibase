use crate::bindings::common::plugin::types::{Error, PluginId};

#[derive(PartialEq, Eq, Hash)]
pub enum ErrorType {
    InvalidClaim,
}

fn my_plugin_id() -> PluginId {
    return PluginId {
        service: "identity".to_string(),
        plugin: "plugin".to_string(),
    };
}

impl ErrorType {
    pub fn err(self, msg: &str) -> Error {
        match self {
            ErrorType::InvalidClaim => Error {
                code: self as u32,
                producer: my_plugin_id(),
                message: format!("Invalid Confidence (must be between 0.0 and 1.0): {}", msg),
            },
        }
    }
}
