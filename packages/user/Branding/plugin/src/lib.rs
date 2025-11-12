#[allow(warnings)]
mod bindings;

use bindings::*;
use exports::branding::plugin::api::Guest as Api;
use exports::branding::plugin::queries::Guest as Queries;
use host::common::server as CommonServer;
use host::types::types::Error;
use sites::plugin::api::{upload, File};
use transact::plugin::intf::add_action_to_transaction;

use psibase::fracpack::Pack;

mod errors;
use errors::ErrorType;

fn assert_caller(allowed: &[&str], context: &str) {
    let sender = host::common::client::get_sender();
    assert!(
        allowed.contains(&sender.as_str()),
        "{} can only be called by {:?}",
        context,
        allowed
    );
}

struct BrandingPlugin;

impl Api for BrandingPlugin {
    fn set_network_name(name: String) {
        assert_caller(&["config"], "set_network_name");

        let packed_network_name_args = branding::action_structs::setNetworkName { name }.packed();
        add_action_to_transaction("setNetworkName", &packed_network_name_args).unwrap();
    }

    fn set_logo(logo: Vec<u8>) {
        assert_caller(&["config"], "set_logo");

        upload(
            &File {
                path: "/network_logo.svg".to_string(),
                content_type: "image/svg+xml".to_string(),
                content: logo,
            },
            11,
        )
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

impl Queries for BrandingPlugin {
    fn get_network_name() -> Result<String, Error> {
        let graphql_str = "query { networkName }";

        let netname_val = serde_json::from_str::<NetworkNameResponse>(
            &CommonServer::post_graphql_get_json(&graphql_str).map_err(|err| ErrorType::QueryAuthError(err.to_string()))?,
        );

        let netname_val =
            netname_val.map_err(|err| ErrorType::QueryResponseParseError(err.to_string()))?;

        Ok(netname_val.data.network_name)
    }
}

bindings::export!(BrandingPlugin with_types_in bindings);
