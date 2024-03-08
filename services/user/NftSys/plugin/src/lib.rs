#[allow(warnings)]
mod bindings;

// NOTE: I critically avoided importing this as common::plugin
// to avoid an ambiguous name "plugin" (with nft_sys::plugin).
// This will be a massive source of confusion, given
// every plugin import will have "plugin" in the name.
// AND given we're mixing 1) services, 2) plugins, and 3) psibase,
// we're going to have redundant types, which *must* be clearly referenced
// to avoid confusion, e.g., NID...
// AND at least so far in my example, "nft_sys" refers to BOTH
// the service and the plugin...
use bindings::common;
use bindings::exports::nft_sys::plugin::nfts;
// use nft_sys::*;
use psibase::services::nft_sys::NID;
// use psibase::AccountNumber;
use serde::Serialize;

struct Nfts;

impl nfts::Guest for Nfts {
    fn mint(_nft_label: String) -> Result<(), String> {
        // Err("Not implemented".to_string())
        #[derive(Serialize)]
        struct MintArgs {}
        let mint_args = MintArgs {};

        let _ = common::plugin::server::add_action_to_transaction(
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

        let _ = common::plugin::server::add_action_to_transaction(
            "nft-sys",
            "burn",
            serde_json::to_string(&burn_args)
                .expect("Failed to serialize struct into JSON")
                .as_str(),
        );
        Ok(())
    }

    // TODO: how can we make types from wit vs service super obviously different?
    // The AccountNumber keyword was ambiguously coming from 2 places
    fn credit(_nft_id: NID, receiver: nfts::AccountNumber, _memo: String) -> Result<(), String> {
        let _receiver = psibase::AccountNumber::new(receiver);
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
