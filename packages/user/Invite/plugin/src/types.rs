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
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FixedDetailsResponse {
    pub secret: String,
    pub expiryDate: String,
}

#[derive(Pack, Unpack)]
pub struct FixedDetails {
    pub expiry_date: String,
    pub private_key: String,
}

#[allow(non_snake_case)]
#[derive(Deserialize, Pack, Unpack)]
pub struct CurrentDetailsResponse {
    pub numAccounts: u16,
}

#[derive(Pack, Unpack)]
pub struct DeviceDetails {
    // Whether this device created an account with this invite
    pub account_created: bool,

    // Whether the invite was accepted on this device
    pub accepted: bool,
}

#[allow(non_snake_case)]
#[derive(Deserialize)]
pub struct GetInviteResponse<T> {
    pub inviteById: Option<T>,
}

impl TryParseGqlResponse for FixedDetailsResponse {
    fn from_gql(response: String) -> Result<Self, CommonTypes::Error> {
        let response_root: ResponseRoot<GetInviteResponse<FixedDetailsResponse>> =
            serde_json::from_str(&response).map_err(|e| QueryError(e.to_string()))?;
        Ok(response_root.data.inviteById.ok_or_else(|| {
            QueryError("Unable to extract SecretResponse from query response".to_string())
        })?)
    }
}

impl TryParseGqlResponse for CurrentDetailsResponse {
    fn from_gql(response: String) -> Result<Self, CommonTypes::Error> {
        let response_root: ResponseRoot<GetInviteResponse<CurrentDetailsResponse>> =
            serde_json::from_str(&response).map_err(|e| QueryError(e.to_string()))?;
        Ok(response_root.data.inviteById.ok_or_else(|| {
            QueryError("Unable to extract InviteValidResponse from query response".to_string())
        })?)
    }
}
