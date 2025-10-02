#[allow(warnings)]
mod bindings;

use std::str::FromStr;

use bindings::exports::fractals::plugin::admin::Guest as Admin;
use bindings::exports::fractals::plugin::user::Guest as User;

use bindings::host::types::types::Error;
use bindings::transact::plugin::intf::add_action_to_transaction;

use psibase::fracpack::Pack;

mod errors;
mod graphql;
mod helpers;
use psibase::{AccountNumber, Memo};

use bindings::evaluations::plugin::admin::close;
use bindings::evaluations::plugin::user as EvaluationsUser;

use crate::errors::ErrorType;
use crate::graphql::fetch_guild_eval_instance;
use crate::helpers::{check_app_origin, get_sender_app};

struct FractallyPlugin;

impl Admin for FractallyPlugin {
    fn close_eval(guild_slug: String) -> Result<(), Error> {
        let evaluation_id =
            fetch_guild_eval_instance(get_sender_app()?, guild_slug.as_str().into())?
                .ok_or(ErrorType::NoPendingEvaluation)?;

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

    fn start(guild_slug: String) -> Result<(), Error> {
        let packed_args = fractals::action_structs::start_eval {
            fractal_account: get_sender_app()?,
            slug: guild_slug.as_str().into(),
        }
        .packed();

        add_action_to_transaction(
            fractals::action_structs::start_eval::ACTION_NAME,
            &packed_args,
        )
    }

    fn set_schedule(
        guild_slug: String,
        registration: u32,
        deliberation: u32,
        submission: u32,
        finish_by: u32,
        interval_seconds: u32,
    ) -> Result<(), Error> {
        // check_app_origin()?;
        // the plugin needs to know that the guild in reference

        let packed_args = fractals::action_structs::set_schedule {
            guild_slug: guild_slug.as_str().into(),
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
    fn register(guild_slug: String) -> Result<(), Error> {
        let evaluation_id =
            fetch_guild_eval_instance(get_sender_app()?, guild_slug.as_str().into())?
                .ok_or(ErrorType::NoPendingEvaluation)?;

        EvaluationsUser::register(&"fractals".to_string(), evaluation_id)
    }

    fn unregister(guild_slug: String) -> Result<(), Error> {
        let evaluation_id =
            fetch_guild_eval_instance(get_sender_app()?, guild_slug.as_str().into())?
                .ok_or(ErrorType::NoPendingEvaluation)?;

        EvaluationsUser::unregister(&"fractals".to_string(), evaluation_id)
    }

    fn create_guild(display_name: String, slug: String) -> Result<(), Error> {
        let packed_args = fractals::action_structs::create_guild {
            fractal: get_sender_app()?,
            display_name: Memo::try_from(display_name).unwrap(),
            slug: slug.as_str().into(),
        }
        .packed();

        add_action_to_transaction(
            fractals::action_structs::create_guild::ACTION_NAME,
            &packed_args,
        )
    }

    fn get_proposal(guild_slug: String, group_number: u32) -> Result<Option<Vec<String>>, Error> {
        let slug: AccountNumber = guild_slug.as_str().into();

        let evaluation_id = fetch_guild_eval_instance(get_sender_app()?, slug)?
            .ok_or(ErrorType::NoPendingEvaluation)?;

        match EvaluationsUser::get_proposal(&"fractals".to_string(), evaluation_id, group_number)? {
            None => Ok(None),
            Some(rank_numbers) => {
                let users: Vec<AccountNumber> = EvaluationsUser::get_group_users(
                    &"fractals".to_string(),
                    evaluation_id,
                    group_number,
                )?
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

    fn attest(guild_slug: String, group_number: u32) -> Result<(), Error> {
        let slug: AccountNumber = guild_slug.as_str().into();
        let evaluation_id = fetch_guild_eval_instance(get_sender_app()?, slug)?
            .ok_or(ErrorType::NoPendingEvaluation)?;

        EvaluationsUser::attest(&"fractals".to_string(), evaluation_id, group_number)
    }

    fn get_group_users(guild_slug: String, group_number: u32) -> Result<Vec<String>, Error> {
        let slug: AccountNumber = guild_slug.as_str().into();
        let evaluation_id = fetch_guild_eval_instance(get_sender_app()?, slug)?
            .ok_or(ErrorType::NoPendingEvaluation)?;

        EvaluationsUser::get_group_users(&"fractals".to_string(), evaluation_id, group_number)
    }

    fn propose(guild_slug: String, group_number: u32, proposal: Vec<String>) -> Result<(), Error> {
        let slug: AccountNumber = guild_slug.as_str().into();
        let evaluation_id = fetch_guild_eval_instance(get_sender_app()?, slug)?
            .ok_or(ErrorType::NoPendingEvaluation)?;

        let all_users: Vec<AccountNumber> =
            EvaluationsUser::get_group_users(&"fractals".to_string(), evaluation_id, group_number)?
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

        EvaluationsUser::propose(&"fractals".to_string(), evaluation_id, group_number, &res)
    }

    fn join() -> Result<(), Error> {
        let packed_args = fractals::action_structs::join {
            fractal: get_sender_app()?,
        }
        .packed();
        add_action_to_transaction(fractals::action_structs::join::ACTION_NAME, &packed_args)
    }
}

bindings::export!(FractallyPlugin with_types_in bindings);
