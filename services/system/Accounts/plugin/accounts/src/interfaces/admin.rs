use crate::plugin::AccountsPlugin;

use crate::bindings::accounts::account_tokens::api::*;
use crate::bindings::exports::accounts::plugin::admin::{AppDetails, Guest as Admin};
use crate::bindings::exports::accounts::plugin::api::Guest as API;
use crate::bindings::host::common::client::{self as Client, OriginationData};
use crate::db::apps_table::*;
use crate::db::user_table::*;
use crate::helpers::*;

// Asserts that the caller is the active app, and that it's the `accounts` app.
fn get_assert_caller_admin(context: &str) -> OriginationData {
    let caller = get_assert_top_level_app("admin interface", &vec![]).unwrap();
    assert!(
        caller.origin == Client::my_service_origin()
            || (caller.app.is_some() && caller.app.as_ref().unwrap() == "x-admin"),
        "{} only callable by `accounts` or `x-admin`",
        context
    );
    caller
}

fn assert_caller_admin(context: &str) {
    let _ = get_assert_caller_admin(context);
}

fn get_accounts_app() -> OriginationData {
    OriginationData {
        app: Some(Client::my_service_account()),
        origin: Client::my_service_origin(),
    }
}

fn assert_valid_account(account: &str) {
    let account_details =
        AccountsPlugin::get_account(account.to_string()).expect("Get account failed");
    assert!(account_details.is_some(), "Invalid account name");
}

impl Admin for AccountsPlugin {
    fn login_direct(app: AppDetails, user: String) {
        assert_caller_admin("login_direct");

        assert_valid_account(&user);

        AppsTable::new(&app).login(&user);
        UserTable::new(&user).add_connected_app(&app);
    }

    fn decode_connection_token(token: String) -> Option<AppDetails> {
        assert_caller_admin("decode_connection_token");

        if let Some(token) = deserialize_token(&token) {
            match token {
                Token::ConnectionToken(t) => return Some(t),
                _ => None,
            }
        } else {
            None
        }
    }

    fn get_connected_apps(user: String) -> Vec<String> {
        let caller = get_assert_top_level_app("admin interface", &vec![]).unwrap();
        assert!(
            caller.app.is_some() && caller.app.unwrap() == "homepage",
            "get_connected_apps only callable by `homepage`"
        );
        UserTable::new(&user).get_connected_apps()
    }

    fn import_account(account: String) {
        assert_caller_admin("import_account");
        assert_valid_account(&account);
        AppsTable::new(&get_accounts_app()).connect(&account);
    }

    fn get_all_accounts() -> Vec<String> {
        assert_caller_admin("get_all_accounts");
        AppsTable::new(&get_accounts_app()).get_connected_accounts()
    }
}
