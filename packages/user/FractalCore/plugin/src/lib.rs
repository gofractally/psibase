#[allow(warnings)]
mod bindings;

use bindings::exports::fractal_core::plugin::api::Guest as Api;
use bindings::host::common::server as CommonServer;
use bindings::host::types::types::Error;
use bindings::transact::plugin::intf::add_action_to_transaction;

use psibase::define_trust;
use psibase::fracpack::Pack;

mod errors;
use errors::ErrorType;

use bindings::staged_tx::plugin::proposer::set_propose_latch;

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

use bindings::fractals::plugin::user::register;

define_trust! {
    descriptions {
        Low => "
        Low trust grants these abilities:
            - Reading the value of the example-thing
        ",
        Medium => "",
        High => "
        High trust grants the abilities of all lower trust levels, plus these abilities:
            - Setting the example thing
        ",
    }
    functions {
        Low => [],
        High => [start_eval],
    }
}

struct FractalCorePlugin;

impl Api for FractalCorePlugin {
    fn start_eval(guild_id: u32) -> Result<(), Error> {
        trust::assert_authorized(trust::FunctionName::start_eval)?;

        bindings::fractals::plugin::admin::start(guild_id)
    }

    fn join() -> Result<(), Error> {
        trust::assert_authorized(trust::FunctionName::start_eval)?;

        bindings::fractals::plugin::user::join()
    }
}

bindings::export!(FractalCorePlugin with_types_in bindings);
