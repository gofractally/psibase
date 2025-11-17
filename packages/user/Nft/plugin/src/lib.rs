#[allow(warnings)]
mod bindings;

use bindings::exports::nft::plugin::api::Guest as Api;
use bindings::host::common::server as CommonServer;
use bindings::host::types::types::Error;
// use bindings::transact::plugin::intf::add_action_to_transaction;

use psibase::define_trust;
// use psibase::fracpack::Pack;

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
        Low => [],
        High => [set_example_thing],
    }
}

struct NftPlugin;

impl Api for NftPlugin {
    fn set_example_thing(_thing: String) -> Result<(), Error> {
        Ok(())
    }
}

bindings::export!(NftPlugin with_types_in bindings);
