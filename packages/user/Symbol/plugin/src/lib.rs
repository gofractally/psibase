#[allow(warnings)]
mod bindings;

use bindings::exports::symbol::plugin::api::Guest as Api;
use bindings::host::common::server as CommonServer;
use bindings::host::types::types::Error;
use bindings::transact::plugin::intf::add_action_to_transaction;

use psibase::fracpack::Pack;
use psibase::{define_trust, AccountNumber};

mod errors;
use errors::ErrorType;

define_trust! {
    descriptions {
        Low => "
        Low trust grants these abilities:
            - Reading the value of the example-thing
        ",
        Medium => "",
        High => "
        High trust grants the abilities of all lower trust levels, plus these abilities:
            - Setting the example thing
        ",
    }
    functions {
        Low => [get_example_thing],
        High => [set_example_thing],
    }
}

struct SymbolPlugin;

impl Api for SymbolPlugin {
    fn purchase(symbol: String) -> Result<(), Error> {
        trust::assert_authorized(trust::FunctionName::set_example_thing)?;
        let packed_example_thing_args = symbol::action_structs::purchase {
            symbol: AccountNumber::from(symbol.as_str()),
        }
        .packed();
        add_action_to_transaction(
            symbol::action_structs::purchase::ACTION_NAME,
            &packed_example_thing_args,
        )
        .unwrap();
        Ok(())
    }
}

bindings::export!(SymbolPlugin with_types_in bindings);
