#[allow(warnings)]
mod bindings;

use std::str::FromStr;

use bindings::exports::fractals::plugin::admin_fractal::Guest as AdminFractal;
use bindings::exports::fractals::plugin::admin_guild::Guest as AdminGuild;
use bindings::exports::fractals::plugin::queries::Guest as Queries;
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

use crate::bindings::accounts;
use crate::bindings::exports::fractals::plugin::types;
use crate::errors::ErrorType;
use crate::graphql::fractal::get_fractal;
use crate::graphql::guild::{get_guild, Guild};
use crate::helpers::get_sender_app;
use crate::trust::{assert_authorized, assert_authorized_with_whitelist};
use psibase::define_trust;
use trust::FunctionName;

define_trust! {
    descriptions {
        Low => "
            - Unregistering from guild evaluation
            - Closing an evaluation cycle
        ",
        Medium => "
            - Joining the fractal
            - Registering for a guild evaluation
            - Unregistering from guild evaluation
            - Applying to join a guild
            - Attesting guild membership for a fractal member
            - Retrieving a proposal in evaluation
            - Creating a new fractal
        ",
        High => "
            - Proposing a vote in evaluation cycle
            - Exiling a fractal member
            - Setting the guild evaluation schedule
            - Setting the guild display name, bio and description
            - Attesting in an evaluation
            - Creating a new guild
            - Resign, remove or set a new Guild representative
            - Set ranked guilds
            - Set minimum scorers required to enable consensus rewards
            - Conclude membership applications
            - Set token init and guild ranking threshold
            ",
    }
    functions {
        None => [exile_member, get_group_users, init_token, set_dist_interval],
        Low => [close_eval, dist_token, start],
        Medium => [apply_guild, attest_membership_app, create_fractal, get_proposal, join, register, register_candidacy, unregister],
        High => [attest, con_membership_app, create_guild, propose, remove_guild_rep, resign_guild_rep, set_bio, set_description, set_display_name, set_guild_rep, set_min_scorers, set_rank_ordering_threshold, set_ranked_guild_slots, set_ranked_guilds, set_schedule, set_token_threshold],
    }
}

impl Guild {
    fn assert_authorized(&self, function: FunctionName) -> Result<(), Error> {
        assert_authorized_with_whitelist(function, vec![self.fractal.to_string()])
    }

    fn eval_id(&self) -> Result<u32, ErrorType> {
        self.evaluation_id.ok_or(ErrorType::NoPendingEvaluation)
    }
}

struct FractallyPlugin;

impl AdminFractal for FractallyPlugin {
    fn set_ranked_guild_slots(slots_count: u8) -> Result<(), Error> {
        assert_authorized(FunctionName::set_ranked_guild_slots)?;

        let packed_args = fractals::action_structs::set_rank_g_s {
            fractal: get_sender_app()?,
            slots_count,
        }
        .packed();
        add_action_to_transaction(
            fractals::action_structs::set_rank_g_s::ACTION_NAME,
            &packed_args,
        )
    }

    fn set_ranked_guilds(ranked_guilds: Vec<String>) -> Result<(), Error> {
        assert_authorized(FunctionName::set_ranked_guilds)?;

        let packed_args = fractals::action_structs::rank_guilds {
            fractal: get_sender_app()?,
            guilds: ranked_guilds
                .into_iter()
                .map(|guild| AccountNumber::from(guild.as_str()))
                .collect(),
        }
        .packed();
        add_action_to_transaction(
            fractals::action_structs::rank_guilds::ACTION_NAME,
            &packed_args,
        )
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
            council_role: accounts::plugin::api::gen_rand_account(Some("c-"))?
                .as_str()
                .into(),
            rep_role: accounts::plugin::api::gen_rand_account(Some("r-"))?
                .as_str()
                .into(),
        }
        .packed();
        add_action_to_transaction(
            fractals::action_structs::create_fractal::ACTION_NAME,
            &packed_args,
        )
    }

    fn init_token() -> Result<(), Error> {
        assert_authorized(FunctionName::init_token)?;

        let packed_args = fractals::action_structs::init_token {
            fractal: get_sender_app()?,
        }
        .packed();
        add_action_to_transaction(
            fractals::action_structs::init_token::ACTION_NAME,
            &packed_args,
        )
    }

    fn set_token_threshold(threshold: u8) -> Result<(), Error> {
        assert_authorized(FunctionName::set_token_threshold)?;

        let packed_args = fractals::action_structs::set_tkn_thrs {
            fractal: get_sender_app()?,
            threshold,
        }
        .packed();
        add_action_to_transaction(
            fractals::action_structs::set_dist_int::ACTION_NAME,
            &packed_args,
        )
    }

    fn exile_member(member: String) -> Result<(), Error> {
        assert_authorized(FunctionName::exile_member)?;
        let packed_args = fractals::action_structs::exile_member {
            fractal: get_sender_app()?,
            member: member.parse().unwrap(),
        }
        .packed();
        add_action_to_transaction(
            fractals::action_structs::exile_member::ACTION_NAME,
            &packed_args,
        )
    }

    fn set_dist_interval(distribution_interval_secs: u32) -> Result<(), Error> {
        assert_authorized(FunctionName::set_dist_interval)?;
        let packed_args = fractals::action_structs::set_dist_int {
            fractal: get_sender_app()?,
            distribution_interval_secs,
        }
        .packed();
        add_action_to_transaction(
            fractals::action_structs::set_dist_int::ACTION_NAME,
            &packed_args,
        )
    }
}

impl AdminGuild for FractallyPlugin {
    fn con_membership_app(guild: String, applicant: String, accepted: bool) -> Result<(), Error> {
        get_guild(guild)?.assert_authorized(FunctionName::con_membership_app)?;

        let packed_args = fractals::action_structs::con_mem_app {
            accepted,
            applicant: applicant.as_str().into(),
        }
        .packed();

        add_action_to_transaction(
            fractals::action_structs::con_mem_app::ACTION_NAME,
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
            council_role: accounts::plugin::api::gen_rand_account(Some("c-"))?
                .as_str()
                .into(),
            rep_role: accounts::plugin::api::gen_rand_account(Some("r-"))?
                .as_str()
                .into(),
        }
        .packed();

        add_action_to_transaction(
            fractals::action_structs::create_guild::ACTION_NAME,
            &packed_args,
        )
    }

    fn set_rank_ordering_threshold(threshold: u8) -> Result<(), Error> {
        assert_authorized(FunctionName::set_rank_ordering_threshold)?;

        let packed_args = fractals::action_structs::set_rnk_thrs { threshold }.packed();

        add_action_to_transaction(
            fractals::action_structs::set_rank_g_s::ACTION_NAME,
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

    fn set_guild_rep(guild_account: String, rep: String) -> Result<(), Error> {
        let guild = get_guild(guild_account)?;
        guild.assert_authorized(FunctionName::set_guild_rep)?;

        let packed_args = fractals::action_structs::set_g_rep {
            new_representative: rep.as_str().into(),
        }
        .packed();

        add_action_to_transaction(
            fractals::action_structs::set_g_rep::ACTION_NAME,
            &packed_args,
        )
    }
    fn resign_guild_rep(guild_account: String) -> Result<(), Error> {
        get_guild(guild_account)?.assert_authorized(FunctionName::resign_guild_rep)?;

        let packed_args = fractals::action_structs::resign_g_rep {}.packed();

        add_action_to_transaction(
            fractals::action_structs::resign_g_rep::ACTION_NAME,
            &packed_args,
        )
    }

    fn remove_guild_rep(guild_account: String) -> Result<(), Error> {
        get_guild(guild_account)?.assert_authorized(FunctionName::remove_guild_rep)?;

        let packed_args = fractals::action_structs::remove_g_rep {}.packed();

        add_action_to_transaction(
            fractals::action_structs::remove_g_rep::ACTION_NAME,
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

    fn dist_token() -> Result<(), Error> {
        assert_authorized(FunctionName::dist_token)?;
        let packed_args = fractals::action_structs::dist_token {
            fractal: get_sender_app()?,
        }
        .packed();
        add_action_to_transaction(
            fractals::action_structs::dist_token::ACTION_NAME,
            &packed_args,
        )
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

    fn register_candidacy(guild_account: String, active: bool) -> Result<(), Error> {
        get_guild(guild_account.clone())?.assert_authorized(FunctionName::register_candidacy)?;

        let packed_args = fractals::action_structs::reg_can {
            guild: guild_account.as_str().into(),
            active,
        }
        .packed();

        add_action_to_transaction(fractals::action_structs::reg_can::ACTION_NAME, &packed_args)
    }

    fn attest_membership_app(
        guild_account: String,
        applicant: String,
        comment: String,
        endorses: bool,
    ) -> Result<(), Error> {
        let guild = get_guild(guild_account.clone())?;
        guild.assert_authorized(FunctionName::attest_membership_app)?;

        let packed_args = fractals::action_structs::at_mem_app {
            comment,
            endorses,
            guild_account: guild_account.as_str().into(),
            applicant: applicant.as_str().into(),
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

impl Queries for FractallyPlugin {
    fn get_guild(guild_account: String) -> Result<types::Guild, Error> {
        let guild = get_guild(guild_account)?;
        Ok(types::Guild {
            fractal: guild.fractal.to_string(),
            guild: guild.guild.to_string(),
            evaluation_id: guild.evaluation_id,
            council_role: guild.council_role.to_string(),
            rep_role: guild.rep_role.to_string(),
        })
    }

    fn get_fractal(fractal_account: String) -> Result<types::Fractal, Error> {
        let fractal = get_fractal(fractal_account)?;
        Ok(types::Fractal {
            fractal: fractal.account.to_string(),
            judiciary: fractal.judiciary.to_string(),
            legislature: fractal.legislature.to_string(),
            token_id: fractal.token_id,
        })
    }
}

bindings::export!(FractallyPlugin with_types_in bindings);
