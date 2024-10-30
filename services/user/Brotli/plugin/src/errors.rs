use crate::bindings::host::common::types::{Error, PluginId};
use psibase::services::psi_brotli;

#[derive(PartialEq, Eq, Hash)]
pub enum ErrorType {
    InvalidQuality,
}

fn my_plugin_id() -> PluginId {
    return PluginId {
        service: psi_brotli::SERVICE.to_string(),
        plugin: "plugin".to_string(),
    };
}

impl ErrorType {
    pub fn err(self, msg: &str) -> Error {
        match self {
            ErrorType::InvalidQuality => Error {
                code: self as u32,
                producer: my_plugin_id(),
                message: format!("Invalid quality: {}", msg),
            },
        }
    }
}
