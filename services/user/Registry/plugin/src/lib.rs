#[allow(warnings)]
mod bindings;

use bindings::exports::registry::plugin::consumer::Guest as Consumer;
use bindings::exports::registry::plugin::developer::Guest as Developer;
use bindings::host::common::{server as Server, types as CommonTypes};
use bindings::registry::plugin::types::{
    AccountId, AppMetadata, AppStatus, ExtraMetadata, FullAppMetadata,
};
use bindings::transact::plugin::intf as Transact;
use chrono::DateTime;
use psibase::fracpack::Pack;
use registry as RegistryService;
use registry::service::AppMetadata as ServiceAppMetadata;
use registry::service::AppStatusU32 as ServiceAppStatusU32;
use registry::service::TagRecord;

use serde::Deserialize;

mod errors;
use errors::ErrorType::*;

struct RegistryPlugin;

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
    metadata: ServiceAppMetadata,
    tags: Vec<TagRecord>,
}

#[allow(non_snake_case)]
#[derive(Deserialize, Debug)]
struct AppMetadataResponse {
    appMetadata: Option<AppMetadataResponseData>,
}

impl TryParseGqlResponse for AppMetadataResponseData {
    fn from_gql(response: String) -> Result<Self, CommonTypes::Error> {
        // println!("response: {:?}", response);
        let response_root: ResponseRoot<AppMetadataResponse> = serde_json::from_str(&response)
            .map_err(|e| QueryDeserializeError.err(&e.to_string()))?;
        // println!("response_root: {:?}", response_root);

        match response_root.data.appMetadata {
            Some(app_metadata) => {
                // println!("app_metadata: {:?}", app_metadata);
                Ok(app_metadata)
            }
            None => Err(NotFound.err("App metadata not found")),
        }
    }
}

#[allow(non_snake_case)]
#[derive(Deserialize, Debug)]
struct TagsResponseData {
    tags: Vec<String>,
}

#[allow(non_snake_case)]
#[derive(Deserialize, Debug)]
struct TagsResponse {
    allRelatedTags: TagsResponseData,
}

impl From<ServiceAppStatusU32> for AppStatus {
    fn from(status: ServiceAppStatusU32) -> Self {
        match status {
            0 => AppStatus::Draft,
            1 => AppStatus::Published,
            2 => AppStatus::Unpublished,
            _ => panic!("Invalid app status"),
        }
    }
}

impl TryParseGqlResponse for TagsResponseData {
    fn from_gql(response: String) -> Result<Self, CommonTypes::Error> {
        println!("response: {:?}", response);
        let response_root: ResponseRoot<TagsResponse> = serde_json::from_str(&response)
            .map_err(|e| QueryDeserializeError.err(&e.to_string()))?;
        println!("response_root: {:?}", response_root);

        Ok(response_root.data.allRelatedTags)
    }
}

impl Developer for RegistryPlugin {
    fn set_app_metadata(metadata: AppMetadata) -> Result<(), CommonTypes::Error> {
        let owners_vec = metadata
            .owners
            .iter()
            .map(|owner| owner.parse().unwrap())
            .collect();
        Transact::add_action_to_transaction(
            "setMetadata",
            &RegistryService::action_structs::setMetadata {
                name: metadata.name.to_owned(),
                short_description: metadata.short_description.to_owned(),
                long_description: metadata.long_description.to_owned(),
                icon: metadata.icon.to_owned(),
                icon_mime_type: metadata.icon_mime_type.to_owned(),
                tos_subpage: metadata.tos_subpage.to_owned(),
                privacy_policy_subpage: metadata.privacy_policy_subpage.to_owned(),
                app_homepage_subpage: metadata.app_homepage_subpage.to_owned(),
                status: metadata.status as ServiceAppStatusU32,
                tags: metadata.tags.to_owned(),
                redirect_uris: metadata.redirect_uris.to_owned(),
                owners: owners_vec,
            }
            .packed(),
        )?;
        Ok(())
    }
}

impl Consumer for RegistryPlugin {
    fn get_app_metadata(account: AccountId) -> Result<FullAppMetadata, CommonTypes::Error> {
        // println!("get_app_metadata: account = {:?}", account);

        let query = format!(
            r#"query {{
                appMetadata(accountId: "{account}") {{
                    metadata {{
                        accountId,
                        name,
                        shortDescription,
                        longDescription,
                        icon,
                        iconMimeType,
                        tosSubpage,
                        privacyPolicySubpage,
                        appHomepageSubpage,
                        status,
                        redirectUris,
                        owners,
                        createdAt {{
                            seconds
                        }}
                    }}
                    tags {{
                        id,
                        tag
                    }}
                }}
            }}"#,
            account = account
        );
        let metadata = AppMetadataResponseData::from_gql(
            Server::post_graphql_get_json(&query).map_err(|e| QueryError.err(&e.message))?,
        )?;

        let tags: Vec<String> = metadata.tags.iter().map(|tag| tag.tag.to_owned()).collect();

        let owners = metadata
            .metadata
            .owners
            .iter()
            .map(|owner| owner.to_string())
            .collect();

        let created_at = DateTime::from_timestamp(metadata.metadata.created_at.seconds as i64, 0)
            .expect("Failed to parse created_at")
            .to_string();

        let res = FullAppMetadata {
            app_metadata: AppMetadata {
                name: metadata.metadata.name,
                short_description: metadata.metadata.short_description,
                long_description: metadata.metadata.long_description,
                icon: metadata.metadata.icon,
                icon_mime_type: metadata.metadata.icon_mime_type,
                tos_subpage: metadata.metadata.tos_subpage,
                privacy_policy_subpage: metadata.metadata.privacy_policy_subpage,
                app_homepage_subpage: metadata.metadata.app_homepage_subpage,
                status: metadata.metadata.status.into(),
                redirect_uris: metadata.metadata.redirect_uris,
                owners,
                tags,
            },
            extra_metadata: ExtraMetadata { created_at },
        };

        println!("res: {:?}", res);

        // convert timestamps from unix to iso strings
        Ok(res)
    }

    fn get_related_tags(tag: String) -> Result<Vec<String>, CommonTypes::Error> {
        let query = format!(
            r#"query {{
                allRelatedTags(tag: "{tag}") {{
                    tags
                }}
            }}"#,
            tag = tag
        );

        println!("query: {}", query);
        let metadata = TagsResponseData::from_gql(Server::post_graphql_get_json(&query)?)?;
        println!("tagsMetadata: {:?}", metadata);
        Ok(metadata.tags)
    }
}

bindings::export!(RegistryPlugin with_types_in bindings);
