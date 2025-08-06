use crate::bindings::accounts::account_tokens::{api::*, types::ConnectionToken};

impl Token {
    pub fn new_connection_token(sender: ConnectionToken) -> Self {
        Token::ConnectionToken(sender)
    }
}

impl From<Token> for String {
    fn from(token: Token) -> Self {
        serialize_token(&token)
    }
}
