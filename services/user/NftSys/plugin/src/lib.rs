#[allow(warnings)]
mod bindings;

/* NOTE: I critically avoided importing this as common::plugin
to avoid an ambiguous name "plugin" (with nft_sys::plugin).
This will be a massive source of confusion, given
every plugin import will have "plugin" in the name.
AND given we're mixing 1) services, 2) plugins, and 3) psibase,
we're going to have redundant types, which *must* be clearly referenced
to avoid confusion, e.g., NID...
AND at least so far in my example, "nft_sys" refers to BOTH
the service and the plugin... */

use std::str::FromStr;

use bindings::common::plugin as CommonPlugin;
use bindings::exports::nft_sys::plugin as NftSysPlugin;

// This line is the locally-compiled service
// but doesn't include type NID
// use nft_sys as NftSysService;

// This is the public crate, which includes type NID
// but *obviously* isn't being recompiled locally
// Will only happen with system services.
use psibase::services::nft_sys as NftSysService;

struct Nfts;

impl NftSysPlugin::nfts::Guest for Nfts {
    fn mint(_nft_label: String) -> Result<(), String> {
        let mint_args = NftSysService::action_structs::mint {};
        let _ = CommonPlugin::server::add_action_to_transaction(
            "nft-sys",
            "mint",
            serde_json::to_string(&mint_args)
                .expect("Failed to serialize struct into JSON")
                .as_str(),
        );
        // NftQuery.userEvents(minter: AccountNumber, first: ??);
        Ok(())
    }

    fn burn(nft_id: NftSysPlugin::types::Nid) -> Result<(), String> {
        // NftSysService::
        // NftSysService. ;
        // NftSysService::action_structs::burn:: ;
        let burn_args = NftSysService::action_structs::burn { nftId: nft_id };

        let _ = CommonPlugin::server::add_action_to_transaction(
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
    fn credit(
        nft_id: NftSysPlugin::types::Nid,
        receiver: String,
        memo: String,
    ) -> Result<(), String> {
        let rcvr = match psibase::AccountNumber::from_str(&receiver) {
            Ok(acct) => match acct.value {
                0 => return Err("{} is not a valid account.".to_string()),
                _ => acct,
            },
            Err(e) => return Err(e.to_string()),
        };
        let credit_args = NftSysService::action_structs::credit {
            nftId: nft_id,
            receiver: rcvr,
            memo,
        };
        // let bob = match serde_json::to_string(&credit_args) {
        //     Ok(str) => str,
        //     Err(e) => return Err(e.to_string()),
        // };
        // CommonPlugin::server::add_action_to_transaction("nft-sys", "credit", &bob);

        CommonPlugin::server::add_action_to_transaction(
            "nft-sys",
            "credit",
            &(match serde_json::to_string(&credit_args) {
                Ok(str) => str,
                Err(e) => return Err(e.to_string()),
            }),
        )

        // CommonPlugin::server::add_action_to_transaction(
        //     "nft-sys",
        //     "credit",
        //     &(match serde_json::to_string(&credit_args) {
        //         Ok(str) => {
        //             let bob = str.to_owned();
        //             bob
        //         }
        //         Err(e) => return Err(e.to_string()),
        //     }),
        // )
    }

    fn uncredit(nft_id: NftSysPlugin::types::Nid, memo: String) -> Result<(), String> {
        let uncredit_args = NftSysService::action_structs::uncredit {
            nftId: nft_id,
            memo,
        };

        CommonPlugin::server::add_action_to_transaction(
            "nft-sys",
            "uncredit",
            &(match serde_json::to_string(&uncredit_args) {
                Ok(str) => str,
                Err(e) => return Err(e.to_string()),
            }),
        )
    }

    fn debit(nft_id: NftSysPlugin::types::Nid, memo: String) -> Result<(), String> {
        let debit_args = NftSysService::action_structs::uncredit {
            nftId: nft_id,
            memo,
        };

        CommonPlugin::server::add_action_to_transaction(
            "nft-sys",
            "uncredit",
            &(match serde_json::to_string(&debit_args) {
                Ok(str) => str,
                Err(e) => return Err(e.to_string()),
            }),
        )
    }

    fn get_nft(_nft_id: NftSysPlugin::types::Nid) -> Result<(), NftSysPlugin::types::NftRecord> {
        Ok(())
    }

    fn get_nft_holder(
        _account: NftSysPlugin::types::AccountNumber,
    ) -> Result<(), NftSysPlugin::types::NftHolderRecord> {
        Ok(())
    }

    fn get_cred_record(
        _nft_id: NftSysPlugin::types::Nid,
    ) -> Result<(), NftSysPlugin::types::CreditRecord> {
        Ok(())
    }

    fn exists(_nft_id: NftSysPlugin::types::Nid) -> Result<(), bool> {
        Ok(())
    }

    // fn getUserConf(account: AccountNumber, flag: NamedBit) -> bool {
    //     unimplemented!()
    // }

    // fn setUserConf(flag: NamedBit, enable: bool) {
    //     unimplemented!()
    // }
}

bindings::export!(Nfts with_types_in bindings);
