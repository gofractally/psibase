#[allow(warnings)]
mod bindings;

use bindings::exports::evaluations::plugin::api::Guest as Api;
use bindings::host::common::server as CommonServer;
use bindings::host::common::types::Error;
use bindings::transact::plugin::intf::add_action_to_transaction;

use psibase::fracpack::Pack;

mod errors;
use errors::ErrorType;

struct EvaluationsPlugin;

impl Api for EvaluationsPlugin {
    fn schedule_evaluation(
        rsvp_start_from: u32,
        rsvp_deadline: u32,
        evaluation_deadline: u32,
    ) -> Result<(), Error> {
        let packed_args = evaluations::action_structs::scheduleEvaluation {
            rsvp_start_from,
            rsvp_deadline,
            evaluation_deadline,
        }
        .packed();
        add_action_to_transaction("scheduleEvaluation", &packed_args).unwrap();
        Ok(())
    }
}

bindings::export!(EvaluationsPlugin with_types_in bindings);
