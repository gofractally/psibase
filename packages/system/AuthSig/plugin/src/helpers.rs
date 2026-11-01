use crate::bindings::host::http::api as Server;
use crate::bindings::host::client::api as Client;
use crate::bindings::host::types::types as CommonTypes;
use crate::bindings::host::types::types::Pem;
use crate::errors::ErrorType::*;
use crate::types::{AccWithKeyResponse, OptionalResponse, Response};

pub fn get_pubkey(account_name: &str) -> Result<Pem, CommonTypes::Error> {
    let user_key_json = Server::post_graphql_get_json(&format!(
        "query {{ account(name: \"{}\") {{ pubkey }} }}",
        account_name
    ))?;

    let summary_val = serde_json::from_str::<Response>(&user_key_json)
        .map_err(|e| JsonDecodeError(e.to_string()))?;

    Ok(summary_val.data.account.pubkey)
}

pub fn find_pubkey(account_name: &str) -> Result<Option<Pem>, CommonTypes::Error> {
    let name = psibase::AccountNumber::from_exact(account_name)
        .map_err(|_| InvalidAccountName(account_name))?;
    let json = Server::post_graphql_get_json(&format!(
        "query {{ account(name: \"{}\") {{ pubkey }} }}",
        name
    ))?;

    let response = serde_json::from_str::<OptionalResponse>(&json)
        .map_err(|e| JsonDecodeError(e.to_string()))?;

    Ok(response.data.account.map(|record| record.pubkey))
}

pub fn get_accounts_with_key(public_key: &str) -> Result<Vec<String>, CommonTypes::Error> {
    let mut accounts = Vec::new();
    let mut after: Option<String> = None;
    loop {
        let json = Server::post_graphql_get_json(&format!(
            "query {{ accWithKey(pubkeyPem: {}, first: 100, after: {}) {{ pageInfo {{ hasNextPage endCursor }} edges {{ node {{ account }} }} }} }}",
            serde_json::to_string(public_key).unwrap(),
            serde_json::to_string(&after).unwrap(),
        ))?;

        let response = serde_json::from_str::<AccWithKeyResponse>(&json)
            .map_err(|e| JsonDecodeError(e.to_string()))?;
        let connection = response.data.accWithKey;
        accounts.extend(connection.edges.into_iter().map(|edge| edge.node.account));

        match connection.pageInfo.endCursor {
            Some(cursor) if connection.pageInfo.hasNextPage => after = Some(cursor),
            _ => break,
        }
    }
    Ok(accounts)
}

pub fn from_transact() -> bool {
    Client::get_sender() == psibase::services::transact::SERVICE.to_string()
}
