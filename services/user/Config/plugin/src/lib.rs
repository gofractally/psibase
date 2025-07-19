#[allow(warnings)]
mod bindings;
use bindings::*;

use exports::config::plugin::app::Guest as App;
use host::common::types::Error;

use crate::bindings::exports::config::plugin::app::Producer;
use psibase::fracpack::Pack;
use psibase::services::producers::action_structs as Actions;
use psibase::AccountNumber;
use staged_tx::plugin::proposer::set_propose_latch;

struct ProposeLatch;

impl ProposeLatch {
    fn new(app: &str) -> Self {
        set_propose_latch(Some(app)).unwrap();
        Self
    }
}

impl Drop for ProposeLatch {
    fn drop(&mut self) {
        set_propose_latch(None).unwrap();
    }
}

struct ConfigPlugin;

impl ConfigPlugin {
    fn set_consensus_internal(consensus_data: psibase::ConsensusData) -> Result<(), Error> {
        let set_consensus = Actions::setConsensus {
            prods: consensus_data,
        };

        let _latch = ProposeLatch::new(&psibase::services::producers::SERVICE.to_string());
        Ok(())
    }
}

impl App for ConfigPlugin {
    fn upload_network_logo(logo: Vec<u8>) -> Result<(), Error> {
        let _latch = ProposeLatch::new("branding");

        branding::plugin::api::set_logo(&logo);
        Ok(())
    }

    fn set_network_name(name: String) -> Result<(), Error> {
        let _latch = ProposeLatch::new("branding");

        branding::plugin::api::set_network_name(&name);
        Ok(())
    }

    fn remove_network_logo() -> Result<(), Error> {
        let _latch = ProposeLatch::new("branding");

        Ok(())
    }

    fn set_cft_consensus(prods: Vec<Producer>) -> Result<(), Error> {
        let _latch = ProposeLatch::new(&psibase::services::producers::SERVICE.to_string());
        producers::plugin::api::set_cft_consensus(&prods[..])
    }

    fn set_bft_consensus(prods: Vec<Producer>) -> Result<(), Error> {
        let _latch = ProposeLatch::new(&psibase::services::producers::SERVICE.to_string());
        producers::plugin::api::set_bft_consensus(&prods[..])
    }

    fn set_producers(prods: Vec<Producer>) -> Result<(), Error> {
        let _latch = ProposeLatch::new(&psibase::services::producers::SERVICE.to_string());
        producers::plugin::api::set_producers(&prods[..])
    }
}

bindings::export!(ConfigPlugin with_types_in bindings);
