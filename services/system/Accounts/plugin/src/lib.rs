#[allow(warnings)]
mod bindings;

use base64::{engine::general_purpose::URL_SAFE, Engine};
use bindings::clientdata::plugin::keyvalue as Keyvalue;
use bindings::exports::accounts::plugin::accounts::Guest as Accounts;
use bindings::exports::accounts::plugin::admin::Guest as Admin;
use bindings::host::common::{client as Client, server as Server, types as CommonTypes};
use psibase::fracpack::Pack;
use psibase::services::accounts as AccountsService;
use psibase::AccountNumber;

extern crate url;
use url::Url;

mod errors;
use errors::ErrorType::*;

struct AccountsPlugin;

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
impl Admin for AccountsPlugin {
    fn get_logged_in_user(domain: String) -> Result<Option<String>, CommonTypes::Error> {
        let sender = Client::get_sender_app().app;
        if sender.is_none() || sender.unwrap() != "supervisor" {
            return Err(Unauthorized.err("get_logged_in_user"));
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
        Keyvalue::set(&login_key(origin), &user.as_bytes())?;
        Ok(())
    }

    fn get_available_accounts() -> Result<Vec<String>, CommonTypes::Error> {
        Ok(vec!["alice".to_string(), "bob".to_string()])
    }

    fn add_auth_service(_: String) -> Result<(), CommonTypes::Error> {
        Err(NotYetImplemented.err("add_auth_service"))
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
