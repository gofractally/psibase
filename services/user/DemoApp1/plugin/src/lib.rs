mod bindings;

use bindings::component::demoapp1::imports;
use bindings::Guest;

struct Component;

impl Guest for Component {
    /// Say hello!
    fn helloworld() -> String {
        // let derp = imports::transfer();
        let mate = imports::callintoplugin();
        format!("mate is... {}", mate)
    }
}
