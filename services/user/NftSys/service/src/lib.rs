#[psibase::service]
mod service {
    use psibase::*;
    use serde::{Deserialize, Serialize};

    #[derive(Fracpack, Reflect, Serialize, Deserialize, Debug)]
    pub struct NID {
        id: u64,
    }

    #[action]
    fn mint(_nft_label: String) {
        // NOP
    }
}
