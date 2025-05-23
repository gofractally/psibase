#[allow(warnings)]
mod bindings;
mod perms;

use bindings::clientdata::plugin::keyvalue as Keyvalue;
use bindings::exports::addpermone::plugin::admin::Guest as Admin;
use bindings::exports::addpermone::plugin::api::Guest as Api;
use bindings::exports::addpermone::plugin::queries::Guest as Queries;
use bindings::host::common::server as CommonServer;
use bindings::host::common::types::Error;
use bindings::transact::plugin::intf::add_action_to_transaction;

use perms::verify_auth_method;
use psibase::fracpack::Pack;

mod errors;
use errors::ErrorType;

struct AddpermonePlugin;

impl Api for AddpermonePlugin {
    fn set_example_thing(thing: String) -> Result<(), Error> {
        verify_auth_method("setExampleThing")?;

        let packed_example_thing_args =
            addpermone::action_structs::setExampleThing { thing }.packed();
        add_action_to_transaction("setExampleThing", &packed_example_thing_args).unwrap();

        Ok(())
    }
}

impl Admin for AddpermonePlugin {
    fn save_perm(user: String, caller: String, method: String) {
        println!(
            "save_perm::user: {:?}, caller: {:?}, method: {:?}",
            user, caller, method
        );
        let any_value = "1".as_bytes();
        Keyvalue::set(&format!("{user}-{caller}->{method}"), any_value).unwrap();
    }

    fn del_perm(caller: String, method: String) {
        Keyvalue::delete(&format!("{caller}->{method}"));
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

impl Queries for AddpermonePlugin {
    fn get_example_thing() -> Result<String, Error> {
        let graphql_str = "query { exampleThing }";

        let examplething_val = serde_json::from_str::<ExampleThingResponse>(
            &CommonServer::post_graphql_get_json(&graphql_str)?,
        );

        let examplething_val =
            examplething_val.map_err(|err| ErrorType::QueryResponseParseError(err.to_string()))?;

        Ok(examplething_val.data.example_thing)
    }
}

bindings::export!(AddpermonePlugin with_types_in bindings);
