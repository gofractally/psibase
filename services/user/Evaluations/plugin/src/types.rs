use crate::bindings::*;
use crate::errors::ErrorType::*;

use host::common::types as CommonTypes;
use psibase::fracpack::{Pack, Unpack};
use serde::Deserialize;
use std::ops::{Deref, DerefMut};

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

impl Deref for GetGroupUsers {
    type Target = Vec<Node>;

    fn deref(&self) -> &Self::Target {
        &self.nodes
    }
}

impl DerefMut for GetGroupUsers {
    fn deref_mut(&mut self) -> &mut Self::Target {
        &mut self.nodes
    }
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

#[allow(non_snake_case)]
#[derive(Deserialize, Pack, Unpack, Debug)]
pub struct GetUserSettingsResponse {
    pub getUserSettings: Vec<Option<UserSetting>>,
}

impl TryFrom<String> for GetUserSettingsResponse {
    type Error = CommonTypes::Error;

    fn try_from(response: String) -> Result<Self, Self::Error> {
        let response_root: ResponseRoot<GetUserSettingsResponse> = serde_json::from_str(&response)
            .map_err(|e| GraphQLParseError(format!("GetUserSettingsResponse: {}", e)))?;

        Ok(response_root.data)
    }
}

#[allow(non_snake_case)]
#[derive(Deserialize, Pack, Unpack, Debug)]
pub struct KeyHistory {
    pub evaluationId: String,
    pub hash: String,
    pub groupNumber: String,
    pub keys: Vec<Vec<u8>>,
}

#[allow(non_snake_case)]
#[derive(Deserialize, Pack, Unpack, Debug)]
pub struct KeyHistoryRoot {
    pub edges: Vec<Edge>,
}

#[allow(non_snake_case)]
#[derive(Deserialize, Pack, Unpack, Debug)]
pub struct Edge {
    pub node: KeyHistory,
}

#[allow(non_snake_case)]
#[derive(Deserialize, Pack, Unpack, Debug)]
pub struct KeyHistoryResponse {
    pub getGroupKey: KeyHistoryRoot,
}

impl TryFrom<String> for KeyHistoryResponse {
    type Error = CommonTypes::Error;

    fn try_from(response: String) -> Result<Self, Self::Error> {
        let response_root: ResponseRoot<KeyHistoryResponse> = serde_json::from_str(&response)
            .map_err(|e| GraphQLParseError(format!("KeyHistoryResponse: {}", e)))?;

        Ok(response_root.data)
    }
}
