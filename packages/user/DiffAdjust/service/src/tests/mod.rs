#![allow(non_snake_case)]

mod adjustment;
mod limits;
mod windows;

use psibase::*;

pub(crate) const ONE_MILLION: f64 = 1_000_000.0;

/// Create credits the admin NFT; without auto-debit the creator is not yet owner.
pub(crate) fn enable_nft_auto_debit(chain: &psibase::Chain, account: AccountNumber) {
    psibase::services::nft::Wrapper::push_from(chain, account)
        .setUserConf(
            psibase::services::nft::NftHolderFlags::AUTO_DEBIT.index(),
            true,
        )
        .get()
        .unwrap();
}
