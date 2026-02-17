use async_graphql::SimpleObject;
use psibase::services::tokens::TID;
use psibase::{AccountNumber, Memo};
use serde::Deserialize;
use serde_aux::field_attributes::deserialize_number_from_string;

#[derive(Deserialize, SimpleObject)]
pub struct OwnerChangeEvent {
    #[serde(deserialize_with = "deserialize_number_from_string")]
    nftId: TID,
    action: String,
    prev_owner: AccountNumber,
    new_owner: AccountNumber,
    memo: String,
}

#[derive(Deserialize, SimpleObject)]
pub struct UserConfEvent {
    account: AccountNumber,
    #[serde(deserialize_with = "deserialize_number_from_string")]
    index: u8,
    enable: bool,
}
