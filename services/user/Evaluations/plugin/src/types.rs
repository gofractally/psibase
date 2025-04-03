use crate::bindings::*;
use crate::errors::ErrorType::*;

use host::common::types as CommonTypes;
use psibase::fracpack::{Pack, Unpack};
use serde::Deserialize;

#[derive(Deserialize)]
pub struct ResponseRoot<T> {
    pub data: T,
}

pub trait TryParseGqlResponse: Sized {
    fn from_gql(s: String) -> Result<Self, CommonTypes::Error>;
}

#[allow(non_snake_case)]
#[derive(Deserialize, Pack, Unpack, Debug)]
#[serde(rename_all = "camelCase")]
pub struct EvaluationRecordSubset {
    pub evaluationId: u32,
    pub keySubmitter: Option<String>,
    pub keyHash: Option<String>,
    pub keys: Vec<Vec<u8>>,
}

#[allow(non_snake_case)]
#[derive(Deserialize, Pack, Unpack, Debug)]
#[serde(rename_all = "camelCase")]
pub struct GroupUserSubset {
    pub user: String,
    pub submission: Option<String>,
    pub proposal: Option<Vec<u8>>,
    pub key: Vec<u8>,
}

#[allow(non_snake_case)]
#[derive(Deserialize)]
pub struct GetEvaluationResponse {
    pub getGroup: Option<EvaluationRecordSubset>,
    pub getGroupUsers: Option<Vec<GroupUserSubset>>,
}

impl TryParseGqlResponse for GetEvaluationResponse {
    fn from_gql(response: String) -> Result<Self, CommonTypes::Error> {
        let response_root: ResponseRoot<GetEvaluationResponse> =
            serde_json::from_str(&response).map_err(|e| QueryResponseParseError(e.to_string()))?;

        Ok(response_root.data)
    }
}
