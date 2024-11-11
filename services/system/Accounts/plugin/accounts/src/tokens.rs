use crate::bindings::accounts::account_tokens::api::*;
use crate::bindings::accounts::plugin::types::OriginationData;

impl Token {
    pub fn new_connection_token(sender: OriginationData) -> Self {
        Token::ConnectionToken(sender)
    }
}

impl From<Token> for String {
    fn from(token: Token) -> Self {
        serialize_token(&token)
    }
}
