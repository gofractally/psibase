use crate::bindings::host::common::types::{Error, PluginId};

#[derive(PartialEq, Eq, Hash)]
pub enum ErrorType {
    EmptyValue,
}

fn my_plugin_id() -> PluginId {
    return PluginId {
        service: "clientdata".to_string(),
        plugin: "api".to_string(),
    };
}

impl ErrorType {
    pub fn err(self, msg: &str) -> Error {
        match self {
            ErrorType::EmptyValue => Error {
                code: self as u32,
                producer: my_plugin_id(),
                message: format!("Cannot add empty value for key: {}", msg),
            },
        }
    }
}
