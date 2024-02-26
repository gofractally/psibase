mod bindings;

use bindings::component::demoapp1::demoapp2;
use bindings::Guest;

struct Component;

impl Guest for Component {
    /// Say hello!
    fn helloworld() -> String {
        let barry = demoapp2::derpy();
        format!("barry is {}", barry)
    }
}
