use crate::bindings::host::common::client::{get_active_app, get_sender};

pub fn check_caller(allowed: &[&str], context: &str) {
    let app = get_sender();
    if !allowed.contains(&app.as_str()) {
        panic!("[{}] Unauthorized caller: {}", context, app);
    }
}

pub fn check_caller_or_active_app(app: &str, allowed: &[&str], context: &str) {
    let caller = get_sender();
    if caller == app || allowed.contains(&caller.as_str()) {
        return;
    }

    let active_app = get_active_app();
    if active_app == app && caller == active_app {
        return;
    }

    panic!("[{}] Unauthorized caller: {}", context, caller);
}
