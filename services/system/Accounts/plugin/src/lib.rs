#[allow(warnings)]
mod bindings;

use bindings::common::plugin::types as CommonTypes;
use bindings::exports::accounts::plugin::accounts::Guest as Accounts;

struct AccountsPlugin;

impl Accounts for AccountsPlugin {
    fn get_logged_in_user() -> Result<Option<String>, CommonTypes::Error> {
        Ok(Some("alice".to_string()))
    }

    fn get_available_accounts() -> Result<Vec<String>, CommonTypes::Error> {
        Ok(vec!["alice".to_string(), "bob".to_string()])
    }

    fn add_auth_service(_: String) -> Result<(), CommonTypes::Error> {
        Err(CommonTypes::Error {
            code: 0,
            producer: CommonTypes::PluginId {
                service: String::from("accounts"),
                plugin: "plugin".to_string(),
            },
            message: "Function not yet implemented".to_string(),
        })
    }
}

bindings::export!(AccountsPlugin with_types_in bindings);
