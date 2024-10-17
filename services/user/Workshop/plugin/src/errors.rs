use crate::bindings::host::common::types::{Error, PluginId};

#[derive(PartialEq, Eq, Hash)]
pub enum ErrorType {
    QueryError,
    NotFound,
}

fn my_plugin_id() -> PluginId {
    return PluginId {
        service: "workshop".to_string(),
        plugin: "plugin".to_string(),
    };
}

impl ErrorType {
    pub fn err(self, msg: &str) -> Error {
        match self {
            ErrorType::QueryError => Error {
                code: self as u32,
                producer: my_plugin_id(),
                message: format!("Failed to post graphql query: {}", msg),
            },
            ErrorType::NotFound => Error {
                code: 404,
                producer: my_plugin_id(),
                message: msg.into(),
            },
        }
    }
}
