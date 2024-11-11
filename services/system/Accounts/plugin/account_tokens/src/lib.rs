#[allow(warnings)]
mod bindings;

use base64::{engine::general_purpose::URL_SAFE, Engine};
use bindings::accounts::account_tokens::types::*;
use bindings::exports::accounts::account_tokens::api::Guest as API;
use psibase::fracpack::{Pack, Unpack};

struct AccountTokens;

impl API for AccountTokens {
    fn serialize_token(token: Token) -> String {
        match token {
            Token::InviteToken(invite_token) => URL_SAFE.encode(&invite_token.packed()),
            Token::ConnectionToken(connection_token) => URL_SAFE.encode(&connection_token.packed()),
        }
    }

    fn deserialize_token(token: String) -> Option<Token> {
        let decoded = URL_SAFE.decode(&token).ok()?;

        if let Ok(invite_token) = <InviteToken>::unpacked(&decoded) {
            Some(Token::InviteToken(invite_token))
        } else if let Ok(connection_token) = <ConnectionToken>::unpacked(&decoded) {
            Some(Token::ConnectionToken(connection_token))
        } else {
            None
        }
    }
}

bindings::export!(AccountTokens with_types_in bindings);
