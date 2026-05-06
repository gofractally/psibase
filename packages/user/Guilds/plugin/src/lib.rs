#[allow(warnings)]
mod bindings;

use std::str::FromStr;

use bindings::exports::guilds::plugin::admin_fractal::Guest as AdminFractal;
use bindings::exports::guilds::plugin::admin_guild::Guest as AdminGuild;
use bindings::exports::guilds::plugin::queries::Guest as Queries;
use bindings::exports::guilds::plugin::queries::Guild as GuildWit;
use bindings::exports::guilds::plugin::user_eval::Guest as UserEval;
use bindings::exports::guilds::plugin::user_guild::Guest as UserGuild;

use bindings::host::types::types::Error;
use bindings::transact::plugin::intf::add_action_to_transaction;

use psibase::define_trust;
use psibase::fracpack::Pack;
use psibase::{AccountNumber, Memo};

mod errors;
mod graphql;
mod helpers;

use crate::graphql::guild::get_guild;
use crate::helpers::get_sender_app;
use crate::trust::{assert_authorized, assert_authorized_with_whitelist, FunctionName};
use errors::ErrorType;

use bindings::evaluations::plugin::admin::close;
use bindings::evaluations::plugin::user as EvaluationsUser;

use crate::bindings::accounts;

define_trust! {
    descriptions {
        Low => "
            - Closing an evaluation cycle
        ",
        Medium => "
            - Joining a fractal as a member
            - Creating a new guild
            - Applying to join a guild
            - Registering for or unregistering from a guild evaluation
            - Managing guild member invites
            - Attesting guild membership applications
            - Registering or retiring council candidacy
            - Updating guild application information
            - Setting guild display name, bio, and description
            - Setting, resigning, or removing a guild representative
            - Proposing and attesting rankings in an evaluation
        ",
        High => "
            - Starting an evaluation cycle
            - Setting the guild evaluation schedule
            - Setting ranked guilds for scoring
            - Setting the rank ordering threshold
            - Mapping a governance role to a guild
        ",
    }
    functions {
        Low => [close_eval],
        Medium => [
            join_fractal,
            create_guild,
            apply_guild,
            delete_guild_invite,
            set_display_name,
            set_bio,
            set_description,
            set_guild_rep,
            resign_guild_rep,
            remove_guild_rep,
            invite_member,
            attest_membership_app,
            register_candidacy,
            set_guild_app_info,
            register,
            unregister,
            get_proposal,
            attest,
            propose
        ],
        High => [
            set_rank_ordering_threshold,
            set_ranked_guilds,
            set_schedule,
            start_eval,
            set_role_map
        ],
    }
}

impl graphql::guild::Guild {
    fn assert_authorized(&self, function: FunctionName) -> Result<(), Error> {
        assert_authorized_with_whitelist(function, vec![self.fractal.to_string()])
    }

    fn eval_id(&self) -> Result<u32, ErrorType> {
        self.evaluation_id.ok_or(ErrorType::NoPendingEvaluation)
    }
}

struct GuildsPlugin;

impl Queries for GuildsPlugin {
    fn get_guild(guild_account: String) -> Result<GuildWit, Error> {
        get_guild(guild_account).map(|guild| guild.into())
    }
}

impl AdminFractal for GuildsPlugin {
    fn set_role_map(role_id: u8, guild: String) -> Result<(), Error> {
        assert_authorized_with_whitelist(FunctionName::set_role_map, vec!["fractals".to_string()])?;

        let packed_args = guilds::action_structs::set_role_map {
            role_id,
            guild: guild.as_str().into(),
        }
        .packed();
        add_action_to_transaction(
            guilds::action_structs::set_role_map::ACTION_NAME,
            &packed_args,
        )
    }
}

impl UserEval for GuildsPlugin {
    fn register(guild_account: String) -> Result<(), Error> {
        let guild = get_guild(guild_account)?;
        guild.assert_authorized(FunctionName::register)?;

        EvaluationsUser::register(
            &psibase::services::guilds::SERVICE.to_string(),
            guild.eval_id()?,
        )
    }

    fn unregister(guild_account: String) -> Result<(), Error> {
        let guild = get_guild(guild_account)?;
        guild.assert_authorized(FunctionName::unregister)?;

        EvaluationsUser::unregister(
            &psibase::services::guilds::SERVICE.to_string(),
            guild.eval_id()?,
        )
    }

    fn get_group_users(guild_account: String, group_number: u32) -> Result<Vec<String>, Error> {
        let guild = get_guild(guild_account)?;
        EvaluationsUser::get_group_users(
            &psibase::services::guilds::SERVICE.to_string(),
            guild.eval_id()?,
            group_number,
        )
    }

    fn get_proposal(
        guild_account: String,
        group_number: u32,
    ) -> Result<Option<Vec<String>>, Error> {
        let guild = get_guild(guild_account)?;
        guild.assert_authorized(FunctionName::get_proposal)?;
        let evaluation_id = guild.eval_id()?;

        match EvaluationsUser::get_proposal(
            &psibase::services::guilds::SERVICE.to_string(),
            evaluation_id,
            group_number,
        )? {
            None => Ok(None),
            Some(rank_numbers) => {
                let users: Vec<AccountNumber> = EvaluationsUser::get_group_users(
                    &psibase::services::guilds::SERVICE.to_string(),
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

        let all_users: Vec<AccountNumber> = EvaluationsUser::get_group_users(
            &psibase::services::guilds::SERVICE.to_string(),
            evaluation_id,
            group_number,
        )?
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

        EvaluationsUser::propose(
            &psibase::services::guilds::SERVICE.to_string(),
            evaluation_id,
            group_number,
            &res,
        )
    }

    fn attest(guild_account: String, group_number: u32) -> Result<(), Error> {
        let guild = get_guild(guild_account)?;
        guild.assert_authorized(FunctionName::attest)?;
        EvaluationsUser::attest(
            &psibase::services::guilds::SERVICE.to_string(),
            guild.eval_id()?,
            group_number,
        )
    }
}

impl AdminGuild for GuildsPlugin {
    fn close_eval(guild_account: String) -> Result<(), Error> {
        let guild = get_guild(guild_account)?;
        guild.assert_authorized(FunctionName::close_eval)?;

        close(
            &psibase::services::guilds::SERVICE.to_string(),
            guild.eval_id()?,
        )
    }

    fn create_guild(
        display_name: String,
        fractal: String,
        guild_account: String,
    ) -> Result<(), Error> {
        assert_authorized_with_whitelist(FunctionName::create_guild, vec!["fractals".to_string()])?;

        let packed_args = guilds::action_structs::create_guild {
            fractal: fractal.as_str().into(),
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
            guilds::action_structs::create_guild::ACTION_NAME,
            &packed_args,
        )
    }

    fn remove_guild_rep(guild_account: String) -> Result<(), Error> {
        get_guild(guild_account)?.assert_authorized(FunctionName::remove_guild_rep)?;

        let packed_args = guilds::action_structs::remove_g_rep {}.packed();
        add_action_to_transaction(
            guilds::action_structs::remove_g_rep::ACTION_NAME,
            &packed_args,
        )
    }

    fn resign_guild_rep(guild_account: String) -> Result<(), Error> {
        get_guild(guild_account)?.assert_authorized(FunctionName::resign_guild_rep)?;

        let packed_args = guilds::action_structs::resign_g_rep {}.packed();
        add_action_to_transaction(
            guilds::action_structs::resign_g_rep::ACTION_NAME,
            &packed_args,
        )
    }

    fn set_bio(guild: String, bio: String) -> Result<(), Error> {
        get_guild(guild)?.assert_authorized(FunctionName::set_bio)?;

        let packed_args = guilds::action_structs::set_g_bio {
            bio: bio.try_into().unwrap(),
        }
        .packed();

        add_action_to_transaction(guilds::action_structs::set_g_bio::ACTION_NAME, &packed_args)
    }

    fn set_description(guild_account: String, description: String) -> Result<(), Error> {
        get_guild(guild_account)?.assert_authorized(FunctionName::set_description)?;

        let packed_args = guilds::action_structs::set_g_desc { description }.packed();
        add_action_to_transaction(
            guilds::action_structs::set_g_desc::ACTION_NAME,
            &packed_args,
        )
    }

    fn set_display_name(guild: String, display_name: String) -> Result<(), Error> {
        get_guild(guild)?.assert_authorized(FunctionName::set_display_name)?;

        let packed_args = guilds::action_structs::set_g_disp {
            display_name: display_name.try_into().unwrap(),
        }
        .packed();

        add_action_to_transaction(
            guilds::action_structs::set_g_disp::ACTION_NAME,
            &packed_args,
        )
    }

    fn set_guild_rep(guild_account: String, rep: String) -> Result<(), Error> {
        let guild = get_guild(guild_account)?;
        guild.assert_authorized(FunctionName::set_guild_rep)?;

        let packed_args = guilds::action_structs::set_g_rep {
            new_representative: rep.as_str().into(),
        }
        .packed();

        add_action_to_transaction(guilds::action_structs::set_g_rep::ACTION_NAME, &packed_args)
    }

    fn set_rank_ordering_threshold(threshold: u8) -> Result<(), Error> {
        assert_authorized(FunctionName::set_rank_ordering_threshold)?;

        let packed_args = guilds::action_structs::set_thres {
            rank_ordering_threshold: threshold,
        }
        .packed();
        add_action_to_transaction(guilds::action_structs::set_thres::ACTION_NAME, &packed_args)
    }

    fn set_ranked_guilds(ranked_guilds: Vec<String>) -> Result<(), Error> {
        assert_authorized(FunctionName::set_ranked_guilds)?;

        let packed_args = guilds::action_structs::set_rguilds {
            ranked_guilds: ranked_guilds
                .into_iter()
                .map(|g| AccountNumber::from(g.as_str()))
                .collect(),
        }
        .packed();

        add_action_to_transaction(
            guilds::action_structs::set_rguilds::ACTION_NAME,
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

        let packed_args = guilds::action_structs::set_schedule {
            deliberation,
            finish_by,
            interval_seconds,
            registration,
            submission,
        }
        .packed();

        add_action_to_transaction(
            guilds::action_structs::set_schedule::ACTION_NAME,
            &packed_args,
        )
    }

    fn start_eval(guild_account: String) -> Result<(), Error> {
        let guild = get_guild(guild_account.clone())?;
        guild.assert_authorized(FunctionName::start_eval)?;

        let packed_args = guilds::action_structs::start_eval {
            guild_account: guild_account.as_str().into(),
        }
        .packed();

        add_action_to_transaction(
            guilds::action_structs::start_eval::ACTION_NAME,
            &packed_args,
        )
    }
}

impl UserGuild for GuildsPlugin {
    fn apply_guild(guild_account: String, extra_info: String) -> Result<(), Error> {
        get_guild(guild_account.clone())?.assert_authorized(FunctionName::apply_guild)?;

        let packed_args = guilds::action_structs::apply_guild {
            guild_account: guild_account.as_str().into(),
            extra_info,
        }
        .packed();

        add_action_to_transaction(
            guilds::action_structs::apply_guild::ACTION_NAME,
            &packed_args,
        )
    }

    fn attest_membership_app(
        guild_account: String,
        applicant: String,
        comment: String,
        endorses: bool,
    ) -> Result<(), Error> {
        let guild = get_guild(guild_account.clone())?;
        guild.assert_authorized(FunctionName::attest_membership_app)?;

        let packed_args = guilds::action_structs::at_mem_app {
            comment,
            endorses,
            guild_account: guild_account.as_str().into(),
            applicant: applicant.as_str().into(),
        }
        .packed();

        add_action_to_transaction(
            guilds::action_structs::at_mem_app::ACTION_NAME,
            &packed_args,
        )
    }

    fn delete_guild_invite(invite_id: u32) -> Result<(), Error> {
        assert_authorized(FunctionName::delete_guild_invite)?;

        let packed_args = guilds::action_structs::del_g_inv { invite_id }.packed();
        add_action_to_transaction(guilds::action_structs::del_g_inv::ACTION_NAME, &packed_args)
    }

    fn join_fractal() -> Result<(), Error> {
        assert_authorized(FunctionName::join_fractal)?;

        let packed_args = guilds::action_structs::add_member {
            fractal: get_sender_app()?,
        }
        .packed();
        add_action_to_transaction(
            guilds::action_structs::add_member::ACTION_NAME,
            &packed_args,
        )
    }

    fn invite_member(
        guild_account: String,
        num_accounts: u16,
        pre_attest: bool,
    ) -> Result<String, Error> {
        let guild = get_guild(guild_account.clone())?;
        guild.assert_authorized(FunctionName::invite_member)?;

        let d = bindings::invite::plugin::inviter::prepare_new_invite(
            num_accounts,
            &guild.fractal.to_string(),
        )?;

        let packed_args = guilds::action_structs::inv_g_member {
            guild: guild_account.as_str().into(),
            invite_id: d.invite_id,
            invite_payload: d.payload,
            pre_attest,
            num_accounts,
        }
        .packed();

        add_action_to_transaction(
            guilds::action_structs::inv_g_member::ACTION_NAME,
            &packed_args,
        )?;

        Ok(d.invite_token)
    }

    fn register_candidacy(guild_account: String, active: bool) -> Result<(), Error> {
        get_guild(guild_account.clone())?.assert_authorized(FunctionName::register_candidacy)?;

        let packed_args = guilds::action_structs::reg_can {
            guild: guild_account.as_str().into(),
            active,
        }
        .packed();

        add_action_to_transaction(guilds::action_structs::reg_can::ACTION_NAME, &packed_args)
    }

    fn set_guild_app_info(guild_account: String, extra_info: String) -> Result<(), Error> {
        get_guild(guild_account.clone())?.assert_authorized(FunctionName::set_guild_app_info)?;

        let packed_args = guilds::action_structs::set_g_app {
            guild_account: guild_account.as_str().into(),
            extra_info,
        }
        .packed();

        add_action_to_transaction(guilds::action_structs::set_g_app::ACTION_NAME, &packed_args)
    }
}

bindings::export!(GuildsPlugin with_types_in bindings);
