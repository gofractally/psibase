use crate::supervisor::bridge::intf as Supervisor;

pub fn get_callstack() -> Vec<String> {
    // the last element is always this plugin, so we can pop it
    // We are interested in the callstack before this call
    let mut stack = Supervisor::service_stack();
    stack.pop();
    stack
}
