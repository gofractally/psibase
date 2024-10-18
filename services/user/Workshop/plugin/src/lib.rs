#[allow(warnings)]
mod bindings;

use bindings::exports::workshop::plugin::consumer::{
    AppMetadata as ConsumerAppMetadata, Guest as Consumer,
    ReturnMetadata as ConsumerReturnMetadata, Tag as ConsumerTag, Tags as ConsumerTags,
};
use bindings::exports::workshop::plugin::developer::Guest as Developer;
use bindings::host::common::{server as Server, types as CommonTypes};
use bindings::transact::plugin::intf as Transact;
use bindings::workshop::plugin::types::{AccountId, Base64Str};
use psibase::fracpack::Pack;
use workshop as WorkshopService;

use serde::Deserialize;

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
struct AppMetadata {
    name: String,
    shortDescription: String,
    longDescription: String,
    icon: Base64Str,
    iconMimeType: String,
    tosSubpage: String,
    privacyPolicySubpage: String,
    appHomepageSubpage: String,
    status: String,
    redirectUris: Vec<String>,
    owners: Vec<AccountId>,
}

#[allow(non_snake_case)]
#[derive(Deserialize, Debug)]
struct TagRecord {
    id: u32,
    tag: String,
}

#[allow(non_snake_case)]
#[derive(Deserialize, Debug)]
struct AppMetadataResponseData {
    metadata: AppMetadata,
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
        let response_root: ResponseRoot<AppMetadataResponse> =
            serde_json::from_str(&response).map_err(|e| QueryError.err(&e.to_string()))?;
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

impl TryParseGqlResponse for TagsResponseData {
    fn from_gql(response: String) -> Result<Self, CommonTypes::Error> {
        let response_root: ResponseRoot<TagsResponse> =
            serde_json::from_str(&response).map_err(|e| QueryError.err(&e.to_string()))?;
        println!("response_root: {:?}", response_root);

        Ok(response_root.data.allRelatedTags)
    }
}

impl Developer for WorkshopPlugin {
    fn set_app_metadata(
        name: String,
        short_description: String,
        long_description: String,
        icon: Base64Str,
        icon_mime_type: String,
        tos_subpage: String,
        privacy_policy_subpage: String,
        app_homepage_subpage: String,
        status: String,
        tags: Vec<String>,
        redirect_uris: Vec<String>,
        owners: Vec<AccountId>,
    ) -> Result<(), CommonTypes::Error> {
        let owners_vec = owners.iter().map(|owner| owner.parse().unwrap()).collect();
        Transact::add_action_to_transaction(
            "setMetadata",
            &WorkshopService::action_structs::setMetadata {
                name: name.to_owned(),
                short_description: short_description.to_owned(),
                long_description: long_description.to_owned(),
                icon: icon.to_owned(),
                icon_mime_type: icon_mime_type.to_owned(),
                tos_subpage: tos_subpage.to_owned(),
                privacy_policy_subpage: privacy_policy_subpage.to_owned(),
                app_homepage_subpage: app_homepage_subpage.to_owned(),
                status: status.to_owned(),
                tags: tags.to_owned(),
                redirect_uris: redirect_uris.to_owned(),
                owners: owners_vec,
            }
            .packed(),
        )?;
        Ok(())
    }
}

impl Consumer for WorkshopPlugin {
    fn get_app_metadata(account: AccountId) -> Result<ConsumerReturnMetadata, CommonTypes::Error> {
        // println!("get_app_metadata: account = {:?}", account);

        let query = format!(
            r#"query {{
                appMetadata(accountId: "{account}") {{
                    metadata {{
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
                        owners
                    }}
                    tags {{
                        id,
                        tag
                    }}
                }}
            }}"#,
            account = account
        );
        println!("query: {}", query);
        let metadata = AppMetadataResponseData::from_gql(Server::post_graphql_get_json(&query)?)?;

        // println!("metadata: {:?}", metadata);

        let tags = metadata
            .tags
            .iter()
            .map(|tag| ConsumerTag {
                id: tag.id,
                tag: tag.tag.to_owned(),
            })
            .collect();

        let res = ConsumerReturnMetadata {
            metadata: ConsumerAppMetadata {
                name: metadata.metadata.name,
                short_description: metadata.metadata.shortDescription,
                long_description: metadata.metadata.longDescription,
                icon: metadata.metadata.icon,
                icon_mime_type: metadata.metadata.iconMimeType,
                tos_subpage: metadata.metadata.tosSubpage,
                privacy_policy_subpage: metadata.metadata.privacyPolicySubpage,
                app_homepage_subpage: metadata.metadata.appHomepageSubpage,
                status: metadata.metadata.status,
                redirect_uris: metadata.metadata.redirectUris,
                owners: metadata.metadata.owners,
            },
            tags,
        };

        println!("res: {:?}", res);

        // convert timestamps from unix to iso strings
        Ok(res)
    }

    fn get_related_tags(tag: String) -> Result<ConsumerTags, CommonTypes::Error> {
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

        let res = ConsumerTags {
            tags: metadata.tags,
        };

        println!("res: {:?}", res);

        Ok(res)
    }
}

bindings::export!(WorkshopPlugin with_types_in bindings);
