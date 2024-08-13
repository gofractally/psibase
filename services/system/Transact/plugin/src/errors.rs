use crate::bindings::host::common::types::{Error, PluginId};

#[derive(PartialEq, Eq, Hash)]
pub enum ErrorType {
    Unauthorized,
    OnlyAvailableToPlugins,
    InvalidActionName,
    NotLoggedIn,
    TransactionError,
}

fn my_plugin_id() -> PluginId {
    return PluginId {
        service: "transact".to_string(),
        plugin: "plugin".to_string(),
    };
}

impl ErrorType {
    pub fn err(self, msg: &str) -> Error {
        match self {
            ErrorType::Unauthorized => Error {
                code: self as u32,
                producer: my_plugin_id(),
                message: format!("Unauthorized access: {}", msg),
            },
            ErrorType::OnlyAvailableToPlugins => Error {
                code: self as u32,
                producer: my_plugin_id(),
                message: format!("This functionality is only available to plugins: {}", msg),
            },
            ErrorType::InvalidActionName => Error {
                code: self as u32,
                producer: my_plugin_id(),
                message: format!("Invalid action name: {}", msg),
            },
            ErrorType::NotLoggedIn => Error {
                code: self as u32,
                producer: my_plugin_id(),
                message: format!("Requires a logged-in user: {}", msg),
            },
            ErrorType::TransactionError => Error {
                code: self as u32,
                producer: my_plugin_id(),
                message: format!("Transaction error: {}", msg),
            },
        }
    }
}
