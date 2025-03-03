#[allow(warnings)]
mod bindings;

use bindings::exports::{{project-name | snake_case}}::plugin::api::Guest as Api;
use bindings::exports::{{project-name | snake_case}}::plugin::queries::Guest as Queries;
use bindings::host::common::server as CommonServer;
use bindings::host::common::types::Error;
use bindings::transact::plugin::intf::add_action_to_transaction;

use psibase::fracpack::Pack;

mod errors;
use errors::ErrorType;

struct {{project-name | upper_camel_case}}Plugin;

impl Api for {{project-name | upper_camel_case}}Plugin {
    fn set_example_thing(thing: String) {
        let packed_example_thing_args = {{project-name | snake_case}}::action_structs::setExampleThing { thing }.packed();
        add_action_to_transaction("setExampleThing", &packed_example_thing_args).unwrap();
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

impl Queries for {{project-name | upper_camel_case}}Plugin {
    fn get_example_thing() -> Result<String, Error> {
        let graphql_str = "query { exampleThing }";

        let examplething_val = serde_json::from_str::<ExampleThingResponse>(
            &CommonServer::post_graphql_get_json(&graphql_str)?,
        );

        let examplething_val = examplething_val
            .map_err(|err| ErrorType::QueryResponseParseError(err.to_string()))?;

        Ok(examplething_val.data.example_thing)
    }
}

bindings::export!({{project-name | upper_camel_case}}Plugin with_types_in bindings);
