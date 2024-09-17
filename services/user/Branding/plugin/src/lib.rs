#[allow(warnings)]
mod bindings;

use bindings::exports::branding::plugin::api::Guest as Api;
use bindings::exports::branding::plugin::queries::Guest as Queries;
use bindings::host::common::server as CommonServer;
use bindings::host::common::types::Error;
use bindings::transact::plugin::intf::add_action_to_transaction;

use psibase::fracpack::Pack;

mod errors;
use errors::ErrorType;
use psibase::Hex;

struct BrandingPlugin;

impl Api for BrandingPlugin {
    fn set_network_name(name: String) {
        let packed_network_name_args = branding::action_structs::setNetworkName { name }.packed();
        add_action_to_transaction("setNetworkName", &packed_network_name_args).unwrap();
    }
    fn set_logo(logo: Vec<u8>) {
        let packed_logo_args = branding::action_structs::storeSys {
            path: String::from("/network_logo.svg"),
            contentType: String::from("image/svg+xml"),
            content: Hex(logo),
        }
        .packed();
        add_action_to_transaction("storeSys", &packed_logo_args).unwrap();
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
            &CommonServer::post_graphql_get_json(&graphql_str).unwrap(),
        );

        let netname_val = netname_val
            .map_err(|err| ErrorType::QueryResponseParseError.err(err.to_string().as_str()))
            .unwrap();

        Ok(netname_val.data.network_name)
    }
}

bindings::export!(BrandingPlugin with_types_in bindings);
