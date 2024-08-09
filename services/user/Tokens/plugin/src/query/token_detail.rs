use crate::bindings::host::common::{server, types as CommonTypes};
use crate::errors::ErrorType;

use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize)]
pub struct Response {
    pub data: Data,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Data {
    pub token_details: TokenDetails,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TokenDetails {
    pub id: u32,
    pub owner_details: OwnerDetails,
    pub precision: Precision,
    pub symbol_id: String,
}

#[derive(Serialize, Deserialize)]
pub struct OwnerDetails {
    pub account: String,
}

#[derive(Serialize, Deserialize)]
pub struct Precision {
    pub value: u8,
}

pub struct TokenDetail {
    pub id: u32,
    pub owner: String,
    pub precision: u8,
    pub symbol_id: String,
}

pub fn fetch_token(token_number: u32) -> Result<TokenDetail, CommonTypes::Error> {
    let query = format!(
        r#"query {{
            tokenDetails(tokenId: {token_id}) {{
                id
                ownerDetails {{
                  account
                }}
                precision {{
                  value
                }}
                symbolId
              }}
            
        }}"#,
        token_id = token_number
    );

    let res = server::post_graphql_get_json(&query)
        .map_err(|e| ErrorType::QueryError.err(&e.message))
        .and_then(|result| {
            serde_json::from_str(&result).map_err(|e| ErrorType::QueryError.err(&e.to_string()))
        })
        .and_then(|response_root: Response| Ok(response_root.data.token_details))
        .and_then(|token_details| {
            Ok(TokenDetail {
                id: token_details.id,
                owner: token_details.owner_details.account,
                precision: token_details.precision.value,
                symbol_id: token_details.symbol_id,
            })
        })?;

    if res.id == token_number {
        Ok(res)
    } else {
        Err(ErrorType::TokenNumberMismatch
            .err("token_number requested does not match response token_id"))
    }
}
