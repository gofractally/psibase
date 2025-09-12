use crate::bindings::host::crypto::types::Pem;
use serde::Deserialize;

#[derive(Deserialize, Debug)]
pub struct AuthRecord {
    pub pubkey: Pem,
}

#[derive(Deserialize, Debug)]
pub struct AccountDetails {
    pub account: AuthRecord,
}

#[derive(Deserialize, Debug)]
pub struct Response {
    pub data: AccountDetails,
}
