#[allow(warnings)]
mod bindings;

use bindings::exports::accounts::query::api::{Guest as API, Account};
use bindings::host::common::{client as Client, server as Server};
use bindings::host::db::store::{Bucket, Database, DbMode, StorageDuration};
use bindings::host::types::types::Error;
use psibase::plugin_error;
use psibase::services::accounts as AccountsService;
use psibase::AccountNumber;
use rand::prelude::*;
use serde::Deserialize;

plugin_error! {
    pub ErrorType
    InvalidAccountName(msg: String) => "Invalid account name: {msg}",
    QueryError(msg: String) => "Graphql query error: {msg}",
    MaxGenerationAttemptsExceeded() => "Max generation attempts exceeded",
    InvalidPrefix() => "Prefix must be a-z, 1 - 9 chars in length",
}

struct AccountsQuery;

fn logged_in_user_table() -> Bucket {
    Bucket::new(
        Database {
            mode: DbMode::NonTransactional,
            duration: StorageDuration::Persistent,
        },
        "logged_in_user",
    )
}

#[derive(Deserialize, Debug)]
struct ResponseRoot {
    data: Data,
}

#[allow(non_snake_case)]
#[derive(Deserialize, Debug)]
struct Data {
    getAccount: Option<AccountsService::Account>,
}

fn lookup_account(name: String) -> Result<Option<Account>, Error> {
    let acct_num = AccountNumber::from_exact(&name)
        .map_err(|err| ErrorType::InvalidAccountName(err.to_string()))?;

    let query = format!(
        "query {{ getAccount(accountName: \"{}\") {{ accountNum, authService, authSequence }} }}",
        acct_num
    );

    let response_str =
        Server::post_graphql_get_json(&query).map_err(|e| ErrorType::QueryError(e.message))?;
    let response_root = serde_json::from_str::<ResponseRoot>(&response_str)
        .map_err(|e| ErrorType::QueryError(e.to_string()))?;

    match response_root.data.getAccount {
        Some(acct_val) => Ok(Some(Account {
            account_num: acct_val.accountNum.to_string(),
            auth_service: acct_val.authService.to_string(),
        })),
        None => Ok(None),
    }
}

fn generate_account(prefix: Option<String>) -> Result<String, Error> {
    let mut rng = rand::rng();

    const MAX_TRIES: u16 = 1000;
    const LENGTH: u8 = 10;

    let first_chars: &[char] = &(b'a'..=b'z').map(|b| b as char).collect::<Vec<_>>();
    let allowed_chars: &[char] = &(b'a'..=b'z')
        .chain(b'0'..=b'9')
        .map(|b| b as char)
        .collect::<Vec<_>>();

    let starting_string = prefix.unwrap_or_default();

    let starts_with_x = starting_string.starts_with("x-");
    let is_invalid_length = starting_string.len() > 9;
    let is_valid_chars = starting_string.chars().enumerate().all(|(index, char)| {
        if index == 0 {
            first_chars.contains(&char)
        } else {
            allowed_chars.contains(&char) || char == '-'
        }
    });
    if is_invalid_length || !is_valid_chars || starts_with_x {
        return Err(ErrorType::InvalidPrefix().into());
    }

    for _ in 0..MAX_TRIES {
        let mut account = starting_string.clone();
        if account.is_empty() {
            account.push(*first_chars.choose(&mut rng).unwrap());
        }
        let remaining_chars = LENGTH - account.len() as u8;

        for _ in 0..remaining_chars {
            account.push(*allowed_chars.choose(&mut rng).unwrap());
        }

        if let Ok(None) = lookup_account(account.clone()) {
            return Ok(account);
        }
    }
    Err(ErrorType::MaxGenerationAttemptsExceeded().into())
}

impl API for AccountsQuery {
    fn is_logged_in() -> bool {
        Self::get_current_user().is_some()
    }

    fn get_account(name: String) -> Result<Option<Account>, Error> {
        lookup_account(name)
    }

    fn get_current_user() -> Option<String> {
        logged_in_user_table()
            .get(&Client::get_active_app())
            .map(|a| String::from_utf8(a).unwrap())
    }

    fn gen_rand_account(prefix: Option<String>) -> Result<String, Error> {
        generate_account(prefix)
    }
}

bindings::export!(AccountsQuery with_types_in bindings);
