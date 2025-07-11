use crate::exports::host::common::types::{Error, PluginId};
use crate::supervisor::bridge::intf as Supervisor;
use crate::supervisor::bridge::types::Header;

pub fn make_error(message: &str) -> Error {
    Error {
        code: 0,
        producer: PluginId {
            service: "host".to_string(),
            plugin: "common".to_string(),
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

pub fn caller() -> String {
    let stack = get_callstack();
    assert!(stack.len() > 0);
    stack.last().unwrap().clone()
}

pub fn get_callstack() -> Vec<String> {
    // the last element is always this plugin, so we can pop it
    // We are interested in the callstack before this call
    let mut stack = Supervisor::service_stack();
    stack.pop();
    stack
}
