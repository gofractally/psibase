use crate::apps_table::AppsTable;
use crate::bindings::host::common::{client as Client, server as Server};
use crate::bindings::host::types::types::Error;
use crate::errors::ErrorType::*;
use psibase::AccountNumber;
use serde::Deserialize;

#[derive(Deserialize, Debug)]
struct ResponseRoot {
    data: Data,
}

#[allow(non_snake_case)]
#[derive(Deserialize, Debug)]
struct Data {
    getAccount: Option<AccountRow>,
}

#[allow(non_snake_case)]
#[derive(Deserialize, Debug)]
struct AccountRow {
    authService: String,
}

pub struct Account {
    pub auth_service: String,
}

pub fn is_logged_in() -> bool {
    AppsTable::new(&Client::get_active_app())
        .get_logged_in_user()
        .is_some()
}

pub fn get_account(name: String) -> Result<Option<Account>, Error> {
    let acct_num =
        AccountNumber::from_exact(&name).map_err(|err| InvalidAccountName(err.to_string()))?;

    let query = format!(
        "query {{ getAccount(accountName: \"{}\") {{ accountNum, authService, authSequence }} }}",
        acct_num
    );

    let response_str = Server::post_graphql_get_json(&query).map_err(|e| QueryError(e.message))?;
    let response_root = serde_json::from_str::<ResponseRoot>(&response_str)
        .map_err(|e| QueryError(e.to_string()))?;

    match response_root.data.getAccount {
        Some(acct_val) => Ok(Some(Account {
            auth_service: acct_val.authService,
        })),
        None => Ok(None),
    }
}
