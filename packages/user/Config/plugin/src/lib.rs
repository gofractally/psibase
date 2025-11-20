#[allow(warnings)]
mod bindings;
use bindings::*;

use exports::config::plugin::{
    branding::Guest as Branding, packaging::Guest as Packaging, producers::Guest as Producers,
    settings::Guest as Settings, symbol::Guest as Symbol,
};
use host::types::types::Error;

use staged_tx::plugin::proposer::set_propose_latch;

struct ConfigPlugin;

impl Settings for ConfigPlugin {
    fn set_snapshot_time(seconds: u32) -> Result<(), Error> {
        set_propose_latch(Some("transact"))?;

        transact::plugin::network::set_snapshot_time(seconds)
    }

    fn set_system_token(token_id: u32) -> Result<(), Error> {
        set_propose_latch(Some("tokens"))?;

        Ok(tokens::plugin::admin::set_sys_token(token_id))
    }
}

impl Producers for ConfigPlugin {
    fn set_cft_consensus(prods: Vec<String>) -> Result<(), Error> {
        set_propose_latch(Some("producers"))?;

        producers::plugin::api::set_cft_consensus(&prods[..])
    }

    fn set_bft_consensus(prods: Vec<String>) -> Result<(), Error> {
        set_propose_latch(Some("producers"))?;

        producers::plugin::api::set_bft_consensus(&prods[..])
    }

    fn set_producers(prods: Vec<String>) -> Result<(), Error> {
        set_propose_latch(Some("producers"))?;

        producers::plugin::api::set_producers(&prods[..])
    }
}

impl Branding for ConfigPlugin {
    fn upload_network_logo(logo: Vec<u8>) -> Result<(), Error> {
        set_propose_latch(Some("branding"))?;

        branding::plugin::api::set_logo(&logo);
        Ok(())
    }

    fn set_network_name(name: String) -> Result<(), Error> {
        set_propose_latch(Some("branding"))?;

        branding::plugin::api::set_network_name(&name);
        Ok(())
    }
}

impl Packaging for ConfigPlugin {
    fn set_account_sources(accounts: Vec<String>) -> Result<(), Error> {
        set_propose_latch(Some("root"))?;

        let _ = packages::plugin::private_api::set_account_sources(&accounts);

        Ok(())
    }
}

impl Symbol for ConfigPlugin {
    fn sell_length(
        length: u8,
        initial_price: u64,
        target: u32,
        floor_price: u64,
    ) -> Result<(), Error> {
        set_propose_latch(Some("symbol"))?;

        symbol::plugin::admin::sell_length(length, initial_price, target, floor_price)
    }

    fn del_length(length: u8) -> Result<(), Error> {
        set_propose_latch(Some("symbol"))?;

        symbol::plugin::admin::del_length(length)
    }
}

bindings::export!(ConfigPlugin with_types_in bindings);
