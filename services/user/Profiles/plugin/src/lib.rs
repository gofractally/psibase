#[allow(warnings)]
mod bindings;

use bindings::exports::profiles::plugin::api::Guest as Api;
use bindings::exports::profiles::plugin::queries::Guest as Queries;
use bindings::host::common::server as CommonServer;
use bindings::host::common::types::Error;
use bindings::transact::plugin::intf::add_action_to_transaction;

use psibase::fracpack::Pack;

mod errors;
use errors::ErrorType;

struct ProfilesPlugin;

impl Api for ProfilesPlugin {
    fn set_example_thing(thing: String) {
        let packed_example_thing_args =
            profiles::action_structs::setExampleThing { thing }.packed();
        add_action_to_transaction("setExampleThing", &packed_example_thing_args).unwrap();
    }

    fn set_profile(displayName: String) {
        let packed_profile_args = profiles::action_structs::setProfile { displayName }.packed();
        add_action_to_transaction("setProfile", &packed_profile_args).unwrap();
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

impl Queries for ProfilesPlugin {
    fn get_example_thing() -> Result<String, Error> {
        let graphql_str = "query { exampleThing }";

        let examplething_val = serde_json::from_str::<ExampleThingResponse>(
            &CommonServer::post_graphql_get_json(&graphql_str)?,
        );

        let examplething_val =
            examplething_val.map_err(|err| ErrorType::QueryResponseParseError(err.to_string()))?;

        Ok(examplething_val.data.example_thing)
    }

    // fn get_profile() -> Result<String, Error> {
    //     let graphql_str = "query { profile }";
    // }
}

bindings::export!(ProfilesPlugin with_types_in bindings);
