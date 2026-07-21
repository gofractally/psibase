use crate::bindings::host::common::client::get_sender;

pub fn check_caller(allowed: &[&str], context: &str) {
    let app = get_sender();
    if !allowed.contains(&app.as_str()) {
        panic!("[{}] Unauthorized caller: {}", context, app);
    }
}

/// Privileged callers, or Homepage fetching only its own token.
pub fn check_get_active_query_token_caller(app: &str, context: &str) {
    let caller = get_sender();
    if caller == "host" || caller == "supervisor" {
        return;
    }
    if caller == "homepage" && app == "homepage" {
        return;
    }

    panic!("[{}] Unauthorized caller: {}", context, caller);
}
