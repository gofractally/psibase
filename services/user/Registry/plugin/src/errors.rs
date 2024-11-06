use crate::bindings::host::common::types::{Error, PluginId};

#[derive(PartialEq, Eq, Hash)]
pub enum ErrorType {
    QueryError,
    NotFound,
    QueryDeserializeError,
}

fn my_plugin_id() -> PluginId {
    return PluginId {
        service: "registry".to_string(),
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
            ErrorType::QueryDeserializeError => Error {
                code: self as u32,
                producer: my_plugin_id(),
                message: format!("Failed to deserialize graphql query response: {}", msg),
            },
            ErrorType::NotFound => Error {
                code: 404,
                producer: my_plugin_id(),
                message: msg.into(),
            },
        }
    }
}
