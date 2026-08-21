#[allow(warnings)]
mod bindings;

use std::sync::Mutex;

use bindings::exports::supervisor::callstack::callstack::Guest;

static STACK: Mutex<Vec<String>> = Mutex::new(Vec::new());

struct HostCallstack;

impl Guest for HostCallstack {
    fn push(service: String) {
        STACK.lock().unwrap().push(service);
    }

    fn pop() {
        STACK.lock().unwrap().pop();
    }

    fn service_stack() -> Vec<String> {
        STACK.lock().unwrap().clone()
    }

    fn reset() {
        STACK.lock().unwrap().clear();
    }
}

bindings::export!(HostCallstack with_types_in bindings);
