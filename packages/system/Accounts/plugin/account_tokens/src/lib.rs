#[allow(warnings)]
mod bindings;
use bindings::*;

use accounts::account_tokens::types::*;
use exports::accounts::account_tokens::api::Guest as API;

struct AccountTokens;

impl API for AccountTokens {
    fn serialize_token(token: Token) -> String {
        base64::plugin::url::encode(&serde_json::to_vec(&token).unwrap())
    }

    fn deserialize_token(token: String) -> Option<Token> {
        let decoded = base64::plugin::url::decode(&token).ok()?;
        serde_json::from_slice(&decoded).ok()
    }
}

bindings::export!(AccountTokens with_types_in bindings);
