#[allow(warnings)]
mod bindings;

use bindings::exports::workshop::plugin::consumer::{
    AppMetadata as ConsumerAppMetadata, Guest as Consumer,
};
use bindings::exports::workshop::plugin::developer::Guest as Developer;
use bindings::host::common::{client as Client, server as Server, types as CommonTypes};
use bindings::transact::plugin::intf as Transact;
use bindings::workshop::plugin::types::AccountId;
use psibase::fracpack::Pack;
use psibase::AccountNumber;
use workshop as WorkshopService;
use workshop::service::AppMetadata;

use serde::{Deserialize, Serialize};

mod errors;
use errors::ErrorType::*;

struct WorkshopPlugin;

trait TryParseGqlResponse: Sized {
    fn from_gql(s: String) -> Result<Self, CommonTypes::Error>;
}

#[derive(Deserialize, Debug)]
struct ResponseRoot<T> {
    data: T,
}

#[allow(non_snake_case)]
#[derive(Deserialize, Debug)]
struct AppMetadataResponseData {
    name: String,
    shortDescription: String,
    longDescription: String,
    icon: Option<String>,
    tosSubpage: String,
    privacyPolicySubpage: String,
    appHomepageSubpage: String,
    status: String,
    tags: Vec<String>,
}

#[allow(non_snake_case)]
#[derive(Deserialize, Debug)]
struct AppMetadataResponse {
    appMetadata: Option<AppMetadataResponseData>,
}
impl TryParseGqlResponse for AppMetadataResponseData {
    fn from_gql(response: String) -> Result<Self, CommonTypes::Error> {
        println!("response: {:?}", response);
        let response_root: ResponseRoot<AppMetadataResponse> =
            serde_json::from_str(&response).map_err(|e| QueryError.err(&e.to_string()))?;
        println!("response_root: {:?}", response_root);
        let appMetadata = response_root.data.appMetadata.unwrap();
        // TODO: handle 404 gracefully as not found error
        println!("app_metadata: {:?}", appMetadata);
        Ok(appMetadata)
    }
}

impl Developer for WorkshopPlugin {
    fn set_app_metadata(
        name: String,
        short_description: String,
        long_description: String,
        icon: String,
        tos_subpage: String,
        privacy_policy_subpage: String,
        app_homepage_subpage: String,
        status: String,
        tags: Vec<String>,
    ) -> Result<(), CommonTypes::Error> {
        // todo: convert js blob bytes to base64
        Transact::add_action_to_transaction(
            "setMetadata",
            &WorkshopService::action_structs::setMetadata {
                name: name.to_owned(),
                short_description: short_description.to_owned(),
                long_description: long_description.to_owned(),
                icon: None,
                tos_subpage: tos_subpage.to_owned(),
                privacy_policy_subpage: privacy_policy_subpage.to_owned(),
                app_homepage_subpage: app_homepage_subpage.to_owned(),
                status: status.to_owned(),
                tags: tags.to_owned(),
            }
            .packed(),
        )?;
        Ok(())
    }
}

impl Consumer for WorkshopPlugin {
    fn get_app_metadata(account: AccountId) -> Result<ConsumerAppMetadata, CommonTypes::Error> {
        let query = format!(
            r#"query {{
                appMetadata(accountId: "{account}") {{
                    name,
                    shortDescription,
                    longDescription,
                    icon,
                    tosSubpage,
                    privacyPolicySubpage,
                    appHomepageSubpage,
                    status,
                    tags
                }}
            }}"#,
            account = account
        );
        println!("query: {}", query);
        // todo: handle 404 gracefully
        let metadata = AppMetadataResponseData::from_gql(Server::post_graphql_get_json(&query)?)?;

        println!("metadata: {:?}", metadata);

        // todo: fix fields
        let x = ConsumerAppMetadata {
            name: metadata.name,
            short_description: metadata.shortDescription,
            long_description: metadata.longDescription,
            icon: metadata.icon.unwrap_or_default(),
            tos_subpage: metadata.tosSubpage,
            privacy_policy_subpage: metadata.privacyPolicySubpage,
            app_homepage_subpage: metadata.appHomepageSubpage,
            status: metadata.status,
            tags: vec![],
        };

        // convert timestamps from unix to iso strings
        Ok(x)
    }
}

bindings::export!(WorkshopPlugin with_types_in bindings);
