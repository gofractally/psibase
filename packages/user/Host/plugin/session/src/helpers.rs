use crate::bindings::host::call_context::api::get_sender;

pub fn check_caller(allowed: &[&str], context: &str) {
    let app = get_sender();
    if !allowed.contains(&app.as_str()) {
        panic!("[{}] Unauthorized caller: {}", context, app);
    }
}
