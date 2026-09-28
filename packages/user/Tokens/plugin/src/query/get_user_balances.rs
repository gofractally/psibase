use crate::errors::ErrorType;
use psibase::AccountNumber;
use psibase_plugin::host::server;
use serde::Deserialize;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Response {
    data: Data,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Data {
    user_balances: UserBalances,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct UserBalances {
    nodes: Vec<Node>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Node {
    token_id: u32,
    balance: String,
    symbol: Option<String>,
    precision: u8,
    account: AccountNumber,
}

pub struct UserBalance {
    pub token_id: u32,
    pub balance: String,
    pub symbol: Option<String>,
    pub precision: u8,
    pub account: String,
}

pub fn get_user_balances(user: &str) -> Result<Vec<UserBalance>, ErrorType> {
    let query = format!(
        r#"query {{
            userBalances(user: "{user}") {{
                nodes {{
                    tokenId
                    balance
                    symbol
                    precision
                    account
                }}
            }}
        }}"#
    );

    let response_str = server::post_graphql_get_json(&query)
        .map_err(|e| ErrorType::QueryError(e.message))?;
    let response: Response = serde_json::from_str(&response_str)
        .map_err(|e| ErrorType::QueryError(e.to_string()))?;

    Ok(response
        .data
        .user_balances
        .nodes
        .into_iter()
        .map(|node| UserBalance {
            token_id: node.token_id,
            balance: node.balance,
            symbol: node.symbol.filter(|s| !s.trim().is_empty()),
            precision: node.precision,
            account: node.account.to_string(),
        })
        .collect())
}
