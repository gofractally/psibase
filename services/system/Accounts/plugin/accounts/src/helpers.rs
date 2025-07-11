use crate::bindings::accounts::plugin::types::AppDetails;
use crate::bindings::host::common::{client as Client, types as CommonTypes};
use crate::bindings::host::privileged::api as Privileged;
use crate::errors::ErrorType::*;

/// Asserts that the caller of the current plugin function is the top-level app,
///    or one of the privileged apps.
/// Returns the top-level app data.
pub fn get_assert_top_level_app(
    context: &str,
    privileged_apps: &[&str],
) -> Result<AppDetails, CommonTypes::Error> {
    let sender = Client::get_sender_app();
    let top_level_app = Privileged::get_active_app();

    if sender.app.is_some() {
        let sender_app_name = sender.app.as_ref().unwrap().as_str();
        let is_privileged = privileged_apps.contains(&sender_app_name);

        if is_privileged {
            return Ok(top_level_app);
        }

        let top_level_app_name = top_level_app.app.as_ref().unwrap().as_str();
        if sender_app_name == top_level_app_name {
            return Ok(top_level_app);
        }
    } else {
        return Err(Unauthorized(&format!(
            "{} can only be called by the top-level app. \nSender app not recognized.",
            context
        ))
        .into());
    }

    return Err(Unauthorized(&format!(
        "{} can only be called by the top-level app. \nSender: {}",
        context,
        sender.app.as_ref().unwrap().as_str()
    ))
    .into());
}
