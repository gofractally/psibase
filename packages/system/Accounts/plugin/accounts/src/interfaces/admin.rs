use serde::Deserialize;

use crate::bindings::host::common::server::post_graphql_get_json;
use crate::errors::ErrorType::*;
use crate::plugin::AccountsPlugin;

use crate::bindings::accounts::account_tokens::{api::*, types::ConnectionToken};
use crate::bindings::exports::accounts::plugin::admin::Guest as Admin;
use crate::bindings::exports::accounts::plugin::api::*;
use crate::bindings::host::auth::api as HostAuth;
use crate::bindings::host::common::client as Client;
use crate::db::apps_table::*;
use crate::db::user_table::*;
use crate::helpers::*;
use std::collections::HashSet;

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

fn prune_invalid_accounts(accounts: Vec<String>) {
    let app = AppsTable::new(&Client::get_receiver());
    for account in accounts {
        app.disconnect(&account);
    }
}

impl Admin for AccountsPlugin {
    fn login_direct(app: String, user: String) {
        assert_caller_admin("login_direct");

        println!("WARNING: login_direct is deprecated");

        assert_valid_account(&user);

        // We want to authenticate as the user who is logging in to the 3rd-party app.
        // So we need to log in as this user in accounts because accounts is the active app
        // (because we redirected to accounts to do the login).
        AppsTable::new(&Client::get_receiver()).login(&user);

        AppsTable::new(&app).login(&user);
        UserTable::new(&user).add_connected_app(&app);

        if HostAuth::set_logged_in_user(&user, &app).is_err() {
            AppsTable::new(&app).logout();
            UserTable::new(&user).remove_connected_app(&app);
        }

        // Logging out to reverse accounts login above
        AppsTable::new(&Client::get_receiver()).logout();
    }

    fn decode_connection_token(token: String) -> Option<ConnectionToken> {
        assert_caller_admin("decode_connection_token");

        println!("WARNING: decode_connection_token is deprecated");

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
        let sender = Client::get_sender();
        assert!(sender == Client::get_receiver() || sender == "supervisor");
        AppsTable::new(&Client::get_receiver()).get_connected_accounts()
    }

    fn get_auth_services() -> Result<Vec<String>, Error> {
        assert!(
            Client::get_sender() == "supervisor",
            "{} only callable by `supervisor`",
            "get_auth_services()"
        );

        let connected_accounts = Self::get_all_accounts();
        let accounts = connected_accounts
            .iter()
            .map(|a| format!("\"{}\"", a))
            .collect::<Vec<String>>()
            .join(",");
        let graphql_query = format!(
            "query {{
                getAccounts(accountNames: [{}]) {{
                    accountNum,
                    authService
                }}
            }}",
            accounts
        );

        #[derive(Deserialize, Debug)]
        struct ResponseRoot {
            data: Data,
        }

        #[allow(non_snake_case)]
        #[derive(Deserialize, Debug)]
        struct Data {
            getAccounts: Vec<Option<Accnt>>,
        }

        #[allow(non_snake_case)]
        #[derive(Deserialize, Debug)]
        struct Accnt {
            accountNum: String,
            authService: String,
        }

        let auth_services_res = post_graphql_get_json(&graphql_query)?;
        let response_root = serde_json::from_str::<ResponseRoot>(&auth_services_res)
            .map_err(|e| DeserializationError(e.to_string()))?;

        let valid_account_nums: HashSet<String> = response_root
            .data
            .getAccounts
            .iter()
            .filter_map(|opt_acc| opt_acc.as_ref().map(|accnt| accnt.accountNum.clone()))
            .collect();

        let invalid_accounts: Vec<String> = connected_accounts
            .iter()
            .filter(|account| !valid_account_nums.contains(*account))
            .cloned()
            .collect();

        if !invalid_accounts.is_empty() {
            prune_invalid_accounts(invalid_accounts);
        }

        let auth_services: Vec<String> = response_root
            .data
            .getAccounts
            .into_iter()
            .filter_map(|opt_accnt| opt_accnt.map(|accnt| accnt.authService))
            .collect();
        Ok(auth_services)
    }
}
