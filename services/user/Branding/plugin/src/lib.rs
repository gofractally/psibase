#[allow(warnings)]
mod bindings;

<<<<<<< HEAD
use bindings::exports::branding::plugin::api::Guest as Api;
use bindings::exports::branding::plugin::queries::Guest as Queries;
use bindings::host::common::server as CommonServer;
use bindings::host::common::types::Error;
use bindings::sites::plugin::api::{upload, File};
use bindings::staged_tx::plugin::proposer::*;
use bindings::transact::plugin::intf::add_action_to_transaction;
=======
use bindings::*;
use exports::branding::plugin::api::Guest as Api;
use exports::branding::plugin::queries::Guest as Queries;
use host::common::server as CommonServer;
use host::common::types::Error;
use sites::plugin::sites::{upload, File};
use staged_tx::plugin::proposer::*;
use transact::plugin::intf::add_action_to_transaction;
>>>>>>> origin/main

use psibase::fracpack::Pack;

mod errors;
use errors::ErrorType;

struct BrandingPlugin;

struct Latch;

impl Latch {
    fn new() -> Self {
        set_propose_latch(Some("branding")).unwrap();
        Self
    }
}

impl Drop for Latch {
    fn drop(&mut self) {
        set_propose_latch(None).unwrap();
    }
}

impl Api for BrandingPlugin {
    fn set_network_name(name: String) {
        let _latch = Latch::new();

        let packed_network_name_args = branding::action_structs::setNetworkName { name }.packed();
        add_action_to_transaction("setNetworkName", &packed_network_name_args).unwrap();
    }
    fn set_logo(logo: Vec<u8>) {
        let _latch = Latch::new();

        upload(
            &File {
                path: String::from("/network_logo.svg"),
                content_type: String::from("image/svg+xml"),
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
            &CommonServer::post_graphql_get_json(&graphql_str).unwrap(),
        );

        let netname_val =
            netname_val.map_err(|err| ErrorType::QueryResponseParseError(err.to_string()))?;

        Ok(netname_val.data.network_name)
    }
}

bindings::export!(BrandingPlugin with_types_in bindings);
