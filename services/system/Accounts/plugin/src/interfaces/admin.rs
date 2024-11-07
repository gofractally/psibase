use crate::plugin::AccountsPlugin;

use crate::bindings::exports::accounts::plugin::admin::{AppDetails, Guest as Admin};
use crate::bindings::exports::accounts::plugin::api::Guest as API;
use crate::bindings::host::common::client as Client;
use crate::connection_token::*;
use crate::db::apps_table::*;
use crate::helpers::*;

// Asserts that the caller is the active app, and that it's the `accounts` app.
fn assert_caller_admin() {
    let caller = get_assert_top_level_app("admin interface", &vec![]).unwrap();
    assert!(
        caller.origin == Client::my_service_origin(),
        "login_direct only callable by `accounts`"
    );
}

impl Admin for AccountsPlugin {
    fn login_direct(app: AppDetails, user: String) {
        assert_caller_admin();

        // Verify specified user is valid
        let account_details =
            AccountsPlugin::get_account(user.to_string()).expect("Get account failed");
        assert!(account_details.is_some(), "Invalid account name");

        AppsTable::new(&app).login(user);
    }

    fn decode_connection_token(token: String) -> Option<AppDetails> {
        assert_caller_admin();

        ConnectionToken::from_str(&token).map(|t| AppDetails {
            origin: t.origin,
            app: t.app,
        })
    }

    fn get_connected_apps() -> Vec<String> {
        let caller = get_assert_top_level_app("admin interface", &vec![]).unwrap();
        assert!(
            caller.app.is_some() && caller.app.unwrap() == "homepage",
            "get_connected_apps only callable by `homepage`"
        );
        AppsTable::get_connected_apps()
    }
}
