use crate::plugin::AccountsPlugin;

use crate::bindings::exports::accounts::plugin::admin::{AppDetails, Guest as Admin};
use crate::bindings::exports::accounts::plugin::api::Guest as API;
use crate::bindings::host::common::client as Client;

use crate::db::*;
use crate::helpers::*;

impl Admin for AccountsPlugin {
    fn login_direct(app: String, user: String) {
        let caller_domain = get_assert_top_level_app("login_direct", &vec![]).unwrap();
        assert!(
            caller_domain == Client::my_service_origin(),
            "login_direct only callable by `accounts`"
        );

        // Verify specified app is a valid account
        let account_details =
            AccountsPlugin::get_account(app.to_string()).expect("Get account failed");
        assert!(account_details.is_some(), "Invalid account name");

        let app_domain = sibling_url_of(&app, &caller_domain).expect("Invalid app domain");
        AppsTable::new(app_domain).login(user);
    }

    fn decode_connection_token(token: String) -> Option<AppDetails> {
        if let Some(token) = TokensTable::new().decode(&token) {
            Some(AppDetails {
                origin: token.app_origin,
                app: token.app,
            })
        } else {
            None
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_sibling_url() {
        let result = sibling_url_of("app1", "https://accounts.psibase.io:8080");

        assert!(result.is_ok(), "Failed to get sibling URL");
        assert_eq!(
            result.unwrap(),
            "app1.psibase.io:8080",
            "Invalid sibling URL"
        );
    }
}
