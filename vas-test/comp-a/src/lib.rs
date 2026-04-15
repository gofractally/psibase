#[allow(warnings)]
mod bindings;

use bindings::exports::test::comp_a::api::Guest;
use bindings::test::comp_b::api as comp_b;

struct Component;

impl Guest for Component {
    fn compute(x: i32) -> i32 {
        comp_b::double_add(x, x + 1)
    }
}

bindings::export!(Component with_types_in bindings);
