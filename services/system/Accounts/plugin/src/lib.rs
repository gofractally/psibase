#[allow(warnings)]
mod bindings;

use bindings::clientdata::plugin::keyvalue as Keyvalue;
use bindings::exports::accounts::plugin::accounts::Guest as Accounts;
use bindings::host::common::{server as Server, types as CommonTypes};
use psibase::fracpack::Pack;
use psibase::services::accounts as AccountsService;
use psibase::AccountNumber;

mod errors;
use errors::ErrorType::*;

struct AccountsPlugin;

/****** Database
[
    {
        key: "logged-in",
        description: "Account name of currently logged in user"
    },
]
******/

fn from_utf8(bytes: Vec<u8>, error: &str) -> Result<String, CommonTypes::Error> {
    String::from_utf8(bytes).map_err(|_| Deserialization.err(error))
}

impl Accounts for AccountsPlugin {
    fn login() -> Result<(), CommonTypes::Error> {
        println!("Login with popup window not yet supported.");
        return Err(NotYetImplemented.err("login"));
    }

    fn login_temp(user: String) -> Result<(), CommonTypes::Error> {
        Keyvalue::set("logged-in", &user.as_bytes())?;
        Ok(())
    }

    fn get_logged_in_user() -> Result<Option<String>, CommonTypes::Error> {
        if let Some(user) = Keyvalue::get("logged-in")? {
            Ok(Some(from_utf8(user, "key: logged-in")?))
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
