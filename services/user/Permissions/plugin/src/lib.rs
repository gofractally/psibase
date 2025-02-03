#[allow(warnings)]
mod bindings;

use bindings::exports::permissions::plugin::api::Guest as Api;
use bindings::exports::permissions::plugin::queries::Guest as Queries;
use bindings::host::common::server as CommonServer;
use bindings::host::common::types::Error;
use bindings::transact::plugin::intf::add_action_to_transaction;

use psibase::fracpack::Pack;

mod errors;
use errors::ErrorType;

struct PermissionsPlugin;

impl Api for PermissionsPlugin {
    fn set_example_thing(thing: String) {
        let packed_example_thing_args =
            permissions::action_structs::setExampleThing { thing }.packed();
        add_action_to_transaction("setExampleThing", &packed_example_thing_args).unwrap();
    }
    fn save_permission(caller: String, callee: String, remember: bool) {
        // verify caller == permissions.psibase.io
        // save to local storage
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

impl Queries for PermissionsPlugin {
    fn get_example_thing() -> Result<String, Error> {
        let graphql_str = "query { exampleThing }";

        let examplething_val = serde_json::from_str::<ExampleThingResponse>(
            &CommonServer::post_graphql_get_json(&graphql_str)?,
        );

        let examplething_val =
            examplething_val.map_err(|err| ErrorType::QueryResponseParseError(err.to_string()))?;

        Ok(examplething_val.data.example_thing)
    }
    fn is_permitted(caller: String) -> Result<bool, Error> {
        // access_to == get_sender_app()
        // check to local storage
        // show dialog if not in local storage
        return Ok(true);
    }
}

bindings::export!(PermissionsPlugin with_types_in bindings);
