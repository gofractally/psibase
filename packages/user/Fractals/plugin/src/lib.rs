#[allow(warnings)]
mod bindings;

use std::str::FromStr;

use bindings::exports::fractals::plugin::admin_fractal::Guest as AdminFractal;
use bindings::exports::fractals::plugin::admin_guild::Guest as AdminGuild;
use bindings::exports::fractals::plugin::user_guild::Guest as UserGuild;

use bindings::exports::fractals::plugin::user_eval::Guest as UserEval;
use bindings::exports::fractals::plugin::user_fractal::Guest as UserFractal;

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
            - Unregistering from guild evaluation
            - Closing an evaluation cycle
        ",
        Medium => "
        Medium trust grants the abilities of the Low trust level, plus these abilities:
            - Joining the fractal
            - Registering for a guild evaluation
            - Unregistering from guild evaluation
            - Applying to join a guild
            - Attesting guild membership for a fractal member
            - Retrieving a proposal in evaluation
            - Creating a new fractal
            ",
            High => "
            High trust grants the abilities of all lower trust levels, plus these abilities:
            - Proposing a vote in evaluation cycle
            - Setting the guild evaluation schedule
            - Setting the guild display name
            - Setting the guild bio
            - Setting the guild description
            - Attesting in an evaluation
            - Creating a new guild
            ",
    }
    functions {
        None => [get_group_users],
        Low => [start, close_eval],
        Medium => [join, register, unregister, apply_guild, attest_membership_app, get_proposal, create_fractal],
        High => [propose, set_schedule, set_display_name, set_bio, set_description, attest, create_guild],
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

impl AdminFractal for FractallyPlugin {
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
}

impl AdminGuild for FractallyPlugin {
    fn create_guild(display_name: String, guild_account: String) -> Result<(), Error> {
        assert_authorized(FunctionName::create_guild)?;

        let packed_args = fractals::action_structs::create_guild {
            fractal: get_sender_app()?,
            display_name: Memo::try_from(display_name).unwrap(),
            guild_account: guild_account.as_str().into(),
        }
        .packed();

        add_action_to_transaction(
            fractals::action_structs::create_guild::ACTION_NAME,
            &packed_args,
        )
    }

    fn set_display_name(guild: String, display_name: String) -> Result<(), Error> {
        get_guild(guild)?.assert_authorized(FunctionName::set_display_name)?;

        let packed_args = fractals::action_structs::set_g_disp {
            display_name: display_name.try_into().unwrap(),
        }
        .packed();

        add_action_to_transaction(
            fractals::action_structs::set_g_disp::ACTION_NAME,
            &packed_args,
        )
    }

    fn set_bio(guild: String, bio: String) -> Result<(), Error> {
        get_guild(guild)?.assert_authorized(FunctionName::set_bio)?;

        let packed_args = fractals::action_structs::set_g_bio {
            bio: bio.try_into().unwrap(),
        }
        .packed();

        add_action_to_transaction(
            fractals::action_structs::set_g_bio::ACTION_NAME,
            &packed_args,
        )
    }

    fn set_description(guild_account: String, description: String) -> Result<(), Error> {
        get_guild(guild_account)?.assert_authorized(FunctionName::set_description)?;

        let packed_args = fractals::action_structs::set_g_desc { description }.packed();

        add_action_to_transaction(
            fractals::action_structs::set_g_desc::ACTION_NAME,
            &packed_args,
        )
    }

    fn set_eval_schedule(
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

    fn start_eval(guild_account: String) -> Result<(), Error> {
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

    fn close_eval(guild_account: String) -> Result<(), Error> {
        let guild = get_guild(guild_account)?;
        guild.assert_authorized(FunctionName::close_eval)?;

        close(&"fractals".to_string(), guild.eval_id()?)
    }
}

impl UserFractal for FractallyPlugin {
    fn join() -> Result<(), Error> {
        assert_authorized(FunctionName::join)?;
        let packed_args = fractals::action_structs::join {
            fractal: get_sender_app()?,
        }
        .packed();
        add_action_to_transaction(fractals::action_structs::join::ACTION_NAME, &packed_args)
    }
}

impl UserGuild for FractallyPlugin {
    fn apply_guild(guild_account: String, extra_info: String) -> Result<(), Error> {
        get_guild(guild_account.clone())?.assert_authorized(FunctionName::apply_guild)?;

        let packed_args = fractals::action_structs::apply_guild {
            guild_account: guild_account.as_str().into(),
            extra_info,
        }
        .packed();

        add_action_to_transaction(
            fractals::action_structs::apply_guild::ACTION_NAME,
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
}

impl UserEval for FractallyPlugin {
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

    fn get_group_users(guild_account: String, group_number: u32) -> Result<Vec<String>, Error> {
        let guild = get_guild(guild_account)?;
        EvaluationsUser::get_group_users(&"fractals".to_string(), guild.eval_id()?, group_number)
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

    fn attest(guild_account: String, group_number: u32) -> Result<(), Error> {
        let guild = get_guild(guild_account)?;
        guild.assert_authorized(FunctionName::attest)?;
        EvaluationsUser::attest(&"fractals".to_string(), guild.eval_id()?, group_number)
    }
}

bindings::export!(FractallyPlugin with_types_in bindings);
