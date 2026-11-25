use crate::errors::ErrorType;
use psibase::services::tokens::{Decimal, Precision};
use psibase::AccountNumber;
use psibase_plugin::host::server;

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
pub struct TokenSettings {
    pub untransferable: bool,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Token {
    pub precision: Precision,
    pub id: u32,
    pub nft_id: u32,
    pub current_supply: Decimal,
    pub max_issued_supply: Decimal,
    // Burning the administration NFT intentionally leaves an immutable token
    // without an issuer. Its precision and transferability remain valid.
    pub owner: Option<AccountNumber>,
    pub symbol: Option<AccountNumber>,
    pub settings: TokenSettings,
}

pub fn fetch_token(token_number: u32) -> Result<Token, ErrorType> {
    let query = format!(
        r#"query {{
        	token(tokenId: "{token_id}") {{
        		precision
        		id
        		nftId
        		currentSupply
        		maxIssuedSupply
                symbol
                owner
                settings {{
                    untransferable
                }}
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

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn immutable_and_administered_native_tokens_decode() {
        let immutable = r#"{"data":{"token":{"precision":4,"id":2,"nftId":20,"currentSupply":"1000.0000","maxIssuedSupply":"1000.0000","owner":null,"symbol":"usd","settings":{"untransferable":false}}}}"#;
        let token: Response = serde_json::from_str(immutable).unwrap();
        assert!(token.data.token.owner.is_none());
        assert_eq!(token.data.token.precision.value(), 4);
        let administered = immutable.replace("\"owner\":null", "\"owner\":\"issuer\"");
        let token: Response = serde_json::from_str(&administered).unwrap();
        assert_eq!(token.data.token.owner.unwrap().to_string(), "issuer");
    }
}
