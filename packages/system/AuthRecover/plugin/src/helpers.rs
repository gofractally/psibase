use crate::bindings::exports::transact_hook_user_auth::Claim;
use crate::bindings::host::client::api as Client;
use crate::bindings::host::http::api as Server;
use crate::errors::ErrorType::*;
use psibase_plugin::types as CommonTypes;
use psibase_plugin::types::Pem;
use serde::Deserialize;

#[derive(Deserialize, Debug)]
struct AuthRecord {
    pub pubkey: Pem,
}

#[derive(Deserialize, Debug)]
struct AccountDetails {
    pub account: AuthRecord,
}

#[derive(Deserialize, Debug)]
struct Response {
    pub data: AccountDetails,
}

pub fn get_pubkey(account_name: &str) -> Result<Pem, CommonTypes::Error> {
    let user_key_json = Server::post_graphql_get_json(&format!(
        "query {{ account(name: \"{}\") {{ pubkey }} }}",
        account_name
    ))?;

    let summary_val = serde_json::from_str::<Response>(&user_key_json)
        .map_err(|e| JsonDecodeError(e.to_string()))?;

    Ok(summary_val.data.account.pubkey)
}

pub fn to_claim(pubkey: Vec<u8>) -> Claim {
    Claim {
        verify_service: psibase::services::verify_sig::SERVICE.to_string(),
        raw_data: pubkey,
    }
}

pub fn from_transact() -> bool {
    Client::get_sender() == psibase::services::transact::SERVICE.to_string()
}
