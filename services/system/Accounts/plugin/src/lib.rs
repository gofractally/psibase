#[allow(warnings)]
mod bindings;

use base64::{engine::general_purpose::URL_SAFE, Engine};
use bindings::clientdata::plugin::keyvalue as Keyvalue;
use bindings::exports::accounts::plugin::accounts::Guest as Accounts;
use bindings::host::common::{client as Client, types as CommonTypes, server as Server};
use bindings::host::privileged::intf as Privileged;
use bindings::transact::plugin::intf as Transact;
use bindings::accounts::plugin::types::{self as AccountTypes};
use psibase::fracpack::Pack;
use psibase::services::accounts::{self as AccountsService};
use psibase::AccountNumber;
use url::Url;
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

/****** Database
[
    {
        key: "logged-in.<base64_app_domain>",
        description: "Account name of currently logged in user"
    },
]
******/

fn login_key(origin: String) -> String {
    // Do not namespace logged-in user by protocol
    let url = Url::parse(&origin).unwrap();
    let mut origin = url.domain().unwrap().to_string();
    if let Some(port) = url.port() {
        origin += ":";
        origin += &port.to_string();
    }

    // Encode the origin as base64, URL_SAFE character set
    let encoded = URL_SAFE.encode(origin);

    // Construct the key. The logged-in user is namespaced by origin
    let key_pre: String = "logged-in".to_string();
    return key_pre + "." + &encoded;
}

impl Accounts for AccountsPlugin {
    fn login() -> Result<(), CommonTypes::Error> {
        println!("Login with popup window not yet supported.");
        return Err(NotYetImplemented.err("login"));
    }

    fn logout() -> Result<(), CommonTypes::Error> {
        let origin = Client::get_sender_app().origin;
        let top_level_domain = Privileged::get_active_app_domain();

        if origin == top_level_domain {
            Keyvalue::delete(&login_key(origin));
        } else {
            return Err(Unauthorized.err("logout can only be called by the top-level app domain"));
        }

        Ok(())
    }

    fn login_temp(user: String) -> Result<(), CommonTypes::Error> {
        let origin = Client::get_sender_app().origin;
        let top_level_domain = Privileged::get_active_app_domain();

        if origin != top_level_domain {
            return Err(Unauthorized.err("login-temp can only be called by the top-level app domain"));
        }

        Keyvalue::set(&login_key(top_level_domain), &user.as_bytes()).expect("Failed to set logged-in user");

        Ok(())
    }

    fn is_logged_in() -> bool {
        let active_domain = Privileged::get_active_app_domain();
        Keyvalue::get(&login_key(active_domain)).is_some()
    }

    fn get_logged_in_user() -> Result<Option<String>, CommonTypes::Error> {
        let sender =Client::get_sender_app();
        let active_domain = Privileged::get_active_app_domain();
        let sender_domain = sender.origin;

        if sender_domain != active_domain {
            if let Some(sender_app) = sender.app
            {
                if sender_app != "supervisor" && sender_app != "transact" {
                    return Err(Unauthorized.err("Only callable by the top-level app domain"));
                }
            } else {
                return Err(Unauthorized.err("Only callable by the top-level app domain"));
            }
        }

        if let Some(user) = Keyvalue::get(&login_key(active_domain)) {
            Ok(Some(String::from_utf8(user).unwrap()))
        } else {
            Ok(None)
        }
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

bindings::export!(AccountsPlugin with_types_in bindings);
