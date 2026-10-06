use crate::supervisor::callstack::read as Callstack;

pub fn get_callstack() -> Vec<String> {
    // the last element is always this plugin, so we can pop it
    // We are interested in the callstack before this call
    let mut stack = Callstack::service_stack();
    stack.pop();
    stack
}
