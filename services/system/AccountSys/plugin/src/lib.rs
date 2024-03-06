#[allow(warnings)]
mod bindings;

use bindings::exports::accounts::plugin::accounts::Guest;

struct AccountsPlugin;

impl Guest for AccountsPlugin {
    fn get_logged_in_user() -> Result<Option<String>, String> { 
        Ok(Some("alice".to_string()))
    }

    fn get_available_accounts() -> Result<Vec<String>, String> { 
        Ok(vec!["alice".to_string(), "bob".to_string()])
    }

    fn add_auth_service(_: String) -> Result<(), String> { 
        Err("Not yet implemented".to_string())
    }
}

bindings::export!(AccountsPlugin with_types_in bindings);
