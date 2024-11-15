#[allow(warnings)]
mod bindings;

use base64::{engine::general_purpose::URL_SAFE, Engine};
use bindings::accounts::account_tokens::types::*;
use bindings::exports::accounts::account_tokens::api::Guest as API;
use psibase::fracpack::{Pack, Unpack};

struct AccountTokens;

impl API for AccountTokens {
    fn serialize_token(token: Token) -> String {
        URL_SAFE.encode(token.packed())
    }

    fn deserialize_token(token: String) -> Option<Token> {
        let decoded = URL_SAFE.decode(&token).ok()?;
        Token::unpacked(&decoded).ok()
    }
}

bindings::export!(AccountTokens with_types_in bindings);
