#[allow(warnings)]
mod bindings;

use bindings::exports::test::comp_b::api::Guest;
use bindings::test::comp_c::api as comp_c;

struct Component;

impl Guest for Component {
    fn double_add(a: i32, b: i32) -> i32 {
        let sum = comp_c::add(a, b);
        sum * 2
    }
}

bindings::export!(Component with_types_in bindings);
