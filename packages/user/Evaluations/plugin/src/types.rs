use crate::bindings::*;
use crate::errors::ErrorType::*;

use host::types::types as CommonTypes;
use psibase::fracpack::{Pack, Unpack};
use serde::Deserialize;

pub trait TryParseGqlResponse: Sized {
    fn from_gql(s: String) -> Result<Self, CommonTypes::Error>;
}

#[derive(Debug, Clone, PartialEq, Deserialize)]
pub struct ResponseRoot<T> {
    pub data: T,
}

#[derive(Debug, Clone, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Data {
    pub get_evaluation: Option<GetEvaluation>,
    pub get_group: Option<GetGroup>,
    pub get_group_users: Option<GetGroupUsers>,
}

#[derive(Debug, Clone, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GetEvaluation {
    pub num_options: u8,
}

#[derive(Debug, Clone, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GetGroup {
    pub evaluation_id: u32,
    pub key_submitter: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GetGroupUsers {
    pub nodes: Vec<Node>,
}

#[derive(Debug, Clone, PartialEq, Deserialize)]
pub struct Node {
    pub user: String,
    pub attestation: Option<Vec<u8>>,
    pub proposal: Option<Vec<u8>>,
}

impl TryFrom<String> for Data {
    type Error = CommonTypes::Error;

    fn try_from(response: String) -> Result<Self, Self::Error> {
        let response_root: ResponseRoot<Data> = serde_json::from_str(&response)
            .map_err(|e| GraphQLParseError(format!("GetEvaluationResponse: {}", e)))?;

        Ok(response_root.data)
    }
}

#[allow(non_snake_case)]
#[derive(Deserialize, Pack, Unpack, Debug)]
pub struct UserSetting {
    pub user: String,
    pub key: Vec<u8>,
}

#[derive(Deserialize, Pack, Unpack, Debug)]
#[serde(rename_all = "camelCase")]
pub struct GetUserSettingsResponse {
    pub get_user_settings: Vec<Option<UserSetting>>,
}

impl TryFrom<String> for GetUserSettingsResponse {
    type Error = CommonTypes::Error;

    fn try_from(response: String) -> Result<Self, Self::Error> {
        let response_root: ResponseRoot<GetUserSettingsResponse> = serde_json::from_str(&response)
            .map_err(|e| GraphQLParseError(format!("GetUserSettingsResponse: {}", e)))?;

        Ok(response_root.data)
    }
}
#[derive(Deserialize, Pack, Unpack, Debug)]
#[serde(rename_all = "camelCase")]
pub struct KeyHistory {
    pub evaluation_id: u32,
    pub hash: String,
    pub group_number: u32,
    pub keys: Vec<Vec<u8>>,
}

#[derive(Deserialize, Pack, Unpack, Debug)]
pub struct KeyHistoryRoot {
    pub edges: Vec<Edge>,
}

#[allow(non_snake_case)]
#[derive(Deserialize, Pack, Unpack, Debug)]
pub struct Edge {
    pub node: KeyHistory,
}

#[derive(Deserialize, Pack, Unpack, Debug)]
#[serde(rename_all = "camelCase")]
pub struct KeyHistoryResponse {
    pub get_group_key: KeyHistoryRoot,
}

impl TryFrom<String> for KeyHistoryResponse {
    type Error = CommonTypes::Error;

    fn try_from(response: String) -> Result<Self, Self::Error> {
        let response_root: ResponseRoot<KeyHistoryResponse> = serde_json::from_str(&response)
            .map_err(|e| GraphQLParseError(format!("KeyHistoryResponse: {}", e)))?;

        Ok(response_root.data)
    }
}

#[derive(Debug, Clone, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UserConnection {
    pub get_group_users: GetGroupUsersConnection,
}

#[derive(Debug, Clone, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GetGroupUsersConnection {
    pub nodes: Vec<UserNode>,
}

#[derive(Debug, Clone, PartialEq, Deserialize, Pack, Unpack)]
#[serde(rename_all = "camelCase")]
pub struct UserNode {
    pub user: String,
}

impl TryFrom<String> for UserConnection {
    type Error = CommonTypes::Error;

    fn try_from(response: String) -> Result<Self, Self::Error> {
        let response_root: ResponseRoot<UserConnection> = serde_json::from_str(&response)
            .map_err(|e| GraphQLParseError(format!("UserConnection: {}", e)))?;

        Ok(response_root.data)
    }
}
