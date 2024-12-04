#[allow(warnings)]
mod bindings;

use bindings::exports::{{crate-name}}::plugin::api::Guest as Api;
use bindings::exports::{{crate-name}}::plugin::queries::Guest as Queries;
use bindings::host::common::server as CommonServer;
use bindings::host::common::types::Error;
use bindings::sites::plugin::sites::{upload, File};
use bindings::transact::plugin::intf::add_action_to_transaction;

use psibase::fracpack::Pack;

mod errors;
use errors::ErrorType;

struct {{ {{project-name}} | to_title_case}}Plugin;

impl Api for {{project-name | to_title_case}}Plugin {
    fn set_network_name(name: String) {
        let packed_network_name_args = {{crate-name}}::action_structs::setNetworkName { name }.packed();
        add_action_to_transaction("setNetworkName", &packed_network_name_args).unwrap();
    }
    fn set_logo(logo: Vec<u8>) {
        upload(&File {
            path: String::from("/network_logo.svg"),
            content_type: String::from("image/svg+xml"),
            content: logo,
        })
        .expect("Failed to upload logo");
    }
}

#[derive(serde::Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
struct NetworkNameData {
    network_name: String,
}
#[derive(serde::Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
struct NetworkNameResponse {
    data: NetworkNameData,
}

impl Queries for {{project-name | to_title_case}}Plugin {
    fn get_network_name() -> Result<String, Error> {
        let graphql_str = "query { networkName }";

        let netname_val = serde_json::from_str::<NetworkNameResponse>(
            &CommonServer::post_graphql_get_json(&graphql_str).unwrap(),
        );

        let netname_val = netname_val
            .map_err(|err| ErrorType::QueryResponseParseError.err(err.to_string().as_str()))
            .unwrap();

        Ok(netname_val.data.network_name)
    }
}

bindings::export!({{crate-name}}Plugin with_types_in bindings);
