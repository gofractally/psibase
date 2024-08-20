#[allow(warnings)]
mod bindings;

use bindings::exports::branding::plugin::api::Guest as Api;
use bindings::exports::branding::plugin::queries::Guest as Queries;
use bindings::host::common::server as CommonServer;
use bindings::host::common::types::Error;

mod errors;
use errors::ErrorType;

struct BrandingPlugin;

impl Api for BrandingPlugin {
    fn set_chain_name(name: String) {
        // store name in singleton
        println!("set_chain_name({})", name);
    }
    fn set_logo(logo: Vec<u8>) {
        // push logo to sites in root so others can reach it by url
        println!("set_chain_logo({:#?})", logo);
    }
}

#[derive(serde::Deserialize)]
struct ChainName {
    name: String,
}
#[derive(serde::Deserialize)]
#[allow(non_snake_case)]
struct ChainNameData {
    chainName: ChainName,
}
#[derive(serde::Deserialize)]
struct ChainNameResponse {
    data: ChainNameData,
}

impl Queries for BrandingPlugin {
    fn get_chain_name() -> Result<String, Error> {
        // return String::from("chainName");
        let graphql_str = format!("query {{ chainName {{ name }} }}");
        let summary_val = serde_json::from_str::<ChainNameResponse>(
            &CommonServer::post_graphql_get_json(&graphql_str)?,
        )
        .map_err(|err| ErrorType::QueryResponseParseError.err(err.to_string().as_str()))?;

        Ok(summary_val.data.chainName.name)
    }
}

bindings::export!(BrandingPlugin with_types_in bindings);
