// TODO: tables
// TODO: events

use async_graphql::{InputObject, SimpleObject};
use fracpack::{Pack, ToSchema, Unpack};
use serde::{Deserialize, Serialize};

use crate::AccountNumber;

pub type NID = u32;

#[derive(
    Debug, Copy, Clone, Pack, Unpack, Serialize, Deserialize, SimpleObject, InputObject, ToSchema,
)]
#[fracpack(fracpack_mod = "fracpack")]
#[graphql(input_name = "NftRecordInput")]
pub struct NftRecord {
    pub id: NID,
    pub issuer: AccountNumber,
    pub owner: AccountNumber,
}

#[derive(
    Debug, Copy, Clone, Pack, Unpack, Serialize, Deserialize, SimpleObject, InputObject, ToSchema,
)]
#[fracpack(fracpack_mod = "fracpack")]
#[graphql(input_name = "NftHolderRecordInput")]
pub struct NftHolderRecord {
    account: AccountNumber,
    config: u8, // todo: Implement Bitset
}

#[derive(
    Debug, Copy, Clone, Pack, Unpack, Serialize, Deserialize, SimpleObject, InputObject, ToSchema,
)]
#[fracpack(fracpack_mod = "fracpack")]
#[graphql(input_name = "CreditRecordInput")]
pub struct CreditRecord {
    nftId: NID,
    debitor: AccountNumber,
}

#[crate::service(name = "nft", dispatch = false, psibase_mod = "crate")]
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

    #[action]
    fn uncredit(nftId: crate::services::nft::NID, memo: String) {
        unimplemented!()
    }

    #[action]
    fn debit(nftId: crate::services::nft::NID, memo: String) {
        unimplemented!()
    }

    #[action]
    fn setUserConf(flag: NamedBit, enable: bool) {
        unimplemented!()
    }

    #[action]
    fn getNft(nftId: crate::services::nft::NID) -> super::NftRecord {
        unimplemented!()
    }

    #[action]
    fn getNftHolder(account: AccountNumber) -> super::NftHolderRecord {
        unimplemented!()
    }

    #[action]
    fn getCredRecord(nftId: crate::services::nft::NID) -> super::CreditRecord {
        unimplemented!()
    }

    #[action]
    fn exists(nftId: crate::services::nft::NID) -> bool {
        unimplemented!()
    }

    #[action]
    fn getUserConf(account: AccountNumber, flag: NamedBit) -> bool {
        unimplemented!()
    }
}
