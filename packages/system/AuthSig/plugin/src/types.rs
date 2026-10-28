use crate::bindings::host::types::types::Pem;
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

#[derive(Deserialize, Debug)]
pub struct OptionalAccountDetails {
    pub account: Option<AuthRecord>,
}

#[derive(Deserialize, Debug)]
pub struct OptionalResponse {
    pub data: OptionalAccountDetails,
}

#[derive(Deserialize, Debug)]
pub struct AccountName {
    pub account: String,
}

#[allow(non_snake_case)]
#[derive(Deserialize, Debug)]
pub struct PageInfo {
    pub hasNextPage: bool,
    pub endCursor: Option<String>,
}

#[derive(Deserialize, Debug)]
pub struct AccountEdge {
    pub node: AccountName,
}

#[allow(non_snake_case)]
#[derive(Deserialize, Debug)]
pub struct AccountConnection {
    pub pageInfo: PageInfo,
    pub edges: Vec<AccountEdge>,
}

#[allow(non_snake_case)]
#[derive(Deserialize, Debug)]
pub struct AccWithKeyData {
    pub accWithKey: AccountConnection,
}

#[derive(Deserialize, Debug)]
pub struct AccWithKeyResponse {
    pub data: AccWithKeyData,
}
