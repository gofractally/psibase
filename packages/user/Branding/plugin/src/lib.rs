#[allow(warnings)]
mod bindings;

use bindings::*;
use exports::branding::plugin::api::Guest as Api;
use exports::branding::plugin::queries::Guest as Queries;
use exports::branding::plugin::types::Logo;
use host::http::api as CommonServer;
use host::types::types::Error;
use sites::plugin::api::{remove, upload, File};
use transact::plugin::api::add_action_to_transaction;

use branding::action_structs as Actions;

use psibase::image_content_type;
use psibase::AccountNumber;

mod errors;
use errors::ErrorType;

const MAX_LOGO_SIZE: usize = 32 * 1024;
const LOGO_PATH: &str = "/network_logo";

fn assert_caller(allowed: &[&str], context: &str) {
    let sender = host::client::api::get_sender();
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

        let _ = AccountNumber::from_exact(name.as_str()).expect("Network name invalid");

        let packed_network_name_args = psio::to_pssz(&Actions::setNetworkName { name });
        add_action_to_transaction(
            <Actions::setNetworkName as psio::interface::Method>::NAME,
            &packed_network_name_args,
        )
        .unwrap();
    }

    fn set_logo(logo: Logo) -> Result<(), Error> {
        assert_caller(&["config"], "set_logo");

        if logo.content.len() > MAX_LOGO_SIZE {
            return Err(ErrorType::LogoTooBig(MAX_LOGO_SIZE).into());
        }

        let content_type = image_content_type::parse(&logo.content_type)
            .filter(|content_type| {
                [
                    image_content_type::PNG,
                    image_content_type::JPEG,
                    image_content_type::WEBP,
                ]
                .contains(content_type)
            })
            .and_then(image_content_type::mime)
            .ok_or_else(|| ErrorType::InvalidLogoContentType(logo.content_type.clone()))?;

        // Raster images are already compressed
        upload(
            &File {
                path: LOGO_PATH.to_string(),
                content_type: content_type.to_string(),
                content: logo.content,
            },
            0,
        )
    }

    fn remove_logo() -> Result<(), Error> {
        assert_caller(&["config"], "remove_logo");

        remove(LOGO_PATH)
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
            &CommonServer::post_graphql_get_json(&graphql_str)
                .map_err(|err| ErrorType::QueryAuthError(err.to_string()))?,
        );

        let netname_val =
            netname_val.map_err(|err| ErrorType::QueryResponseParseError(err.to_string()))?;

        Ok(netname_val.data.network_name)
    }
}

bindings::export!(BrandingPlugin with_types_in bindings);
