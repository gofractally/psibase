use crate::errors::ErrorType::*;
use crate::{bindings, InviteToken};

use bindings::accounts::account_tokens::api::deserialize_token;
use bindings::accounts::account_tokens::types::*;
use bindings::host::common::types as CommonTypes;
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
    pub expiry: String,
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

impl InviteToken {
    pub fn from_encoded(token: &str) -> Result<Self, CommonTypes::Error> {
        let invite_params =
            deserialize_token(token).ok_or(DecodeInviteError("accept_with_new_account"))?;

        let invite_token = match invite_params {
            Token::InviteToken(params) => params,
            _ => {
                return Err(DecodeInviteError("accept_with_new_account").into());
            }
        };

        Ok(invite_token)
    }
}
