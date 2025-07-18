use crate::bindings::host::common::admin as Privileged;
use crate::bindings::host::common::{client as Client, types as CommonTypes};
use crate::errors::ErrorType::*;

/// Asserts that the caller of the current plugin function is the top-level app,
///    or one of the privileged apps.
/// Returns the top-level app data.
pub fn get_assert_top_level_app(
    context: &str,
    privileged_apps: &[&str],
) -> Result<String, CommonTypes::Error> {
    let sender = Client::get_sender_app();
    let top_level_app = Privileged::get_active_app();

    if sender.app.is_some() {
        let sender_app_name = sender.app.as_ref().unwrap().as_str();
        let is_privileged = privileged_apps.contains(&sender_app_name);

        let top_level_app_name = top_level_app.app.as_ref().unwrap().as_str();
        if is_privileged {
            return Ok(top_level_app_name.to_string());
        }

        if sender_app_name == top_level_app_name {
            return Ok(top_level_app_name.to_string());
        }
    } else {
        return Err(Unauthorized(&format!(
            "{} can only be called by the top-level app. \nSender app not recognized.",
            context
        ))
        .into());
    }

    return Err(Unauthorized(&format!(
        "{} can only be called by the top-level app.",
        context
    ))
    .into());
}
