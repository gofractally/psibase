#[allow(warnings)]
mod bindings;

use bindings::accounts::plugin::types as AccountTypes;
use bindings::exports::accounts::plugin::accounts::Guest as Accounts;
use bindings::host::common::{server as Server, types as CommonTypes};
use psibase::fracpack::Pack;
use psibase::services::accounts as AccountsService;
use psibase::AccountNumber;

use serde::Deserialize;

mod errors;
use errors::ErrorType::*;

struct AccountsPlugin;

#[derive(Deserialize, Debug)]
struct ResponseRoot {
    data: Data,
}

// #[derive(Deserialize, Debug)]
// struct Account {
//     accountNum: AccountNumber,
//     authService: AccountNumber,
// }

#[allow(non_snake_case)]
#[derive(Deserialize, Debug)]
struct Data {
    // getAccount: Option<AccountTypes::Account>,
    getAccount: Option<AccountsService::Account>,
}

impl Accounts for AccountsPlugin {
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
        let query = format!(
            "query {{ getAccount(account: \"{}\") {{ accountNum, authService, resourceBalance }} }}",
            AccountNumber::from(name.as_str())
        );
        println!("get_account; query: {}", query);

        let account_result = Server::post_graphql_get_json(&query)
            .map_err(|e| QueryError.err(&e.message))
            .and_then(|result| {
                serde_json::from_str(&result).map_err(|e| QueryError.err(&e.to_string()))
            });

        println!("got here 1");
        println!("{:#?}", account_result);
        let account = account_result.and_then(|response_root: ResponseRoot| {
            println!("got here 2");
            response_root
                .data
                .getAccount
                .ok_or_else(|| InvalidAccountNumber.err(&name))
        })?;

        if account.accountNum.value != AccountNumber::from_exact(&name).unwrap().value {
            return Err(InvalidAccountNumber.err(&name));
        } else {
            return Ok(Some(AccountTypes::Account {
                account_num: AccountTypes::AccountNumber {
                    value: account.accountNum.value,
                },
                auth_service: AccountTypes::AccountNumber {
                    value: account.authService.value,
                },
                resource_balance: Some(AccountTypes::ResourceLimit {
                    value: account.resourceBalance.unwrap().value,
                }),
            }));
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
