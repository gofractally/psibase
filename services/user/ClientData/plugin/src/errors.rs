use crate::bindings::host::common::types::{Error, PluginId};

#[derive(PartialEq, Eq, Hash)]
pub enum ErrorType {
    InvalidSender,
    KvError,
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
            ErrorType::InvalidSender => Error {
                code: self as u32,
                producer: my_plugin_id(),
                message: format!(
                    "Only plugins can use the ClientStorage interface. Invalid sender: {}",
                    msg
                ),
            },
            ErrorType::KvError => Error {
                code: self as u32,
                producer: my_plugin_id(),
                message: format!("Key-Value Error: {}", msg),
            },
            ErrorType::EmptyValue => Error {
                code: self as u32,
                producer: my_plugin_id(),
                message: format!("Cannot add empty value for key: {}", msg),
            },
        }
    }
}
