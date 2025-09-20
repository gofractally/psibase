use crate::bindings::*;
use crate::errors::ErrorType::*;

use host::types::types as CommonTypes;
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
pub struct SecretResponse {
    pub secret: String,
}

#[allow(non_snake_case)]
#[derive(Deserialize)]
pub struct GetInviteResponse {
    pub inviteById: Option<SecretResponse>,
}

impl TryParseGqlResponse for SecretResponse {
    fn from_gql(response: String) -> Result<Self, CommonTypes::Error> {
        let response_root: ResponseRoot<GetInviteResponse> =
            serde_json::from_str(&response).map_err(|e| QueryError(e.to_string()))?;
        Ok(response_root.data.inviteById.ok_or_else(|| {
            QueryError("Unable to extract SecretResponse from query response".to_string())
        })?)
    }
}
