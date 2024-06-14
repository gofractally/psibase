cargo_component_bindings::generate!();
use bindings::component::wasm1::types::Numbers;

use bindings::Guest;

struct Component;

impl Guest for Component {
    fn sum(numbers: Numbers) -> i32 {
        numbers.num_a + numbers.num_b
    }

    fn multiply(numbers: Numbers) -> i32 {
        numbers.num_a * numbers.num_b
    }
}
