mod bindings;

use bindings::component::demoapp2::imports;
// use bindings::component::demoapp2::types::Funccallparams;

use bindings::Guest;

struct Component;

impl Guest for Component {
    fn callintoplugin() -> String {
        format!("callintoplugin return from demoapp2")
    }
}
