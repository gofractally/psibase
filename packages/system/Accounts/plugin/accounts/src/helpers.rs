use crate::bindings::host::common::admin as Privileged;
use crate::bindings::host::common::client as Client;
use crate::bindings::host::types::types as CommonTypes;
use crate::errors::ErrorType::*;

/// Asserts that the caller of the current plugin function is the top-level app,
///    or the host
/// Returns the top-level app data.
pub fn get_assert_top_level_app(context: &str) -> Result<String, CommonTypes::Error> {
    let sender_app_name = Client::get_sender();
    let top_level_app = Privileged::get_active_app();
    let is_host = Client::is_sender_host();

    if is_host {
        return Ok(top_level_app);
    }

    if sender_app_name == top_level_app {
        return Ok(top_level_app);
    }

    return Err(Unauthorized(&format!(
        "{} can only be called by the top-level app.",
        context
    ))
    .into());
}
