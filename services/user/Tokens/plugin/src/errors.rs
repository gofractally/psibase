use crate::bindings::common::plugin::types::{Error, PluginId};

#[derive(PartialEq, Eq, Hash)]
pub enum ErrorType {
    QueryError,
}

fn my_plugin_id() -> PluginId {
    return PluginId {
        service: "tokens".to_string(),
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
        }
    }
}
