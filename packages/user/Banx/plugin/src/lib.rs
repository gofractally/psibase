#[allow(warnings)]
mod bindings;

use bindings::exports::banx::plugin::api::Guest as Api;
use bindings::exports::banx::plugin::queries::Guest as Queries;
use bindings::host::types::types::Error;

use psibase::define_trust;

mod errors;

define_trust! {
    descriptions {
        Low => "
            - Reading Banx state
        ",
        Medium => "",
        High => "
            - Mutating Banx credit graph
        ",
    }
    functions {
        Low => [get_example_thing],
        High => [set_example_thing],
    }
}

struct BanxPlugin;

// Placeholder exports until the plugin WIT is updated for Banx actions.
impl Api for BanxPlugin {
    fn set_example_thing(_thing: String) -> Result<(), Error> {
        trust::assert_authorized(trust::FunctionName::set_example_thing)?;
        Ok(())
    }
}

impl Queries for BanxPlugin {
    fn get_example_thing() -> Result<String, Error> {
        trust::assert_authorized(trust::FunctionName::get_example_thing)?;
        Ok(String::new())
    }
}

bindings::export!(BanxPlugin with_types_in bindings);
