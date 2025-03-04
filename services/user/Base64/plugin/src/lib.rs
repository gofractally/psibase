#[allow(warnings)]
mod bindings;
use bindings::*;

use base64::{engine::general_purpose::URL_SAFE, Engine};
use exports::base64::plugin::api::Guest as Api;
use host::common::types::{Error, PluginId};

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

impl Api for Base64Plugin {
    fn encode(input: Vec<u8>) -> String {
        URL_SAFE.encode(input)
    }

    fn decode(input: String) -> Result<Vec<u8>, Error> {
        URL_SAFE
            .decode(input)
            .map_err(|e| Error::from(e.to_string()))
    }
}

bindings::export!(Base64Plugin with_types_in bindings);
