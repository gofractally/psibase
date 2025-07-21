#[allow(warnings)]
mod bindings;
use bindings::*;

use exports::config::plugin::branding::Guest as Branding;
use exports::config::plugin::producers::Guest as Producers;

use host::common::types::Error;

use crate::bindings::exports::config::plugin::producers::Producer;
use staged_tx::plugin::proposer::set_propose_latch;

use psibase::services::producers::SERVICE as PRODUCERS_SERVICE;

struct ProposeLatch;

impl ProposeLatch {
    fn new(app: psibase::AccountNumber) -> Self {
        set_propose_latch(Some(&app.to_string())).unwrap();
        Self
    }
}

impl Drop for ProposeLatch {
    fn drop(&mut self) {
        set_propose_latch(None).unwrap();
    }
}

struct ConfigPlugin;

impl Producers for ConfigPlugin {
    fn set_cft_consensus(prods: Vec<Producer>) -> Result<(), Error> {
        let _latch = ProposeLatch::new(PRODUCERS_SERVICE);
        producers::plugin::api::set_cft_consensus(&prods[..])
    }

    fn set_bft_consensus(prods: Vec<Producer>) -> Result<(), Error> {
        let _latch = ProposeLatch::new(PRODUCERS_SERVICE);
        producers::plugin::api::set_bft_consensus(&prods[..])
    }

    fn set_producers(prods: Vec<Producer>) -> Result<(), Error> {
        let _latch = ProposeLatch::new(PRODUCERS_SERVICE);
        producers::plugin::api::set_producers(&prods[..])
    }
}

impl Branding for ConfigPlugin {
    fn upload_network_logo(logo: Vec<u8>) -> Result<(), Error> {
        let _latch = ProposeLatch::new("branding".into());

        branding::plugin::api::set_logo(&logo);
        Ok(())
    }

    fn set_network_name(name: String) -> Result<(), Error> {
        let _latch = ProposeLatch::new("branding".into());

        branding::plugin::api::set_network_name(&name);
        Ok(())
    }
}

bindings::export!(ConfigPlugin with_types_in bindings);
