use std::str::FromStr;

use crate::errors::ErrorType::*;
use psibase::AccountNumber;
use psibase_plugin::{host::client as Client, Error};

pub fn get_sender_app() -> Result<AccountNumber, Error> {
    let sender_string = Client::get_sender();
    AccountNumber::from_str(&sender_string).map_err(|_| InvalidAccountNumber.into())
}

pub fn validate_account_name(account_name: &str) -> Result<(), Error> {
    if account_name.len() < 10 {
        return Err(AccountNameTooShort(account_name.to_string()).into());
    }
    Ok(())
}
