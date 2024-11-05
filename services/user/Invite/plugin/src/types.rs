use crate::bindings;
use crate::errors::ErrorType::*;

use base64::{engine::general_purpose::URL_SAFE, Engine};
use bindings::host::common::types as CommonTypes;
use bindings::invite::plugin::types::InviteToken;
use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize)]
pub struct InviteParams {
    pub app: Option<String>,
    pub app_domain: String,
    pub pk: String,
}

#[derive(Deserialize)]
pub struct ResponseRoot<T> {
    pub data: T,
}

pub trait TryParseGqlResponse: Sized {
    fn from_gql(s: String) -> Result<Self, CommonTypes::Error>;
}

#[allow(non_snake_case)]
#[derive(Deserialize)]
pub struct InviteRecordSubset {
    pub inviter: psibase::AccountNumber,
    pub actor: psibase::AccountNumber,
    pub expiry: u32,
    pub state: u8,
}

#[allow(non_snake_case)]
#[derive(Deserialize)]
pub struct GetInviteResponse {
    pub getInvite: Option<InviteRecordSubset>,
}

impl TryParseGqlResponse for InviteRecordSubset {
    fn from_gql(response: String) -> Result<Self, CommonTypes::Error> {
        let response_root: ResponseRoot<GetInviteResponse> =
            serde_json::from_str(&response).map_err(|e| QueryError(e.to_string()))?;
        Ok(response_root.data.getInvite.ok_or_else(|| {
            QueryError("Unable to extract InviteRecordSubset from query response".to_string())
        })?)
    }
}

impl From<InviteParams> for InviteToken {
    fn from(params: InviteParams) -> Self {
        let params_str = serde_json::to_string(&params).unwrap();
        URL_SAFE.encode(params_str)
    }
}

pub trait TryFromInviteToken: Sized {
    fn try_from_invite_id(id: &str) -> Result<Self, CommonTypes::Error>;
}

impl TryFromInviteToken for InviteParams {
    fn try_from_invite_id(id: &str) -> Result<Self, CommonTypes::Error> {
        let bytes = URL_SAFE
            .decode(id)
            .map_err(|_| DecodeInviteError("Error decoding base64"))?;

        let str = String::from_utf8(bytes)
            .map_err(|_| DecodeInviteError("Error converting from UTF8"))?;

        let result: InviteParams = serde_json::from_str(&str)
            .map_err(|_| DecodeInviteError("Error deserializing JSON string into object"))?;

        Ok(result)
    }
}
