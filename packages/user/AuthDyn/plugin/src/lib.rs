#[allow(warnings)]
mod bindings;

use bindings::exports::auth_dyn::plugin::api::Guest as Api;
use bindings::host::types::types::Error;
use bindings::transact::plugin::intf::add_action_to_transaction;

use psibase::define_trust;
use psibase::fracpack::Pack;

mod errors;

define_trust! {
    descriptions {
        Low => "",
        Medium => "",
        High => "Set the manager service for an account",
    }
    functions {
        High => [set_management],
    }
}

struct AuthDynPlugin;

impl Api for AuthDynPlugin {
    fn set_management(account: String, manager: String) -> Result<(), Error> {
        trust::assert_authorized(trust::FunctionName::set_management)?;

        let packed_args = auth_dyn::action_structs::set_mgmt {
            account: account.as_str().into(),
            manager: manager.as_str().into(),
        }
        .packed();

        add_action_to_transaction(
            auth_dyn::action_structs::set_mgmt::ACTION_NAME,
            &packed_args,
        )
    }
}

bindings::export!(AuthDynPlugin with_types_in bindings);
