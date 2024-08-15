#[allow(warnings)]
mod bindings;

use base64::{engine::general_purpose::URL_SAFE, Engine};
use bindings::clientdata::plugin::keyvalue as Keyvalue;
use bindings::exports::accounts::plugin::accounts::Guest as Accounts;
use bindings::exports::accounts::plugin::admin::Guest as Admin;
use bindings::host::common::{client as Client, types as CommonTypes, server as Server};
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

fn from_supervisor() -> bool {
    Client::get_sender_app()
        .app
        .map_or(false, |app| app == "supervisor")
}

impl Admin for AccountsPlugin {
    fn force_login(domain: String, user: String) {
        assert!(from_supervisor(), "unauthorized");
        Keyvalue::set(&login_key(domain), &user.as_bytes()).expect("Failed to set logged-in user");
    }

    fn get_logged_in_user(caller_app: String, domain: String) -> Result<Option<String>, CommonTypes::Error> {
        let sender = Client::get_sender_app().app;
        assert!(
            sender.is_some() && sender.as_ref().unwrap() == "supervisor",
            "unauthorized"
        );

        // Todo: Allow other apps to ask for the logged in user by popping up an authorization window.
        if caller_app != "transact" && caller_app != "supervisor" {
            return Err(Unauthorized.err("Temporarily, only transact can ask for the logged-in user."));
        }

        if let Some(user) = Keyvalue::get(&login_key(domain)) {
            Ok(Some(String::from_utf8(user).unwrap()))
        } else {
            Ok(None)
        }
    }
}

impl Accounts for AccountsPlugin {
    fn login() -> Result<(), CommonTypes::Error> {
        println!("Login with popup window not yet supported.");
        return Err(NotYetImplemented.err("login"));
    }

    fn login_temp(user: String) -> Result<(), CommonTypes::Error> {
        let origin = Client::get_sender_app().origin;

        Client::login_temp(&origin, &user)?;
        Ok(())
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
