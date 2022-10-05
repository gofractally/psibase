// TODO: tables
// TODO: events

use crate::AccountNumber;

pub type NID = u32;

#[derive(crate::Fracpack)]
#[fracpack(fracpack_mod = "fracpack")]
pub struct NftRecord {
    id: NID,
    issuer: AccountNumber,
    owner: AccountNumber,
}

#[derive(crate::Fracpack)]
#[fracpack(fracpack_mod = "fracpack")]
pub struct NftHolderRecord {
    account: AccountNumber,
    config: u8, // todo: Implement Bitset
}

#[derive(crate::Fracpack)]
#[fracpack(fracpack_mod = "fracpack")]
pub struct CreditRecord {
    nftId: NID,
    debitor: AccountNumber,
}

#[crate::service(name = "nft-sys", dispatch = false, psibase_mod = "crate")]
#[allow(non_snake_case, unused_variables)]
mod service {
    use crate::{AccountNumber, NamedBit};

    #[action]
    fn init() {
        unimplemented!()
    }

    #[action]
    fn mint() -> crate::services::nft_sys::NID {
        unimplemented!()
    }

    #[action]
    fn burn(nftId: crate::services::nft_sys::NID) {
        unimplemented!()
    }

    #[action]
    fn credit(nftId: crate::services::nft_sys::NID, receiver: AccountNumber, memo: String) {
        unimplemented!()
    }

    #[action]
    fn uncredit(nftId: crate::services::nft_sys::NID, memo: String) {
        unimplemented!()
    }

    #[action]
    fn debit(nftId: crate::services::nft_sys::NID, memo: String) {
        unimplemented!()
    }

    #[action]
    fn setUserConf(flag: NamedBit, enable: bool) {
        unimplemented!()
    }

    #[action]
    fn getNft(nftId: crate::services::nft_sys::NID) -> super::NftRecord {
        unimplemented!()
    }

    #[action]
    fn getNftHolder(account: AccountNumber) -> super::NftHolderRecord {
        unimplemented!()
    }

    #[action]
    fn getCredRecord(nftId: crate::services::nft_sys::NID) -> super::CreditRecord {
        unimplemented!()
    }

    #[action]
    fn exists(nftId: crate::services::nft_sys::NID) -> bool {
        unimplemented!()
    }

    #[action]
    fn getUserConf(account: AccountNumber, flag: NamedBit) -> bool {
        unimplemented!()
    }
}
