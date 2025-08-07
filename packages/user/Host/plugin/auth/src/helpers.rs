use crate::bindings::host::common::admin as Admin;

pub fn check_caller(allowed: &[&str], context: &str) {
    let app = Admin::get_active_app();
    if !allowed.contains(&app.as_str()) {
        panic!("[{}] Unauthorized caller: {}", context, app);
    }
}
