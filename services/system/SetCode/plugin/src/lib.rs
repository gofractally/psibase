#[allow(warnings)]
mod bindings;

use bindings::exports::setcode::plugin::api::Guest as Api;
use bindings::transact::plugin::intf::add_action_to_transaction;
use psibase::services::setcode::action_structs::setMyCode;

use psibase::fracpack::Pack;

struct SetcodePlugin;

impl Api for SetcodePlugin {
    fn set_service_code(code: Vec<u8>) {
        add_action_to_transaction(
            "setMyCode",
            &setMyCode {
                vmType: 0,
                vmVersion: 0,
                code: code.into(),
            }
            .packed(),
        )
        .unwrap();
    }
}
bindings::export!(SetcodePlugin with_types_in bindings);
