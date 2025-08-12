use crate::errors::ErrorType::*;
use crate::{bindings::*, InviteToken};

use accounts::account_tokens::api::deserialize_token;
use accounts::account_tokens::types::*;
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
pub struct InviteRecordSubset {
    pub invite_id: u32,
    pub pubkey: String,
    pub inviter: psibase::AccountNumber,
    pub app: Option<psibase::AccountNumber>,
    pub app_domain: Option<String>,
    pub actor: psibase::AccountNumber,
    pub expiry: String,
    pub state: u8,
    pub secret: Option<String>,
}

#[allow(non_snake_case)]
#[derive(Deserialize)]
pub struct GetInviteResponse {
    pub inviteById2: Option<InviteRecordSubset>,
}

impl TryParseGqlResponse for InviteRecordSubset {
    fn from_gql(response: String) -> Result<Self, CommonTypes::Error> {
        let response_root: ResponseRoot<GetInviteResponse> =
            serde_json::from_str(&response).map_err(|e| QueryError(e.to_string()))?;
        Ok(response_root.data.inviteById2.ok_or_else(|| {
            QueryError("Unable to extract InviteRecordSubset from query response".to_string())
        })?)
    }
}

impl InviteToken {
    pub fn from_encoded(token: &str) -> Result<Self, CommonTypes::Error> {
        let invite_params =
            deserialize_token(token).ok_or(DecodeInviteError("maybe incorrect token?"))?;

        let invite_token = match invite_params {
            Token::InviteToken(params) => params,
            _ => {
                return Err(DecodeInviteError("maybe incorrect token?").into());
            }
        };

        Ok(invite_token)
    }
}
