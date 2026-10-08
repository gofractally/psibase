use crate::bindings::host::client::api::{get_active_app, get_sender};
use crate::bindings::host::types::types::Error;
use crate::errors::ErrorType::Unauthorized;
use crate::HOST_APP;

pub fn check_caller(allowed: &[&str], context: &str) {
    let app = get_sender();
    if !allowed.contains(&app.as_str()) {
        panic!("[{}] Unauthorized caller: {}", context, app);
    }
}

pub fn check_host_admin(context: &str) {
    check_caller(&[HOST_APP], context);
}

pub fn check_accounts_host_admin(context: &str) {
    check_caller(&["accounts", HOST_APP], context);
}

/// Returns the top-level app if the caller is the top-level app or one of `privileged_apps`.
pub fn get_assert_top_level_app(context: &str, privileged_apps: &[&str]) -> Result<String, Error> {
    let sender = get_sender();
    let top_level_app = get_active_app();

    if sender == top_level_app || privileged_apps.contains(&sender.as_str()) {
        return Ok(top_level_app);
    }

    Err(Unauthorized(&format!(
        "{} can only be called by the top-level app.",
        context
    ))
    .into())
}
