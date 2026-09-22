use async_graphql::{ComplexObject, SimpleObject};
use nft::service::{self, NID};
use psibase::{AccountNumber, Memo};
use serde::Deserialize;
use serde_aux::field_attributes::deserialize_number_from_string;

#[derive(Deserialize, SimpleObject)]
#[graphql(complex)]
pub struct OwnerChangeEvent {
    #[serde(rename = "nftId", deserialize_with = "deserialize_number_from_string")]
    nft_id: NID,
    #[serde(deserialize_with = "deserialize_number_from_string")]
    #[graphql(skip)]
    action: u8,
    account: AccountNumber,
    counter_party: AccountNumber,
    memo: Memo,
}

#[ComplexObject]
impl OwnerChangeEvent {
    pub async fn action(&self) -> String {
        match self.action {
            service::MINTED => "minted".to_string(),
            service::BURNED => "burned".to_string(),
            service::CREDITED => "credited".to_string(),
            service::DEBITED => "debited".to_string(),
            service::UNCREDITED => "uncredited".to_string(),
            _ => "unknown".to_string(),
        }
    }
}
