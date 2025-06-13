use crate::bindings::host::common::{server, types as CommonTypes};
use crate::errors::ErrorType;
use psibase::{AccountNumber, Asset};

use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize)]
pub struct Response {
    pub data: Data,
}

#[derive(Serialize, Deserialize)]
pub struct Data {
    pub token: Token,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Token {
    pub precision: u8,
    pub id: u32,
    pub nft_id: u32,
    pub current_supply: Asset,
    pub max_supply: Asset,
    pub owner: AccountNumber,
}

pub fn fetch_token(token_number: u32) -> Result<Token, ErrorType> {
    let query = format!(
        r#"query {{
        	token(tokenId: "{token_id}") {{
        		precision
        		id
        		nftId
        		currentSupply
        		maxSupply
                owner
        	}}
        }}"#,
        token_id = token_number
    );

    server::post_graphql_get_json(&query)
        .map_err(|e| ErrorType::QueryError(e.message))
        .and_then(|result| {
            serde_json::from_str(&result).map_err(|e| ErrorType::QueryError(e.to_string()))
        })
        .and_then(|response_root: Response| Ok(response_root.data.token))
        .and_then(|token| {
            if token.id == token_number {
                Ok(token)
            } else {
                Err(ErrorType::TokenMismatch(token_number.to_string()))
            }
        })
}
