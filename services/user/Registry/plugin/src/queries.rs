use serde::Deserialize;

use registry::service::AppMetadata as ServiceAppMetadata;
use registry::service::TagRecord;

use crate::bindings::host::common::{server as Server, types as CommonTypes};
use crate::bindings::registry::plugin::types::AccountId;
use crate::errors::ErrorType::*;

#[derive(Deserialize, Debug)]
struct ResponseRoot<T> {
    data: T,
}

pub trait TryParseGqlResponse: Sized {
    fn from_gql(s: String) -> Result<Self, CommonTypes::Error>;
}

fn query_graphql<T, F>(query: &str, response_parser: F) -> Result<T, CommonTypes::Error>
where
    F: FnOnce(String) -> Result<T, CommonTypes::Error>,
{
    let json_str =
        Server::post_graphql_get_json(query).map_err(|e| QueryError.err(&e.to_string()))?;
    response_parser(json_str)
}

#[derive(Deserialize, Debug)]
pub struct TagsResponseData {
    pub tags: Vec<String>,
}

#[derive(Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct TagsResponse {
    all_related_tags: TagsResponseData,
}

#[derive(Deserialize, Debug)]
pub struct AppMetadataResponseData {
    pub metadata: ServiceAppMetadata,
    pub tags: Vec<TagRecord>,
}

#[derive(Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
struct AppMetadataResponse {
    app_metadata: Option<AppMetadataResponseData>,
}

impl TryParseGqlResponse for AppMetadataResponseData {
    fn from_gql(response: String) -> Result<Self, CommonTypes::Error> {
        let response_root: ResponseRoot<AppMetadataResponse> = serde_json::from_str(&response)
            .map_err(|e| QueryDeserializeError.err(&e.to_string()))?;
        match response_root.data.app_metadata {
            Some(app_metadata) => Ok(app_metadata),
            None => Err(NotFound.err("App metadata not found")),
        }
    }
}

impl TryParseGqlResponse for TagsResponseData {
    fn from_gql(response: String) -> Result<Self, CommonTypes::Error> {
        let response_root: ResponseRoot<TagsResponse> = serde_json::from_str(&response)
            .map_err(|e| QueryDeserializeError.err(&e.to_string()))?;
        Ok(response_root.data.all_related_tags)
    }
}

pub fn query_app_metadata(
    account: AccountId,
) -> Result<AppMetadataResponseData, CommonTypes::Error> {
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
    query_graphql(&query, AppMetadataResponseData::from_gql)
}

pub fn query_all_related_tags(tag_substr: String) -> Result<TagsResponseData, CommonTypes::Error> {
    let query = format!(
        r#"query {{
            allRelatedTags(tag_substr: "{tag_substr}") {{
                tags
            }}
        }}"#,
        tag_substr = tag_substr
    );
    query_graphql(&query, TagsResponseData::from_gql)
}
