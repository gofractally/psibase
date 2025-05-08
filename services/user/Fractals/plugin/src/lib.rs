#[allow(warnings)]
mod bindings;

use bindings::exports::fractals::plugin::api::Guest as Api;
use bindings::host::common::server as CommonServer;
use bindings::host::common::types::Error;
use bindings::transact::plugin::intf::add_action_to_transaction;

use psibase::fracpack::Pack;

mod errors;
use errors::ErrorType;
use psibase::AccountNumber;

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

struct FractallyPlugin;

impl Api for FractallyPlugin {
    fn set_schedule(
        fractal: String,
        registration: u32,
        deliberation: u32,
        submission: u32,
        finish_by: u32,
        interval_seconds: u32,
        force_delete: bool,
    ) -> Result<(), Error> {
        let _latch = ProposeLatch::new(&fractal);

        let packed_args = fractals::action_structs::set_schedule {
            deliberation,
            finish_by,
            interval_seconds,
            registration,
            submission,
            force_delete,
        }
        .packed();

        add_action_to_transaction(
            fractals::action_structs::set_schedule::ACTION_NAME,
            &packed_args,
        )
    }

    fn join(fractal: String) -> Result<(), Error> {
        let packed_args = fractals::action_structs::join {
            fractal: AccountNumber::from(fractal.as_str()),
        }
        .packed();
        add_action_to_transaction(fractals::action_structs::join::ACTION_NAME, &packed_args)
    }

    fn create_fractal(account: String, name: String, mission: String) -> Result<(), Error> {
        let packed_args = fractals::action_structs::create_fractal {
            fractal_account: account.parse().unwrap(),
            name,
            mission,
        }
        .packed();
        add_action_to_transaction(
            fractals::action_structs::create_fractal::ACTION_NAME,
            &packed_args,
        )
    }
}

bindings::export!(FractallyPlugin with_types_in bindings);
