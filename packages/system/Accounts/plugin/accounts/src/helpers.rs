use crate::bindings::host::common::admin as Privileged;
use crate::bindings::host::common::client as Client;
use crate::bindings::host::types::types as CommonTypes;
use crate::errors::ErrorType::*;

/// Asserts that the caller of the current plugin function is the top-level app,
///    or one of the privileged apps.
/// Returns the top-level app data.
pub fn get_assert_top_level_app(
    context: &str,
    privileged_apps: &[&str],
) -> Result<String, CommonTypes::Error> {
    let sender_app_name = Client::get_sender();
    let top_level_app = Privileged::get_active_app();

    let is_privileged = privileged_apps.contains(&sender_app_name.as_str());

    if is_privileged {
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
