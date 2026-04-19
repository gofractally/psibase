use std::str::FromStr;

use crate::bindings::host::common::client::{self as Client};
use crate::errors::ErrorType;
use psibase::AccountNumber;

pub fn get_sender_app() -> Result<AccountNumber, ErrorType> {
    let sender_string = Client::get_sender();
    AccountNumber::from_str(&sender_string).map_err(|_| ErrorType::InvalidAccountNumber)
}
