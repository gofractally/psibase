#![allow(non_snake_case)]

mod adjustment;
mod limits;
mod windows;

use psibase::*;

pub(crate) const ONE_MILLION: f64 = 1_000_000.0;

/// Accept the pending admin NFT credited by `create`.
pub(crate) fn claim_admin_nft(chain: &psibase::Chain, account: AccountNumber, nft_id: u32) {
    psibase::services::nft::Wrapper::push_from(chain, account)
        .debit(nft_id, "".into())
        .get()
        .unwrap();
}
