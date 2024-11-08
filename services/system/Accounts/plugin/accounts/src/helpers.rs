use crate::bindings::accounts::plugin::types::AppDetails;
use crate::bindings::host::common::{client as Client, types as CommonTypes};
use crate::bindings::host::privileged::intf as Privileged;
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

    if sender.app.is_some() && privileged_apps.contains(&sender.app.as_ref().unwrap().as_str()) {
        return Ok(top_level_app);
    }

    if sender.origin != top_level_app.origin {
        return Err(Unauthorized(&format!(
            "{} can only be called by the top-level app",
            context
        ))
        .into());
    }

    Ok(top_level_app)
}
