#[allow(warnings)]
mod bindings;

use bindings::common::plugin::server as Server;
use bindings::common::plugin::types as CommonTypes;
use bindings::exports::account_sys::plugin::accounts::Guest as Accounts;
use fracpack::Pack;
use psibase::services::account_sys as AccountsService;
use psibase::AccountNumber;

mod errors;
use errors::ErrorType::*;

struct AccountsPlugin;

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
