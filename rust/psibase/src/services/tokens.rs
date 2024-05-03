// TODO: tables
// TODO: events

use async_graphql::{InputObject, SimpleObject};
use fracpack::{Pack, Unpack};
use serde::{Deserialize, Serialize};

use crate::{AccountNumber, Reflect};

pub type NID = u32;

#[derive(
    Debug, Copy, Clone, Pack, Unpack, Reflect, Serialize, Deserialize, SimpleObject, InputObject,
)]
#[fracpack(fracpack_mod = "fracpack")]
#[reflect(psibase_mod = "crate")]
#[graphql(input_name = "NftRecordInput")]
pub struct NftRecord {
    id: NID,
    issuer: AccountNumber,
    owner: AccountNumber,
}

#[derive(
    Debug, Copy, Clone, Pack, Unpack, Reflect, Serialize, Deserialize, SimpleObject, InputObject,
)]
#[fracpack(fracpack_mod = "fracpack")]
#[reflect(psibase_mod = "crate")]
#[graphql(input_name = "NftHolderRecordInput")]
pub struct NftHolderRecord {
    account: AccountNumber,
    config: u8, // todo: Implement Bitset
}

#[derive(
    Debug, Copy, Clone, Pack, Unpack, Reflect, Serialize, Deserialize, SimpleObject, InputObject,
)]
#[fracpack(fracpack_mod = "fracpack")]
#[reflect(psibase_mod = "crate")]
#[graphql(input_name = "CreditRecordInput")]
pub struct CreditRecord {
    nftId: NID,
    debitor: AccountNumber,
}

#[crate::service(name = "tokens", dispatch = false, psibase_mod = "crate")]
#[allow(non_snake_case, unused_variables)]
mod service {
    use crate::{AccountNumber, NamedBit};

    #[action]
    fn init() {
        unimplemented!()
    }

    #[action]
    fn mint() -> crate::services::nft::NID {
        unimplemented!()
    }

    #[action]
    fn burn(nftId: crate::services::nft::NID) {
        unimplemented!()
    }

    #[action]
    fn credit(nftId: crate::services::nft::NID, receiver: AccountNumber, memo: String) {
        unimplemented!()
    }
}
