use async_graphql::SimpleObject;
use psibase::services::tokens::TID;
use psibase::{AccountNumber, Memo};
use serde::Deserialize;
use serde_aux::field_attributes::deserialize_number_from_string;

#[derive(Deserialize, SimpleObject)]
pub struct SupplyEvent {
    #[serde(deserialize_with = "deserialize_number_from_string")]
    token_id: TID,
    actor: AccountNumber,
    action: String,
    amount: String,
    memo: Memo,
}
#[derive(Deserialize, SimpleObject)]
pub struct ConfigureEvent {
    #[serde(deserialize_with = "deserialize_number_from_string")]
    token_id: TID,
    action: String,
    memo: Memo,
}

#[derive(Deserialize, SimpleObject)]
pub struct BalanceEvent {
    #[serde(deserialize_with = "deserialize_number_from_string")]
    token_id: TID,
    account: AccountNumber,
    counter_party: AccountNumber,
    action: String,
    amount: String,
    memo: Memo,
}
