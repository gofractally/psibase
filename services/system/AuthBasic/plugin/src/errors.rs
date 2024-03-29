use crate::bindings::common::plugin::types::{Error, PluginId};

#[derive(PartialEq, Eq, Hash)]
pub enum ErrorType {
    NotYetImplemented,
}

fn my_plugin_id() -> PluginId {
    return PluginId {
        service: "auth-basic".to_string(),
        plugin: "plugin".to_string(),
    };
}

impl ErrorType {
    pub fn err(self) -> Error {
        match self {
            ErrorType::NotYetImplemented => Error {
                code: self as u32,
                producer: my_plugin_id(),
                message: "Not yet implemented".to_string(),
            },
        }
    }
}
