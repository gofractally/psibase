#[allow(warnings)]
mod bindings;

use bindings::exports::auth_dyn::plugin::api::Guest as Api;
use bindings::host::types::types::Error;
use bindings::transact::plugin::intf::add_action_to_transaction;

use psibase::define_trust;
use psibase::fracpack::Pack;

define_trust! {
    descriptions {
        Low => "",
        Medium => "",
        High => "🚨 WARNING 🚨
This approval allows the caller to change your account's policy service, which could be abused to control your account! Make sure you completely trust the caller's legitimacy.",
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
            account: account.parse().unwrap(),
            manager: manager.parse().unwrap(),
        }
        .packed();

        add_action_to_transaction(
            auth_dyn::action_structs::set_mgmt::ACTION_NAME,
            &packed_args,
        )
    }
}

bindings::export!(AuthDynPlugin with_types_in bindings);
