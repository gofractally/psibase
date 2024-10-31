use crate::bindings::auth_sig::plugin::types::Pem;
use crate::bindings::host::common::{client as Client, server as Server, types as CommonTypes};
use crate::errors::ErrorType::*;
use crate::types::*;

pub fn get_pubkey(account_name: &str) -> Result<Pem, CommonTypes::Error> {
    let user_key_json = Server::post_graphql_get_json(&format!(
        "query {{ account(name: \"{}\") {{ pubkey }} }}",
        account_name
    ))?;

    let summary_val = serde_json::from_str::<Response>(&user_key_json)
        .map_err(|e| JsonDecodeError.err(&e.to_string()))?;

    Ok(summary_val.data.account.pubkey)
}

pub fn from_transact() -> bool {
    Client::get_sender_app().app.map_or(false, |app| {
        app == psibase::services::transact::SERVICE.to_string()
    })
}
