#[allow(warnings)]
mod bindings;

use bindings::exports::test::comp_c::api::Guest;

struct Component;

impl Guest for Component {
    fn add(a: i32, b: i32) -> i32 {
        a + b
    }
}

bindings::export!(Component with_types_in bindings);
