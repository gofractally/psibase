#[allow(warnings)]
mod bindings;

use bindings::exports::auth_dyn::plugin::api::Guest as Api;
use bindings::exports::auth_dyn::plugin::queries::Guest as Queries;
use bindings::auth_dyn::plugin::types::{DynamicAuthPolicy, WeightedAuthorizer};
use bindings::host::http::api::post_graphql_get_json;
use bindings::host::types::types::Error;
use bindings::transact::plugin::api::add_action_to_transaction;

use psibase::define_trust;
use psibase::fracpack::Pack;
use psibase::{plugin_error, AccountNumber};
use serde::de::DeserializeOwned;
use serde::Deserialize;

define_trust! {
    descriptions {
        Low => "",
        Medium => "",
        High => "🚨 WARNING 🚨
This approval allows the caller to change your account's policy service, which could be abused to control your account! Make sure you completely trust the caller's legitimacy.",
    }
    functions {
        None => [get_manager, get_policy],
        High => [set_management],
    }
}

plugin_error! {
    pub ErrorType
    InvalidAccountName(msg: String) => "Invalid account name: {msg}",
    QueryError(msg: String) => "Graphql query error: {msg}",
}

#[derive(Deserialize)]
struct QueryRoot<T> {
    data: T,
}

#[derive(Deserialize)]
struct ManagementRecord {
    manager: AccountNumber,
}

#[allow(non_snake_case)]
#[derive(Deserialize)]
struct ManagementData {
    getManagement: Option<ManagementRecord>,
}

#[derive(Deserialize)]
struct AuthorizerRecord {
    account: AccountNumber,
    weight: u8,
}

#[derive(Deserialize)]
struct PolicyRecord {
    threshold: u8,
    authorizers: Vec<AuthorizerRecord>,
}

#[allow(non_snake_case)]
#[derive(Deserialize)]
struct PolicyData {
    getPolicy: Option<PolicyRecord>,
}

fn parse_account(account: &str) -> Result<AccountNumber, Error> {
    Ok(AccountNumber::from_exact(account)
        .map_err(|e| ErrorType::InvalidAccountName(e.to_string()))?)
}

fn query<T: DeserializeOwned>(query: &str) -> Result<T, Error> {
    let json = post_graphql_get_json(query)?;
    let root: QueryRoot<T> =
        serde_json::from_str(&json).map_err(|e| ErrorType::QueryError(e.to_string()))?;
    Ok(root.data)
}

struct AuthDynPlugin;

impl Api for AuthDynPlugin {
    fn set_management(account: String, manager: String) -> Result<(), Error> {
        trust::assert_authorized(trust::FunctionName::set_management)?;

        let packed_args = auth_dyn::action_structs::set_mgmt {
            account: account.parse().unwrap(),
            manager: manager.parse().unwrap(),
        }
        .packed();

        add_action_to_transaction(
            auth_dyn::action_structs::set_mgmt::ACTION_NAME,
            &packed_args,
        )
    }
}

impl Queries for AuthDynPlugin {
    fn get_manager(account: String) -> Result<Option<String>, Error> {
        trust::assert_authorized(trust::FunctionName::get_manager)?;

        let account = parse_account(&account)?;
        let data: ManagementData = query(&format!(
            "query {{ getManagement(account: \"{account}\") {{ manager }} }}"
        ))?;
        Ok(data.getManagement.map(|m| m.manager.to_string()))
    }

    fn get_policy(account: String) -> Result<Option<DynamicAuthPolicy>, Error> {
        trust::assert_authorized(trust::FunctionName::get_policy)?;

        let account = parse_account(&account)?;
        let data: PolicyData = query(&format!(
            "query {{ getPolicy(account: \"{account}\") {{ threshold authorizers {{ account weight }} }} }}"
        ))?;
        Ok(data.getPolicy.map(|policy| DynamicAuthPolicy {
            threshold: policy.threshold,
            authorizers: policy
                .authorizers
                .into_iter()
                .map(|a| WeightedAuthorizer {
                    account: a.account.to_string(),
                    weight: a.weight,
                })
                .collect(),
        }))
    }
}

bindings::export!(AuthDynPlugin with_types_in bindings);
