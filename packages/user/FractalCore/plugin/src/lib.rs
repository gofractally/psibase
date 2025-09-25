#[allow(warnings)]
mod bindings;

use bindings::exports::fractal_core::plugin::api::Guest as Api;
use bindings::exports::fractal_core::plugin::queries::Guest as Queries;
use bindings::host::common::server as CommonServer;
use bindings::host::types::types::Error;
use bindings::transact::plugin::intf::add_action_to_transaction;

use psibase::define_trust;
use psibase::fracpack::Pack;

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

struct FractalCorePlugin;

impl Api for FractalCorePlugin {
    fn set_example_thing(thing: String) -> Result<(), Error> {
        trust::assert_authorized(trust::FunctionName::set_example_thing)?;
        let packed_example_thing_args = fractal_core::action_structs::setExampleThing { thing }.packed();
        add_action_to_transaction("setExampleThing", &packed_example_thing_args).unwrap();
        Ok(())
    }
}

#[derive(serde::Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
struct ExampleThingData {
    example_thing: String,
}
#[derive(serde::Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
struct ExampleThingResponse {
    data: ExampleThingData,
}

impl Queries for FractalCorePlugin {
    fn get_example_thing() -> Result<String, Error> {
        trust::assert_authorized(trust::FunctionName::get_example_thing)?;

        let graphql_str = "query { exampleThing }";

        let examplething_val = serde_json::from_str::<ExampleThingResponse>(
            &CommonServer::post_graphql_get_json(&graphql_str)?,
        );

        let examplething_val = 
            examplething_val.map_err(|err| ErrorType::QueryResponseParseError(err.to_string()))?;

        Ok(examplething_val.data.example_thing)
    }
}

bindings::export!(FractalCorePlugin with_types_in bindings);
