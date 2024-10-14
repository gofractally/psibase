use crate::bindings::host::common::types::{Error, PluginId};

#[derive(PartialEq, Eq, Hash)]
pub enum ErrorType {
    Unauthorized,
    MissingInviteToken,
    DecodeInviteError,
}

fn my_plugin_id() -> PluginId {
    return PluginId {
        service: "auth-invite".to_string(),
        plugin: "plugin".to_string(),
    };
}

impl ErrorType {
    pub fn err(self, msg: &str) -> Error {
        match self {
            ErrorType::Unauthorized => Error {
                code: self as u32,
                producer: my_plugin_id(),
                message: format!("Unauthorized: {}", msg),
            },
            ErrorType::MissingInviteToken => Error {
                code: self as u32,
                producer: my_plugin_id(),
                message: format!("Missing invite token: {}", msg),
            },
            ErrorType::DecodeInviteError => Error {
                code: self as u32,
                producer: my_plugin_id(),
                message: format!("Decode invite error: {}", msg),
            },
        }
    }
}
