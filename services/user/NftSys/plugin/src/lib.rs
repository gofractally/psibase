#[allow(warnings)]
mod bindings;

use bindings::common::plugin;
use bindings::exports::nft_sys::plugin::nfts;
// use nft_sys::*;
use psibase::services::nft_sys::NID;
// use psibase::*;
use serde::Serialize;

struct Nfts;

impl nfts::Guest for Nfts {
    fn mint(_nft_label: String) -> Result<(), String> {
        // Err("Not implemented".to_string())
        // struct MintArgs {};
        // let mintArgs: MintArgs = MingArgs {};
        // plugin::server::add_action_to_transaction("nft-sys", "mint", minArgs.to_json_string());
        let _ = plugin::server::add_action_to_transaction("nft-sys", "mint", "{}");
        // NftQuery.userEvents(minter: AccountNumber, first: ??);
        Ok(())
    }

    fn burn(nft_id: NID) -> Result<(), String> {
        // Err("Not implemented".to_string())
        #[derive(Serialize)]
        struct BurnArgs {
            nft_id: NID,
        }

        let burn_args = BurnArgs { nft_id: nft_id };
        let _ = plugin::server::add_action_to_transaction(
            "nft-sys",
            "mint",
            serde_json::to_string(&burn_args)
                .expect("Failed to serialize struct into JSON")
                .as_str(),
        );
        // let _ = plugin::server::add_action_to_transaction("nft-sys", "burn", "{}");
        // NftQuery.userEvents(minter: AccountNumber, first: ??);
        Ok(())
    }

    // fn credit(nft_id: NID, receiver: psibase::AccountNumber, memo: String) -> Result<(), String> {
    //     Ok(())
    // }

    fn uncredit(_nft_id: NID, _memo: String) -> Result<(), String> {
        Ok(())
    }

    fn debit(_nft_id: NID, _memo: String) -> Result<(), String> {
        Ok(())
    }
}

bindings::export!(Nfts with_types_in bindings);
