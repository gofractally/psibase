#[allow(warnings)]
mod bindings;
use bindings::*;

use exports::config::plugin::branding::Guest as Branding;
use exports::config::plugin::packaging::Guest as Packaging;
use exports::config::plugin::producers::Guest as Producers;
use exports::config::plugin::settings::Guest as Settings;

use host::types::types::Error;

use staged_tx::plugin::proposer::set_propose_latch;

struct ConfigPlugin;

impl Settings for ConfigPlugin {
    fn set_snapshot_time(seconds: u32) -> Result<(), Error> {
        set_propose_latch(Some("transact"))?;

        transact::plugin::network::set_snapshot_time(seconds)
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

bindings::export!(ConfigPlugin with_types_in bindings);
