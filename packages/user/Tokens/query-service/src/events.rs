use async_graphql::SimpleObject;
use psibase::services::tokens::{Precision, TID};
use psibase::{AccountNumber, Memo};
use serde::Deserialize;
use serde_aux::field_attributes::deserialize_number_from_string;

#[derive(Deserialize, SimpleObject)]
pub struct CreditedEvent {
    #[serde(deserialize_with = "deserialize_number_from_string")]
    token_id: TID,
    creditor: AccountNumber,
    debitor: AccountNumber,
    amount: String,
    memo: Memo,
}

#[derive(Deserialize, SimpleObject)]
pub struct UncreditedEvent {
    #[serde(deserialize_with = "deserialize_number_from_string")]
    token_id: TID,
    creditor: AccountNumber,
    debitor: AccountNumber,
    amount: String,
    memo: Memo,
}

#[derive(Deserialize, SimpleObject)]
pub struct DebitedEvent {
    #[serde(deserialize_with = "deserialize_number_from_string")]
    token_id: TID,
    creditor: AccountNumber,
    debitor: AccountNumber,
    amount: String,
    memo: Memo,
}

#[derive(Deserialize, SimpleObject)]
pub struct RejectedEvent {
    #[serde(deserialize_with = "deserialize_number_from_string")]
    token_id: TID,
    creditor: AccountNumber,
    debitor: AccountNumber,
    memo: Memo,
}

#[derive(Deserialize, SimpleObject)]
pub struct RecalledEvent {
    #[serde(deserialize_with = "deserialize_number_from_string")]
    token_id: TID,
    amount: String,
    recallee: AccountNumber,
    recaller: AccountNumber,
    memo: Memo,
}

#[derive(Deserialize, SimpleObject)]
pub struct BurnedEvent {
    #[serde(deserialize_with = "deserialize_number_from_string")]
    token_id: TID,
    sender: AccountNumber,
    amount: String,
    memo: Memo,
}

#[derive(Deserialize, SimpleObject)]
pub struct MintedEvent {
    #[serde(deserialize_with = "deserialize_number_from_string")]
    token_id: TID,
    amount: String,
    memo: Memo,
}

#[derive(Deserialize, SimpleObject)]
pub struct CreatedEvent {
    #[serde(deserialize_with = "deserialize_number_from_string")]
    token_id: TID,
    sender: AccountNumber,
    precision: Precision,
    max_issued_supply: String,
}
