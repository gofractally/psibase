mod bindings;

use bindings::Guest;

struct Component;

impl Guest for Component {
    /// Say hello!
    fn helloworld() -> String {
        "Hello, World!".to_string()
    }
}
