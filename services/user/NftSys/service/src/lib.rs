#[psibase::service]
mod service {
    use psibase::*;
    use serde::{Deserialize, Serialize};

    #[derive(Fracpack, Reflect, Serialize, Deserialize, Clone, Debug)]
    pub struct NID {
        id: u64,
    }

    #[action]
    fn mint(_nft_label: String) {
        // NOP
    }

    #[action]
    fn burn(_nft_id: NID) {
        // NOP
    }

    #[action]
    fn credit(_nft_id: NID, _receiver: psibase::AccountNumber, _memo: String) {
        // NOP
    }

    #[action]
    fn uncredit(_nft_id: NID, _memo: String) {
        // NOP
    }

    #[action]
    fn debit(_nft_id: NID, _memo: String) {
        // NOP
    }
}
