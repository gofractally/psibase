#[allow(warnings)]
mod bindings;

use bindings::common::plugin::server as Server;
use bindings::common::plugin::types as CommonTypes;
use bindings::exports::accounts::plugin::accounts::Guest as Accounts;
use psibase::fracpack::Pack;
use psibase::services::accounts as AccountsService;
use psibase::AccountNumber;

use serde::Deserialize;

mod errors;
use errors::ErrorType::*;

struct AccountsPlugin;

#[derive(Deserialize)]
struct ResourceLimit {
    value: String,
}

#[allow(non_snake_case)]
#[derive(Deserialize)]
struct Account {
    accountNum: String,
    authService: String,
    resourceBalance: ResourceLimit,
}

#[derive(Deserialize)]
struct ResponseRoot {
    data: Data,
}

#[allow(non_snake_case)]
#[derive(Deserialize)]
struct Data {
    getAccount: Option<Account>,
}

impl Accounts for AccountsPlugin {
    fn get_logged_in_user() -> Result<Option<String>, CommonTypes::Error> {
        Ok(Some("alice".to_string()))
    }

    fn get_available_accounts() -> Result<Vec<String>, CommonTypes::Error> {
        Ok(vec!["alice".to_string(), "bob".to_string()])
    }

    fn add_auth_service(_: String) -> Result<(), CommonTypes::Error> {
        Err(NotYetImplemented.err("add_auth_service"))
    }

    fn get_account(name: String) -> Result<String, CommonTypes::Error> {
        let query = format!(
            r#"query {{
                getAccount(account: "{acctName}") {{
                    pubkey,
                    inviter
                }}
            }}"#,
            acctName = name
        );

        let account = Server::post_graphql_get_json(&query)
            .map_err(|e| QueryError.err(&e.message))
            .and_then(|result| {
                serde_json::from_str(&result).map_err(|e| QueryError.err(&e.to_string()))
            })
            .and_then(|response_root: ResponseRoot| {
                response_root
                    .data
                    .getAccount
                    .ok_or_else(|| QueryError.err("Error querying subject account"))
            })?;

        if name != account.accountNum {
            return Err(InvalidAccountNumber.err(&name));
        } else {
            return Ok(account.accountNum);
        }
    }

    fn set_auth_service(service_name: String) -> Result<(), CommonTypes::Error> {
        let account_num: AccountNumber = AccountNumber::from_exact(&service_name)
            .map_err(|_| InvalidAccountNumber.err(&service_name))?;
        Server::add_action_to_transaction(
            "setAuthServ",
            &AccountsService::action_structs::setAuthServ {
                authService: account_num,
            }
            .packed(),
        )?;
        Ok(())
    }
}

bindings::export!(AccountsPlugin with_types_in bindings);
