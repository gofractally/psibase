use crate::bindings::host::common::types::{Error, PluginId};

#[derive(PartialEq, Eq, Hash)]
pub enum ErrorType {
    QueryResponseParseError,
    InvalidMsgId,
    ParseError,
}

fn my_plugin_id() -> PluginId {
    return PluginId {
        service: "chainmail".to_string(),
        plugin: "plugin".to_string(),
    };
}

impl ErrorType {
    pub fn err(self, msg: &str) -> Error {
        match self {
            ErrorType::QueryResponseParseError => Error {
                code: self as u32,
                producer: my_plugin_id(),
                message: format!("Query response parsing error: {}", msg),
            },
            ErrorType::InvalidMsgId => Error {
                code: self as u32,
                producer: my_plugin_id(),
                message: format!("No message found with msg_id {}", msg),
            },
            ErrorType::ParseError => Error {
                code: self as u32,
                producer: my_plugin_id(),
                message: format!("Prase error {}", msg),
            },
        }
    }
}
