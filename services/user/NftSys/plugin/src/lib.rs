#[allow(warnings)]
mod bindings;

use bindings::common::plugin;
use bindings::exports::nft_sys::plugin::nfts;
// use nft_sys::*;
use psibase::services::nft_sys::NID;
use psibase::AccountNumber;
use serde::Serialize;

struct Nfts;

impl nfts::Guest for Nfts {
    fn mint(_nft_label: String) -> Result<(), String> {
        // Err("Not implemented".to_string())
        #[derive(Serialize)]
        struct MintArgs {}
        let mint_args = MintArgs {};

        let _ = plugin::server::add_action_to_transaction(
            "nft-sys",
            "mint",
            serde_json::to_string(&mint_args)
                .expect("Failed to serialize struct into JSON")
                .as_str(),
        );
        // NftQuery.userEvents(minter: AccountNumber, first: ??);
        Ok(())
    }

    fn burn(nft_id: NID) -> Result<(), String> {
        #[derive(Serialize)]
        struct BurnArgs {
            nft_id: NID,
        }
        let burn_args = BurnArgs { nft_id: nft_id };

        let _ = plugin::server::add_action_to_transaction(
            "nft-sys",
            "burn",
            serde_json::to_string(&burn_args)
                .expect("Failed to serialize struct into JSON")
                .as_str(),
        );
        Ok(())
    }

    fn credit(_nft_id: NID, receiver: nfts::AccountNumber, _memo: String) -> Result<(), String> {
        let _receiver = AccountNumber::new(receiver);
        Ok(())
    }

    fn uncredit(_nft_id: NID, _memo: String) -> Result<(), String> {
        Ok(())
    }

    fn debit(_nft_id: NID, _memo: String) -> Result<(), String> {
        Ok(())
    }
}

bindings::export!(Nfts with_types_in bindings);
