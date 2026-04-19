use std::str::FromStr;

use crate::bindings::host::common::client::{self as Client};
use crate::errors::ErrorType;
use psibase::AccountNumber;

pub fn parse_accounts_to_ranks(
    mut users: Vec<AccountNumber>,
    ranking_set: Vec<AccountNumber>,
) -> Vec<u8> {
    users.sort_by_key(|user| user.value);

    ranking_set
        .into_iter()
        .map(|account| users.iter().position(|x| *x == account).unwrap() as u8)
        .collect()
}

pub fn get_sender_app() -> Result<AccountNumber, ErrorType> {
    let sender_string = Client::get_sender();
    AccountNumber::from_str(&sender_string).map_err(|_| ErrorType::InvalidAccountNumber)
}
