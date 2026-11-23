//! Source-compatible entry points, all using the single action-name codec.
use crate::{action_name_from_str, action_name_to_string};

/// Encode a valid identifier. Untrusted text should use `action_name_from_str`
/// and handle its error rather than this programmer-facing shortcut.
pub fn method_number_from_str(name: &str) -> u64 {
    action_name_from_str(name).expect("invalid action name")
}

/// Render an ID. Invalid raw values use a diagnostic spelling; strict callers
/// should use `action_name_to_string`, which returns an error for these values.
pub fn method_number_to_string(value: u64) -> String {
    action_name_to_string(value).unwrap_or_else(|_| format!("<invalid-action-name:{value:016x}>"))
}
