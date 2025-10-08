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
use crate::graphql::{get_guild, GuildHelper};
use crate::helpers::get_sender_app;
use crate::trust::{assert_authorized, assert_authorized_with_whitelist};
use psibase::define_trust;
use trust::FunctionName;

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
        Low => [close_eval, create_fractal, start, set_guild_description, set_schedule, register, unregister, apply_guild, create_guild, attest_membership_app, get_proposal, attest, get_group_users, propose, join],
        High => [],
    }
}

impl GuildHelper {
    fn assert_authorized(&self, function: FunctionName) -> Result<(), Error> {
        assert_authorized_with_whitelist(function, vec![self.fractal.to_string()])
    }

    fn eval_id(&self) -> Result<u32, ErrorType> {
        self.evaluation_id.ok_or(ErrorType::NoPendingEvaluation)
    }
}

struct FractallyPlugin;

impl Admin for FractallyPlugin {
    fn close_eval(guild: String) -> Result<(), Error> {
        let guild = get_guild(guild)?;
        guild.assert_authorized(FunctionName::close_eval)?;

        close(&"fractals".to_string(), guild.eval_id()?)
    }

    fn create_fractal(
        fractal_account: String,
        guild_account: String,
        name: String,
        mission: String,
    ) -> Result<(), Error> {
        assert_authorized(FunctionName::create_fractal)?;
        let packed_args = fractals::action_structs::create_fractal {
            fractal_account: fractal_account.parse().unwrap(),
            guild_account: guild_account.parse().unwrap(),
            name,
            mission,
        }
        .packed();
        add_action_to_transaction(
            fractals::action_structs::create_fractal::ACTION_NAME,
            &packed_args,
        )
    }

    fn start(guild_account: String) -> Result<(), Error> {
        let guild = get_guild(guild_account.clone())?;
        guild.assert_authorized(FunctionName::start)?;

        let packed_args = fractals::action_structs::start_eval {
            guild_account: guild_account.as_str().into(),
        }
        .packed();

        add_action_to_transaction(
            fractals::action_structs::start_eval::ACTION_NAME,
            &packed_args,
        )
    }

    fn set_guild_description(guild_account: String, description: String) -> Result<(), Error> {
        get_guild(guild_account)?.assert_authorized(FunctionName::set_guild_description)?;

        let packed_args = fractals::action_structs::set_g_desc { description }.packed();

        add_action_to_transaction(
            fractals::action_structs::set_g_desc::ACTION_NAME,
            &packed_args,
        )
    }

    fn set_schedule(
        guild_account: String,
        registration: u32,
        deliberation: u32,
        submission: u32,
        finish_by: u32,
        interval_seconds: u32,
    ) -> Result<(), Error> {
        get_guild(guild_account)?.assert_authorized(FunctionName::set_schedule)?;

        let packed_args = fractals::action_structs::set_schedule {
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
    fn register(guild_account: String) -> Result<(), Error> {
        let guild = get_guild(guild_account)?;
        guild.assert_authorized(FunctionName::register)?;

        EvaluationsUser::register(&"fractals".to_string(), guild.eval_id()?)
    }

    fn unregister(guild_account: String) -> Result<(), Error> {
        let guild = get_guild(guild_account)?;
        guild.assert_authorized(FunctionName::unregister)?;

        EvaluationsUser::unregister(&"fractals".to_string(), guild.eval_id()?)
    }

    fn apply_guild(guild_account: String, app: String) -> Result<(), Error> {
        get_guild(guild_account.clone())?.assert_authorized(FunctionName::apply_guild)?;

        let packed_args = fractals::action_structs::apply_guild {
            guild_account: guild_account.as_str().into(),
            app,
        }
        .packed();

        add_action_to_transaction(
            fractals::action_structs::apply_guild::ACTION_NAME,
            &packed_args,
        )
    }

    fn create_guild(display_name: String, guild_account: String) -> Result<(), Error> {
        let guild = get_guild(guild_account.clone())?;

        guild.assert_authorized(FunctionName::create_guild)?;

        let packed_args = fractals::action_structs::create_guild {
            fractal: guild.fractal,
            display_name: Memo::try_from(display_name).unwrap(),
            guild_account: guild_account.as_str().into(),
        }
        .packed();

        add_action_to_transaction(
            fractals::action_structs::create_guild::ACTION_NAME,
            &packed_args,
        )
    }

    fn attest_membership_app(
        guild_account: String,
        member: String,
        comment: String,
        endorses: bool,
    ) -> Result<(), Error> {
        let guild = get_guild(guild_account.clone())?;
        guild.assert_authorized(FunctionName::attest_membership_app)?;

        let packed_args = fractals::action_structs::at_mem_app {
            comment,
            endorses,
            guild_account: guild_account.as_str().into(),
            member: member.as_str().into(),
        }
        .packed();

        add_action_to_transaction(
            fractals::action_structs::at_mem_app::ACTION_NAME,
            &packed_args,
        )
    }

    fn get_proposal(
        guild_account: String,
        group_number: u32,
    ) -> Result<Option<Vec<String>>, Error> {
        let guild = get_guild(guild_account)?;
        guild.assert_authorized(FunctionName::get_proposal)?;
        let evaluation_id = guild.eval_id()?;

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

    fn attest(guild_account: String, group_number: u32) -> Result<(), Error> {
        let guild = get_guild(guild_account)?;
        guild.assert_authorized(FunctionName::attest)?;

        EvaluationsUser::attest(&"fractals".to_string(), guild.eval_id()?, group_number)
    }

    fn get_group_users(guild_account: String, group_number: u32) -> Result<Vec<String>, Error> {
        let guild = get_guild(guild_account)?;
        guild.assert_authorized(FunctionName::get_group_users)?;

        EvaluationsUser::get_group_users(&"fractals".to_string(), guild.eval_id()?, group_number)
    }

    fn propose(
        guild_account: String,
        group_number: u32,
        proposal: Vec<String>,
    ) -> Result<(), Error> {
        let guild = get_guild(guild_account)?;
        guild.assert_authorized(FunctionName::propose)?;
        let evaluation_id = guild.eval_id()?;

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
