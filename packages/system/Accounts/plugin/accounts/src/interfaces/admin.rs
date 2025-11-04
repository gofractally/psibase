use serde::Deserialize;

use crate::bindings::host::common::server::post_graphql_get_json;
use crate::errors::ErrorType::*;
use crate::plugin::AccountsPlugin;

use crate::bindings::accounts::account_tokens::{api::*, types::ConnectionToken};
use crate::bindings::exports::accounts::plugin::active_app::Guest;
use crate::bindings::exports::accounts::plugin::admin::Guest as Admin;
use crate::bindings::exports::accounts::plugin::api::{Guest as API, *};
use crate::bindings::host::auth::api as HostAuth;
use crate::bindings::host::common::client as Client;
use crate::db::apps_table::*;
use crate::db::user_table::*;
use crate::helpers::*;
use crate::trust::*;

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
    fn login_direct(app: String, user: String) {
        assert_authorized_with_whitelist(FunctionName::login_direct, vec!["accounts".into()])
            .unwrap();

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
        assert_authorized_with_whitelist(FunctionName::get_connected_apps, vec!["homepage".into()])
            .unwrap();
        UserTable::new(&user).get_connected_apps()
    }

    fn import_account(account: String) {
        assert_authorized_with_whitelist(FunctionName::import_account, vec!["accounts".into()])
            .unwrap();
        assert_valid_account(&account);
        AppsTable::new(&Client::get_receiver()).connect(&account);
    }

    fn get_all_accounts() -> Vec<String> {
        assert_authorized_with_whitelist(
            FunctionName::get_all_accounts,
            vec!["accounts".into(), "supervisor".into()],
        )
        .unwrap();
        AppsTable::new(&Client::get_receiver()).get_connected_accounts()
    }

    fn get_auth_services() -> Result<Vec<String>, Error> {
        assert_authorized_with_whitelist(
            FunctionName::get_auth_services,
            vec!["supervisor".into()],
        )
        .unwrap();

        let connected_accounts = Self::get_connected_accounts();
        let accounts = connected_accounts?
            .into_iter()
            .map(|a| format!("\"{}\"", a))
            .collect::<Vec<String>>()
            .join(",");
        let graphql_query = format!(
            "query {{
                getAccounts(accountNames: [{}]) {{
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
            authService: String,
        }

        let auth_services_res = post_graphql_get_json(&graphql_query)?;
        let response_root = serde_json::from_str::<ResponseRoot>(&auth_services_res)
            .map_err(|e| DeserializationError(e.to_string()))?;
        let auth_services = response_root
            .data
            .getAccounts
            .into_iter()
            .map(|a| a.unwrap().authService)
            .collect();
        Ok(auth_services)
    }
}
