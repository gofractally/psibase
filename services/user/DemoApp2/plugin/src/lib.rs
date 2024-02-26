mod bindings;

use bindings::component::demoapp2::imports;
// use bindings::component::demoapp2::types::Funccallparams;

use bindings::Guest;

struct Component;

impl Guest for Component {
    fn derpy() -> String {
        "derpy".to_string()
    }
}
