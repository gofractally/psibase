#[allow(warnings)]
mod bindings;

use bindings::common::plugin::{server, types as CommonTypes};
use bindings::exports::demoapp1::example::intf::Guest as Intf;
use bindings::invite;
use bindings::Guest as MainInterface;

use psibase::fracpack::Pack;
use psibase::services::demoapp1 as app_1;

struct Component;

impl MainInterface for Component {
    fn helloworld() -> String {
        "Hello world".to_string()
    }
}

impl Intf for Component {
    fn helloworld2() -> Result<String, CommonTypes::Error> {
        Ok(invite::plugin::inviter::generate_invite("/subpath")?)
    }

    fn multipli(a: u32, b: u32) -> String {
        let res = server::add_action_to_transaction(
            "multiply",
            &app_1::action_structs::multiply {
                a: a as i32,
                b: b as i32,
            }
            .packed(),
        );

        format!("Mutliply res is {:?}", res)
    }
}

bindings::export!(Component with_types_in bindings);
