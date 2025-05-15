use std::time::{SystemTime, UNIX_EPOCH};

use crate::bindings;
use crate::errors::ErrorType;
use psibase::AccountNumber;

use crate::bindings::host::common::types::Error;

pub fn parse_account_number(s: &str) -> Result<AccountNumber, Error> {
    AccountNumber::from_exact(s).map_err(|_| ErrorType::InvalidAccountNumber.into())
}

pub fn parse_proposal(proposal: &[String]) -> Result<Vec<u8>, Error> {
    let parsed = proposal
        .iter()
        .map(|p| {
            p.parse::<u8>()
                .map_err(|_| ErrorType::InvalidProposal.into())
        })
        .collect::<Result<Vec<u8>, Error>>()?;

    Ok(parsed)
}

pub fn current_user() -> Result<AccountNumber, Error> {
    let current_user = bindings::accounts::plugin::api::get_current_user()?;
    let current_user = current_user.ok_or(ErrorType::NotLoggedIn)?;
    Ok(parse_account_number(&current_user)?)
}

pub fn get_current_time() -> u32 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_secs() as u32
}
