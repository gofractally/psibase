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
        High => "Set the policy service for an account",
    }
    functions {
        Low => [],
        High => [set_policy],
    }
}

struct AuthDynPlugin;

impl Api for AuthDynPlugin {
    fn set_policy(account: String, policy: String) -> Result<(), Error> {
        trust::assert_authorized(trust::FunctionName::set_policy)?;
        let packed_example_thing_args = auth_dyn::action_structs::set_policy {
            account: account.as_str().into(),
            policy: policy.as_str().into(),
        }
        .packed();
        add_action_to_transaction(
            auth_dyn::action_structs::set_policy::ACTION_NAME,
            &packed_example_thing_args,
        )
    }
}

bindings::export!(AuthDynPlugin with_types_in bindings);
