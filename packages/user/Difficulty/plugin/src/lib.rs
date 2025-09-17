#[allow(warnings)]
mod bindings;

use bindings::exports::difficulty::plugin::api::Guest as Api;
use bindings::host::types::types::Error;

use psibase::define_trust;

mod errors;

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

struct DifficultyPlugin;

impl Api for DifficultyPlugin {
    fn create(thing: String) -> Result<(), Error> {
        trust::assert_authorized(trust::FunctionName::set_example_thing)?;
        Ok(())
    }
}

bindings::export!(DifficultyPlugin with_types_in bindings);
