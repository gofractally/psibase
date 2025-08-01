use crate::supervisor::bridge::intf as Supervisor;

pub fn caller() -> String {
    let stack = get_callstack();
    assert!(stack.len() > 0);
    stack.last().unwrap().clone()
}

pub fn get_callstack() -> Vec<String> {
    // the last element is always this plugin, so we can pop it
    // We are interested in the callstack before this call
    let mut stack = Supervisor::service_stack();
    stack.pop();
    stack
}

pub fn check_caller(allowed: &[&str], context: &str) {
    let app = caller();
    if !allowed.contains(&app.as_str()) {
        panic!("[{}] Unauthorized caller: {}", context, app);
    }
}
