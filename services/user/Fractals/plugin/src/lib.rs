#[allow(warnings)]
mod bindings;

use std::str::FromStr;

use bindings::exports::fractals::plugin::api::Guest as Api;
use bindings::host::common::server as CommonServer;
use bindings::host::common::types::Error;
use bindings::transact::plugin::intf::add_action_to_transaction;

use psibase::fracpack::Pack;

mod errors;
mod helpers;
use errors::ErrorType;
use psibase::AccountNumber;

use bindings::evaluations::plugin::user::{
    attest, get_group_users, get_proposal, propose, register, unregister,
};
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
    fn register(evaluation_id: u32) -> Result<(), Error> {
        register("fractals", evaluation_id)
    }

    fn unregister(evaluation_id: u32) -> Result<(), Error> {
        unregister("fractals", evaluation_id)
    }

    fn get_proposal(evaluation_id: u32, group_number: u32) -> Result<Vec<String>, Error> {
        let rank_numbers = get_proposal("fractals", evaluation_id, group_number)
            .unwrap()
            .unwrap();

        let users: Vec<AccountNumber> = get_group_users(&"fractals", evaluation_id, group_number)?
            .iter()
            .map(|account| AccountNumber::from_str(account).unwrap())
            .collect();

        let res: Vec<String> = helpers::parse_rank_to_accounts(rank_numbers, users)
            .into_iter()
            .map(|user| user.to_string())
            .collect();

        Ok(res)
    }

    fn attest(evaluation_id: u32, group_number: u32) -> Result<(), Error> {
        attest(&"fractals", evaluation_id, group_number)
    }

    fn get_group_users(evaluation_id: u32, group_number: u32) -> Result<Vec<String>, Error> {
        get_group_users(&"fractals", evaluation_id, group_number)
    }

    fn propose(evaluation_id: u32, group_number: u32, proposal: Vec<String>) -> Result<(), Error> {
        let all_users: Vec<AccountNumber> =
            get_group_users(&"fractals", evaluation_id, group_number)?
                .iter()
                .map(|account| AccountNumber::from_str(account).unwrap())
                .collect();

        let ranked_accounts: Vec<AccountNumber> = proposal
            .iter()
            .map(|user| AccountNumber::from_str(user).unwrap())
            .collect();

        let res: Vec<String> = helpers::parse_accounts_to_ranks(all_users, ranked_accounts)
            .into_iter()
            .map(|num| num.to_string())
            .collect();

        propose(&"fractals", evaluation_id, group_number, &res)
    }

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

    fn start(fractal: String) -> Result<(), Error> {
        let _latch = ProposeLatch::new(&fractal);

        let packed_args = fractals::action_structs::start_eval {
            fractal: AccountNumber::from(fractal.as_str()),
        }
        .packed();

        add_action_to_transaction(
            fractals::action_structs::start_eval::ACTION_NAME,
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

    fn close_eval(fractal: String) -> Result<(), Error> {
        let packed_args = fractals::action_structs::close_eval {
            fractal: AccountNumber::from(fractal.as_str()),
        }
        .packed();
        add_action_to_transaction(
            fractals::action_structs::close_eval::ACTION_NAME,
            &packed_args,
        )
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
