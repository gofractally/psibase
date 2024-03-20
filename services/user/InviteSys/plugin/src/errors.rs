use crate::bindings::common::plugin::types::{Error, PluginId};

#[derive(PartialEq, Eq, Hash)]
pub enum ErrorType {
    InviterLoggedIn,
    PubKeyParse,
}

fn my_plugin_id() -> PluginId {
    return PluginId {
        service: "invite-sys".to_string(),
        plugin: "plugin".to_string(),
    };
}

impl ErrorType {
    pub fn err(self) -> Error {
        match self {
            ErrorType::InviterLoggedIn => Error {
                code: self as u32,
                producer: my_plugin_id(),
                message: "Inviter must be logged in".to_string(),
            },
            ErrorType::PubKeyParse => Error {
                code: self as u32,
                producer: my_plugin_id(),
                message: "Failed to parse pubkey".to_string(),
            },
        }
    }
}
