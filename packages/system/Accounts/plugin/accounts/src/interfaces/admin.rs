use serde::Deserialize;

use crate::bindings::host::common::server::post_graphql_get_json;
use crate::errors::ErrorType::*;
use crate::plugin::AccountsPlugin;

use crate::bindings::exports::accounts::plugin::admin::Guest as Admin;
use crate::bindings::exports::accounts::plugin::api::*;
use crate::bindings::host::common::client as Client;
use crate::db::apps_table::*;
use crate::db::user_table::*;
use crate::helpers::assert_valid_account;
use crate::trust::*;
use std::collections::HashSet;

fn prune_invalid_accounts(accounts: Vec<String>) {
    let app = AppsTable::new(&Client::get_receiver());
    for account in accounts {
        app.disconnect(&account);
    }
}

impl Admin for AccountsPlugin {
    fn get_connected_apps(user: String) -> Vec<String> {
        assert_authorized_with_whitelist(FunctionName::get_connected_apps, vec!["homepage".into()])
            .unwrap();
        UserTable::new(&user).get_connected_apps()
    }

    fn import_account(account: String) {
        assert_authorized_with_whitelist(FunctionName::import_account, vec!["x-admin".into()])
            .unwrap();
        assert_valid_account(&account);
        AppsTable::new(&Client::get_receiver()).connect(&account);
    }

    fn remove_account(account: String) {
        assert_authorized(FunctionName::remove_account).unwrap();

        let connected_apps = UserTable::new(&account).get_connected_apps();
        for app in connected_apps {
            let apps_table = AppsTable::new(&app);
            apps_table.disconnect(&account);
        }

        AppsTable::new(&Client::get_receiver()).disconnect(&account);
    }

    fn get_all_accounts() -> Vec<String> {
        assert_authorized_with_whitelist(FunctionName::get_all_accounts, vec!["supervisor".into()])
            .unwrap();
        AppsTable::new(&Client::get_receiver()).get_connected_accounts()
    }

    fn get_auth_services() -> Result<Vec<String>, Error> {
        assert_authorized_with_whitelist(
            FunctionName::get_auth_services,
            vec!["supervisor".into()],
        )
        .unwrap();

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
