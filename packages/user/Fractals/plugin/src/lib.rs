#[allow(warnings)]
mod bindings;

use std::str::FromStr;

use bindings::exports::fractals::plugin::admin::Guest as Admin;
use bindings::exports::fractals::plugin::user::Guest as User;

use bindings::host::types::types::Error;
use bindings::transact::plugin::intf::add_action_to_transaction;

use psibase::fracpack::Pack;

mod errors;
mod helpers;
use psibase::AccountNumber;

use bindings::evaluations::plugin::admin::close;
use bindings::evaluations::plugin::user::{
    attest, get_group_users, get_proposal, propose, register, unregister,
};

use bindings::staged_tx::plugin::proposer::set_propose_latch;

use crate::helpers::check_app_origin;
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

impl Admin for FractallyPlugin {
    fn close_eval(evaluation_id: u32) -> Result<(), Error> {
        close(&"fractals".to_string(), evaluation_id)
    }

    fn create_fractal(account: String, name: String, mission: String) -> Result<(), Error> {
        check_app_origin()?;

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

    fn start(fractal: String, evaluation_type: u8) -> Result<(), Error> {
        check_app_origin()?;

        let _latch = ProposeLatch::new(&fractal);

        let packed_args = fractals::action_structs::start_eval {
            fractal: AccountNumber::from(fractal.as_str()),
            evaluation_type,
        }
        .packed();

        add_action_to_transaction(
            fractals::action_structs::start_eval::ACTION_NAME,
            &packed_args,
        )
    }

    fn set_half_life(fractal: String, seconds: u32) -> Result<(), Error> {
        check_app_origin()?;

        let _latch = ProposeLatch::new(&fractal);

        let packed_args = fractals::action_structs::set_half_life { seconds }.packed();

        add_action_to_transaction(
            fractals::action_structs::set_half_life::ACTION_NAME,
            &packed_args,
        )
    }

    fn set_schedule(
        evaluation_type: u8,
        fractal: String,
        registration: u32,
        deliberation: u32,
        submission: u32,
        finish_by: u32,
        interval_seconds: u32,
    ) -> Result<(), Error> {
        check_app_origin()?;

        let _latch = ProposeLatch::new(&fractal);

        let packed_args = fractals::action_structs::set_schedule {
            evaluation_type,
            deliberation,
            finish_by,
            interval_seconds,
            registration,
            submission,
        }
        .packed();

        add_action_to_transaction(
            fractals::action_structs::set_schedule::ACTION_NAME,
            &packed_args,
        )
    }
}

impl User for FractallyPlugin {
    fn register(evaluation_id: u32) -> Result<(), Error> {
        check_app_origin()?;

        register(&"fractals".to_string(), evaluation_id)
    }

    fn unregister(evaluation_id: u32) -> Result<(), Error> {
        check_app_origin()?;

        unregister(&"fractals".to_string(), evaluation_id)
    }

    fn claim(fractal: String) -> Result<(), Error> {
        check_app_origin()?;

        let packed_args = fractals::action_structs::claim {
            fractal: AccountNumber::from(fractal.as_str()),
        }
        .packed();
        add_action_to_transaction(fractals::action_structs::claim::ACTION_NAME, &packed_args)
    }

    fn get_proposal(evaluation_id: u32, group_number: u32) -> Result<Option<Vec<String>>, Error> {
        check_app_origin()?;

        match get_proposal(&"fractals".to_string(), evaluation_id, group_number)? {
            None => Ok(None),
            Some(rank_numbers) => {
                let users: Vec<AccountNumber> =
                    get_group_users(&"fractals".to_string(), evaluation_id, group_number)?
                        .iter()
                        .map(|account| AccountNumber::from_str(account).unwrap())
                        .collect();

                let res: Vec<String> = helpers::parse_rank_to_accounts(rank_numbers, users)
                    .into_iter()
                    .map(|user| user.to_string())
                    .collect();

                Ok(Some(res))
            }
        }
    }

    fn attest(evaluation_id: u32, group_number: u32) -> Result<(), Error> {
        check_app_origin()?;

        attest(&"fractals".to_string(), evaluation_id, group_number)
    }

    fn get_group_users(evaluation_id: u32, group_number: u32) -> Result<Vec<String>, Error> {
        check_app_origin()?;

        get_group_users(&"fractals".to_string(), evaluation_id, group_number)
    }

    fn propose(evaluation_id: u32, group_number: u32, proposal: Vec<String>) -> Result<(), Error> {
        check_app_origin()?;

        let all_users: Vec<AccountNumber> =
            get_group_users(&"fractals".to_string(), evaluation_id, group_number)?
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

        propose(&"fractals".to_string(), evaluation_id, group_number, &res)
    }

    fn join(fractal: String) -> Result<(), Error> {
        check_app_origin()?;

        let packed_args = fractals::action_structs::join {
            fractal: AccountNumber::from(fractal.as_str()),
        }
        .packed();
        add_action_to_transaction(fractals::action_structs::join::ACTION_NAME, &packed_args)
    }
}

bindings::export!(FractallyPlugin with_types_in bindings);
