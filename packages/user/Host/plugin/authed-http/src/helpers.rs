use crate::host::types::types::{Error, PluginId};
use crate::supervisor::bridge::types::Header;

pub fn make_error(message: &str) -> Error {
    Error {
        code: 0,
        producer: PluginId {
            service: "host".to_string(),
            plugin: "authed-http".to_string(),
        },
        message: message.to_string(),
    }
}

pub fn normalize_endpoint(endpoint: String) -> String {
    endpoint.strip_prefix('/').unwrap_or(&endpoint).to_string()
}

pub fn make_headers(headers: &[(&str, &str)]) -> Vec<Header> {
    headers
        .iter()
        .map(|(key, value)| Header {
            key: key.to_string(),
            value: value.to_string(),
        })
        .collect()
}
