use serde::Deserialize;

use crate::bindings::host::http::api::post_graphql_get_json;
use crate::errors::ErrorType::*;
use crate::plugin::AccountsPlugin;

use crate::bindings::exports::accounts::plugin::admin::{Error, Guest as Admin};
use crate::bindings::host::accounts::admin as HostAccountsAdmin;
use crate::bindings::transact::plugin::api as Transact;
use crate::trust::*;
use psibase::fracpack::Pack;
use psibase::services::accounts as Accounts;
use std::collections::HashSet;

const HOST_APP: &str = "host";

impl Admin for AccountsPlugin {
    fn get_auth_services() -> Result<Vec<String>, Error> {
        assert_authorized_with_whitelist(
            FunctionName::get_auth_services,
            vec!["supervisor".into()],
        )
        .unwrap();

        let connected_accounts = HostAccountsAdmin::get_connected_accounts(HOST_APP);
        if connected_accounts.is_empty() {
            return Ok(Vec::new());
        }
        let accounts = connected_accounts
            .iter()
            .map(|a| format!("\"{a}\""))
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

        let rows = response_root.data.getAccounts;
        let mut valid_account_nums = HashSet::with_capacity(rows.len());
        let mut auth_services = Vec::with_capacity(rows.len());
        for opt_accnt in rows {
            if let Some(accnt) = opt_accnt {
                valid_account_nums.insert(accnt.accountNum);
                auth_services.push(accnt.authService);
            }
        }

        for account in &connected_accounts {
            if !valid_account_nums.contains(account) {
                HostAccountsAdmin::disconnect(account, HOST_APP);
            }
        }

        Ok(auth_services)
    }

    fn preapprove_account(account: String) {
        assert_authorized_with_whitelist(FunctionName::preapprove_account, vec!["config".into()])
            .unwrap();

        Transact::add_action_to_transaction(
            Accounts::action_structs::preapproveAcc::ACTION_NAME,
            &Accounts::action_structs::preapproveAcc {
                name: account.parse().unwrap(),
            }
            .packed(),
        )
        .unwrap();
    }
}
