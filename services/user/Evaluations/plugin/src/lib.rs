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
    fn create(
        registration: u32,
        deliberation: u32,
        submission: u32,
        finish_by: u32,
        allowable_group_sizes: Vec<u8>,
    ) -> Result<(), Error> {
        let packed_args = evaluations::action_structs::create {
            registration,
            deliberation,
            submission,
            finish_by,
            allowable_group_sizes,
        }
        .packed();
        add_action_to_transaction("create", &packed_args)
    }

    fn register(id: u32) -> Result<(), Error> {
        let packed_args = evaluations::action_structs::register { id }.packed();
        add_action_to_transaction("register", &packed_args)
    }

    fn unregister(id: u32) -> Result<(), Error> {
        let packed_args = evaluations::action_structs::unregister { id }.packed();
        add_action_to_transaction("unregister", &packed_args)
    }

    fn start(id: u32, entropy: u64) -> Result<(), Error> {
        let packed_args = evaluations::action_structs::start { id, entropy }.packed();
        add_action_to_transaction("start", &packed_args)
    }

    fn close(id: u32) -> Result<(), Error> {
        let packed_args = evaluations::action_structs::close { id }.packed();
        add_action_to_transaction("close", &packed_args)
    }

    fn group_key(evaluation_id: u32, keys: Vec<Vec<u8>>, hash: String) -> Result<(), Error> {
        let packed_args = evaluations::action_structs::groupKey {
            evaluation_id,
            keys,
            hash,
        }
        .packed();
        add_action_to_transaction("groupKey", &packed_args)
    }

    fn attest(evaluation_id: u32, submission: Vec<String>) -> Result<(), Error> {
        let packed_args = evaluations::action_structs::attest {
            evaluation_id,
            submission,
        }
        .packed();
        add_action_to_transaction("attest", &packed_args)
    }

    fn propose(evaluation_id: u32, proposal: Vec<u8>) -> Result<(), Error> {
        let packed_args = evaluations::action_structs::propose {
            evaluation_id,
            proposal,
        }
        .packed();
        add_action_to_transaction("propose", &packed_args)
    }
}

bindings::export!(EvaluationsPlugin with_types_in bindings);
