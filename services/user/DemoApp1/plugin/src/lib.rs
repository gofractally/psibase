mod bindings;

use bindings::component::demoapp1::demoapp2;
use bindings::Guest;

struct Component;

impl Guest for Component {
    fn helloworld() -> String {
        let barry = demoapp2::callintoplugin();
        format!("barry is {}", barry)
    }
}
