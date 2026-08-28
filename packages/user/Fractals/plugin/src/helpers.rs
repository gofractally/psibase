use std::str::FromStr;

use crate::errors::ErrorType::*;
use psibase::AccountNumber;
use psibase_plugin::{host::client as Client, Error};

/// Free account names are 8-10 characters; shorter names must be purchased.
pub const MIN_FREE_ACCOUNT_NAME_LENGTH: usize = 8;

pub fn get_sender_app() -> Result<AccountNumber, Error> {
    let sender_string = Client::get_sender();
    AccountNumber::from_str(&sender_string).map_err(|_| InvalidAccountNumber.into())
}

pub fn validate_account_name(account_name: &str) -> Result<(), Error> {
    if account_name.len() < MIN_FREE_ACCOUNT_NAME_LENGTH {
        return Err(
            AccountNameTooShort(account_name.to_string(), MIN_FREE_ACCOUNT_NAME_LENGTH).into(),
        );
    }
    Ok(())
}
