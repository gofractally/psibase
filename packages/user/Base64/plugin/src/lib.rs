#[allow(warnings)]
mod bindings;
use bindings::*;

use base64::{
    engine::general_purpose::{STANDARD, URL_SAFE},
    Engine,
};
use exports::base64::plugin::standard::Guest as Standard;
use exports::base64::plugin::url::Guest as Url;
use host::types::types::{Error, PluginId};

struct Base64Plugin;

impl From<String> for Error {
    fn from(value: String) -> Self {
        Error {
            code: 0,
            producer: PluginId {
                service: "base64".to_string(),
                plugin: "plugin".to_string(),
            },
            message: value,
        }
    }
}

impl Url for Base64Plugin {
    fn encode(input: Vec<u8>) -> String {
        URL_SAFE.encode(input)
    }

    fn decode(input: String) -> Result<Vec<u8>, Error> {
        URL_SAFE
            .decode(input)
            .map_err(|e| Error::from(e.to_string()))
    }
}

impl Standard for Base64Plugin {
    fn encode(input: Vec<u8>) -> String {
        STANDARD.encode(input)
    }

    fn decode(input: String) -> Result<Vec<u8>, Error> {
        STANDARD
            .decode(input)
            .map_err(|e| Error::from(e.to_string()))
    }
}

bindings::export!(Base64Plugin with_types_in bindings);
