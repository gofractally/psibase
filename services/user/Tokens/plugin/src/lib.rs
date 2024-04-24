#[allow(warnings)]
mod bindings;

use bindings::common::plugin::{server, types as CommonTypes};
use bindings::Guest as MainInterface;

struct Component;

use psibase::fracpack::Pack;

impl MainInterface for Component {
    /// Say hello!
    fn hello_world() -> String {
        "Hello, World!".to_string()
    }
}

bindings::export!(Component with_types_in bindings);
