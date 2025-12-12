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
pub struct Nft {
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
    config: u8,
}

#[derive(
    Debug, Copy, Clone, Pack, Unpack, Serialize, Deserialize, SimpleObject, InputObject, ToSchema,
)]
#[fracpack(fracpack_mod = "fracpack")]
#[graphql(input_name = "CreditRecordInput")]
pub struct CreditRecord {
    nftId: NID,
    creditor: AccountNumber,
    debitor: AccountNumber,
}

crate::define_flags!(NftHolderFlags, u8, {
    manual_debit,
});

#[crate::service(name = "nft", dispatch = false, psibase_mod = "crate")]
#[allow(non_snake_case, unused_variables)]
mod service {
    use super::NID;
    use crate::{AccountNumber, Memo};

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
    fn credit(nftId: crate::services::nft::NID, debitor: AccountNumber, memo: Memo) {
        unimplemented!()
    }

    #[action]
    fn uncredit(nftId: crate::services::nft::NID, memo: Memo) {
        unimplemented!()
    }

    #[action]
    fn debit(nftId: crate::services::nft::NID, memo: Memo) {
        unimplemented!()
    }

    #[action]
    fn setUserConf(index: u8, enable: bool) {
        unimplemented!()
    }

    #[action]
    fn getNft(nftId: crate::services::nft::NID) -> super::Nft {
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
    fn getUserConf(account: AccountNumber, index: u8) -> bool {
        unimplemented!()
    }

    #[event(history)]
    fn minted(nftId: NID, issuer: AccountNumber) {
        unimplemented!()
    }
    #[event(history)]
    fn burned(nftId: NID, owner: AccountNumber) {
        unimplemented!()
    }

    #[event(history)]
    fn credited(nftId: NID, creditor: AccountNumber, debitor: AccountNumber, memo: String) {
        unimplemented!()
    }
    #[event(history)]
    fn uncredited(nftId: NID, creditor: AccountNumber, debitor: AccountNumber, memo: String) {
        unimplemented!()
    }

    #[event(merkle)]
    fn transferred(nftId: NID, creditor: AccountNumber, debitor: AccountNumber, memo: String) {
        unimplemented!()
    }

    #[event(history)]
    fn userConfSet(account: AccountNumber, index: u8, enable: bool) {
        unimplemented!()
    }
}

#[test]
fn verify_schema() {
    crate::assert_schema_matches_package::<Wrapper>();
}
