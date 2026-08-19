use std::str::FromStr;

use crate::errors::ErrorType;
use crate::graphql::guild::get_guild;
use psibase::AccountNumber;
use psibase_plugin::host::client as Client;
use psibase_plugin::types::Error;

pub fn get_sender_app() -> Result<AccountNumber, ErrorType> {
    let sender_string = Client::get_sender();
    AccountNumber::from_str(&sender_string).map_err(|_| ErrorType::InvalidAccountNumber)
}

pub fn parent_fractal(guild: &str) -> Result<String, Error> {
    Ok(get_guild(guild)?.fractal.to_string())
}

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
