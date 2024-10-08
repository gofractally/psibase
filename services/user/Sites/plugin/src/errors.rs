use crate::bindings::host::common::types::{Error, PluginId};

#[derive(PartialEq, Eq, Hash)]
pub enum ErrorType {
    FileTooLarge,
}

fn my_plugin_id() -> PluginId {
    PluginId {
        service: "sites".to_string(),
        plugin: "plugin".to_string(),
    }
}

impl ErrorType {
    pub fn err(self, msg: &str) -> Error {
        match self {
            ErrorType::FileTooLarge => Error {
                code: self as u32,
                producer: my_plugin_id(),
                message: format!("File too large: {}", msg),
            },
        }
    }
}
