#[allow(warnings)]
mod bindings;

use bindings::common::plugin::types as CommonTypes;
use bindings::exports::demoapp1::example::intf::Guest as Intf;
use bindings::invite_sys;
use bindings::Guest as MainInterface;

struct Component;

impl MainInterface for Component {
    fn helloworld() -> String {
        "Hello world".to_string()
    }
}

impl Intf for Component {
    fn helloworld2() -> Result<String, CommonTypes::Error> {
        Ok(invite_sys::plugin::inviter::generate_invite("/subpath")?)
    }
}

bindings::export!(Component with_types_in bindings);
