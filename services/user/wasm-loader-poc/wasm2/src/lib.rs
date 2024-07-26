cargo_component_bindings::generate!();
use bindings::component::wasm2::types::Numbers;

use bindings::Guest;

struct Component;

impl Guest for Component {
    fn sub(numbers: Numbers) -> i32 {
        numbers.num_a - numbers.num_b
    }

    fn divide(numbers: Numbers) -> i32 {
        if numbers.num_b != 0 { numbers.num_a / numbers.num_b } else { 0 } // Handle division by zero
    }
}
