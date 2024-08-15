#[allow(warnings)]
mod bindings;

use bindings::accounts::plugin::types::{self as AccountTypes};
use bindings::exports::accounts::plugin::accounts::Guest as AccountsApi;
use bindings::host::common::{server as Server, types as CommonTypes};
use psibase::fracpack::Pack;
use psibase::services::accounts::{self as AccountsService};
use psibase::AccountNumber;

use serde::Deserialize;

mod errors;
use errors::ErrorType::*;

struct AccountsPlugin;

#[derive(Deserialize, Debug)]
struct ResponseRoot {
    data: Data,
}

#[allow(non_snake_case)]
#[derive(Deserialize, Debug)]
struct Data {
    getAccount: Option<AccountsService::Account>,
}

impl AccountsApi for AccountsPlugin {
    fn login() -> Result<(), CommonTypes::Error> {
        return Err(NotYetImplemented.err("login"));
    }

    fn get_logged_in_user() -> Result<Option<String>, CommonTypes::Error> {
        Ok(Some("alice".to_string()))
    }

    fn get_available_accounts() -> Result<Vec<String>, CommonTypes::Error> {
        Ok(vec!["alice".to_string(), "bob".to_string()])
    }

    fn add_auth_service(_: String) -> Result<(), CommonTypes::Error> {
        Err(NotYetImplemented.err("add_auth_service"))
    }

    fn get_account(name: String) -> Result<Option<AccountTypes::Account>, CommonTypes::Error> {
        let acct_num = AccountNumber::from_exact(&name).map_err(|err| InvalidAccountName.err(err.to_string().as_str()))?;

        let query = format!(
            "query {{ getAccount(account: \"{}\") {{ accountNum, authService, resourceBalance }} }}",
            acct_num 
        );

        let response_str = Server::post_graphql_get_json(&query).map_err(|e| QueryError.err(&e.message))?;
        let response_root = serde_json::from_str::<ResponseRoot>(&response_str).map_err(|e| QueryError.err(&e.to_string()))?;

        match response_root.data.getAccount {
            Some(acct_val) => {
                Ok(Some(AccountTypes::Account {
                    account_num: acct_val.accountNum.to_string(),
                    auth_service: acct_val.authService.to_string(),
                    resource_balance: Some(match acct_val.resourceBalance {
                        Some(val) => val.value,
                        None => 0,
                    }),
                }))
            },
            None => Ok(None)
        }
    }

    fn set_auth_service(service_name: String) -> Result<(), CommonTypes::Error> {
        let account_num: AccountNumber = AccountNumber::from_exact(&service_name)
            .map_err(|_| InvalidAccountName.err(&service_name))?;
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
