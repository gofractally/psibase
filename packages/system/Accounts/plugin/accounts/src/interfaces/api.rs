use crate::bindings::exports::accounts::plugin::api::{Guest as API, *};
use crate::bindings::host::common::{client as Client, server as Server};
use crate::bindings::transact::plugin::intf as Transact;
use crate::errors::ErrorType::*;
use crate::plugin::AccountsPlugin;
use crate::db::apps_table::*;

use psibase::AccountNumber;
use psibase::services::accounts as AccountsService;
use psibase::fracpack::Pack;
use serde::Deserialize;
use crate::trust::*;

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
        Self::get_current_user().is_some()
    }

    fn get_account(name: String) -> Result<Option<Account>, Error> {
        let acct_num = AccountNumber::from_exact(&name).map_err(|err| InvalidAccountName(err.to_string()))?;

        let query = format!(
            "query {{ getAccount(accountName: \"{}\") {{ accountNum, authService, resourceBalance {{ value }} }} }}",
            acct_num 
        );

        let response_str = Server::post_graphql_get_json(&query).map_err(|e| QueryError(e.message))?;
        let response_root = serde_json::from_str::<ResponseRoot>(&response_str).map_err(|e| QueryError(e.to_string()))?;

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
        assert_authorized_with_whitelist(FunctionName::set_auth_service, vec!["homepage".into()])?;

        let account_num: AccountNumber = AccountNumber::from_exact(&service_name)
            .map_err(|_| InvalidAccountName(service_name))?;
        Transact::add_action_to_transaction(
            "setAuthServ",
            &AccountsService::action_structs::setAuthServ {
                authService: account_num,
            }
            .packed(),
        )?;
        Ok(())
    }

    fn get_current_user() -> Option<String> {
        AppsTable::new(&Client::get_active_app()).get_logged_in_user()
    }
}
