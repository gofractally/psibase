use crate::bindings::exports::accounts::plugin::api::{Guest as API, *};
use crate::bindings::host::common::{client as Client, server as Server};
use crate::bindings::host::privileged::intf as Privileged;
use crate::db::*;
use crate::errors::ErrorType::*;
use crate::plugin::AccountsPlugin;

use psibase::AccountNumber;
use psibase::services::accounts as AccountsService;
use psibase::fracpack::Pack;
use serde::Deserialize;
use crate::bindings::transact::plugin::intf as Transact;

#[derive(Deserialize, Debug)]
struct ResponseRoot {
    data: Data,
}

#[allow(non_snake_case)]
#[derive(Deserialize, Debug)]
struct Data {
    getAccount: Option<AccountsService::Account>,
}

impl API for AccountsPlugin {
    fn is_logged_in() -> bool {
        AppsTable::new(Privileged::get_active_app_domain()).get_logged_in_user().is_some()
    }

    fn get_account(name: String) -> Result<Option<Account>, Error> {
        let acct_num = AccountNumber::from_exact(&name).map_err(|err| InvalidAccountName.err(err.to_string().as_str()))?;

        let query = format!(
            "query {{ getAccount(account: \"{}\") {{ accountNum, authService, resourceBalance }} }}",
            acct_num 
        );

        let response_str = Server::post_graphql_get_json(&query).map_err(|e| QueryError.err(&e.message))?;
        let response_root = serde_json::from_str::<ResponseRoot>(&response_str).map_err(|e| QueryError.err(&e.to_string()))?;

        match response_root.data.getAccount {
            Some(acct_val) => {
                Ok(Some(Account {
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

    fn set_auth_service(service_name: String) -> Result<(), Error> {
        // Restrict to "homepage" app for now
        if Client::get_sender_app().app.is_none() || Client::get_sender_app().app.as_ref().unwrap() != "homepage" {
            return Err(Unauthorized.err("set_auth_service can only be called by the homepage app"));
        }

        let account_num: AccountNumber = AccountNumber::from_exact(&service_name)
            .map_err(|_| InvalidAccountName.err(&service_name))?;
        Transact::add_action_to_transaction(
            "setAuthServ",
            &AccountsService::action_structs::setAuthServ {
                authService: account_num,
            }
            .packed(),
        )?;
        Ok(())
    }
}
