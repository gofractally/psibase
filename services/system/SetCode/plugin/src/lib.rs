#[allow(warnings)]
mod bindings;

use accounts::plugin::api::get_current_user;
use bindings::*;
use exports::setcode::plugin::api::Guest as Api;
use psibase::services::setcode::action_structs::setCode;
use psibase::AccountNumber;
use transact::plugin::intf::add_action_to_transaction;

use psibase::fracpack::Pack;

struct SetcodePlugin;

impl Api for SetcodePlugin {
    fn set_service_code(code: Vec<u8>) {
        let Ok(Some(user)) = get_current_user() else {
            panic!("No logged in user");
        };

        add_action_to_transaction(
            setCode::ACTION_NAME,
            &setCode {
                service: AccountNumber::from(user.as_str()),
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
