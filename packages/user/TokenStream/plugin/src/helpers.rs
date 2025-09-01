use crate::bindings::host::types::types::Error;
use crate::errors::ErrorType;
use tokens::helpers::{identify_token_type, TokenType};

pub fn token_id_to_number(token_id: String) -> Result<u32, Error> {
    match identify_token_type(token_id) {
        TokenType::Number(number) => Ok(number),
        TokenType::Symbol(_str) => {
            Err(ErrorType::NotImplemented("Symbol to token number not ready".into()).into())
        }
    }
}
