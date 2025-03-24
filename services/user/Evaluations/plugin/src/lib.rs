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
        registration: u32,
        deliberation: u32,
        submission: u32,
    ) -> Result<(), Error> {
        let packed_args = evaluations::action_structs::scheduleEvaluation {
            registration,
            deliberation,
            submission,
        }
        .packed();
        add_action_to_transaction("scheduleEvaluation", &packed_args)
    }

    fn register(id: u32, entropy: u64) -> Result<(), Error> {
        let packed_args = evaluations::action_structs::register { id, entropy }.packed();
        add_action_to_transaction("register", &packed_args)
    }

    fn start_evaluation(id: u32) -> Result<(), Error> {
        let packed_args = evaluations::action_structs::startEvaluation { id }.packed();
        add_action_to_transaction("startEvaluation", &packed_args)
    }

    fn set_group_sizes(id: u32, group_sizes: Vec<u8>) -> Result<(), Error> {
        let packed_args = evaluations::action_structs::setGroupSizes { id, group_sizes }.packed();
        add_action_to_transaction("setGroupSizes", &packed_args)
    }
}

bindings::export!(EvaluationsPlugin with_types_in bindings);
