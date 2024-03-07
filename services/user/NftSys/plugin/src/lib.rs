#[allow(warnings)]
mod bindings;

use bindings::exports::nft_sys::plugin::nfts;

struct Nfts;

impl nfts::Guest for Nfts {
    fn mint() -> Result<(), String> {
        Err("Not implemented".to_string())
    }
}

bindings::export!(Nfts with_types_in bindings);
