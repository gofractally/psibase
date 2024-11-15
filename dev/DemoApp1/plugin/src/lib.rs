#[allow(warnings)]
mod bindings;

use bindings::exports::demoapp1::example::intf::Guest as Intf;
use bindings::host::common::types as CommonTypes;
use bindings::invite;
use bindings::transact::plugin::intf as Transact;
use bindings::Guest as MainInterface;

use psibase::fracpack::Pack;
use service::action_structs;

struct Component;

impl MainInterface for Component {
    fn helloworld() -> String {
        "Hello world".to_string()
    }
}

impl Intf for Component {
    fn helloworld2() -> Result<String, CommonTypes::Error> {
        Ok(invite::plugin::inviter::generate_invite()?)
    }

    fn multiply(a: u32, b: u32) -> Result<String, CommonTypes::Error> {
        let res = Transact::add_action_to_transaction(
            "multiply",
            &action_structs::multiply { a, b }.packed(),
        );

        Ok(format!("Mutliply res is {:?}", res))
    }
}

bindings::export!(Component with_types_in bindings);
