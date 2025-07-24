use crate::plugin::AccountsPlugin;

use crate::bindings::accounts::account_tokens::{api::*, types::ConnectionToken};
use crate::bindings::exports::accounts::plugin::admin::Guest as Admin;
use crate::bindings::exports::accounts::plugin::api::Guest as API;
use crate::bindings::host::common::client as Client;
use crate::bindings::transact::plugin::auth as TransactAuthApi;
use crate::db::apps_table::*;
use crate::db::user_table::*;
use crate::helpers::*;

// Asserts that the caller is the active app, and that it's the `accounts` app.
fn get_assert_caller_admin(context: &str) -> String {
    let caller = get_assert_top_level_app("admin interface", &vec![]).unwrap();
    assert!(
        caller == Client::get_receiver() || caller == "x-admin",
        "{} only callable by `accounts` or `x-admin`",
        context
    );
    caller
}

fn assert_caller_admin(context: &str) {
    let _ = get_assert_caller_admin(context);
}

fn assert_valid_account(account: &str) {
    let account_details =
        AccountsPlugin::get_account(account.to_string()).expect("Get account failed");
    assert!(account_details.is_some(), "Invalid account name");
}

impl Admin for AccountsPlugin {
    fn login_direct(app: String, user: String) -> Option<String> {
        assert_caller_admin("login_direct");

        assert_valid_account(&user);

        let query_token = TransactAuthApi::get_query_token(&Client::get_receiver(), &user).unwrap();

        AppsTable::new(&app).login(&user);
        UserTable::new(&user).add_connected_app(&app);

        Some(query_token)
    }

    fn decode_connection_token(token: String) -> Option<ConnectionToken> {
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
            caller == "homepage",
            "get_connected_apps only callable by `homepage`"
        );
        UserTable::new(&user).get_connected_apps()
    }

    fn import_account(account: String) {
        assert_caller_admin("import_account");
        assert_valid_account(&account);
        AppsTable::new(&Client::get_receiver()).connect(&account);
    }

    fn get_all_accounts() -> Vec<String> {
        assert_caller_admin("get_all_accounts");
        AppsTable::new(&Client::get_receiver()).get_connected_accounts()
    }
}
