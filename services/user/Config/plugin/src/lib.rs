#[allow(warnings)]
mod bindings;
use bindings::*;

use exports::config::plugin::app::Guest as App;
use host::common::types::Error;
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
}

bindings::export!(ConfigPlugin with_types_in bindings);
