#[allow(warnings)]
mod bindings;

use std::str::FromStr;

use bindings::accounts;
use bindings::evaluations::plugin::{admin::close, user as EvaluationsUser};
use bindings::exports::guilds::plugin::{
    admin_fractal::Guest as AdminFractal,
    admin_guild::Guest as AdminGuild,
    queries::{Guest as Queries, Guild as GuildWit},
    user_eval::Guest as UserEval,
    user_guild::Guest as UserGuild,
};

use psibase::{AccountNumber, Memo};
use psibase_plugin::{trust::*, *};

use guilds::Wrapper as Guilds;

mod errors;
mod graphql;
mod helpers;

use crate::graphql::guild::get_guild;
use crate::helpers::{get_sender_app, parent_fractal};
use errors::ErrorType;

struct GuildsPlugin;

impl TrustConfig for GuildsPlugin {
    fn capabilities() -> Capabilities {
        Capabilities {
            low: &["Closing an evaluation cycle"],
            medium: &[
                "Joining a fractal as a member",
                "Creating a new guild",
                "Applying to join a guild",
                "Cancelling a guild application",
                "Registering for or unregistering from a guild evaluation",
                "Managing guild member invites",
                "Attesting guild membership applications",
                "Withdrawing a guild membership attestation",
                "Registering or retiring council candidacy",
                "Updating guild application information",
                "Setting guild display name, bio, and description",
                "Setting, resigning, or removing a guild representative",
                "Proposing and attesting rankings in an evaluation",
            ],
            high: &[
                "Starting an evaluation cycle",
                "Setting the guild evaluation schedule",
                "Setting ranked guilds for scoring",
                "Setting the rank ordering threshold",
                "Setting the guild candidacy cooldown",
                "Mapping a governance role to a guild",
                "Enabling auto-join to fractal for ranked-guild members",
            ],
        }
    }
}

impl graphql::guild::Guild {
    fn eval_id(&self) -> Result<u32, ErrorType> {
        self.evaluation_id.ok_or(ErrorType::NoPendingEvaluation)
    }
}

impl Queries for GuildsPlugin {
    fn get_guild(guild_account: String) -> Result<GuildWit, Error> {
        get_guild(&guild_account).map(|guild| guild.into())
    }
}

impl AdminFractal for GuildsPlugin {
    #[psibase_plugin::authorized(High, whitelist = ["fractals"])]
    fn set_role_map(role_id: u8, guild: String) -> Result<(), Error> {
        Guilds::add_to_tx().set_role_map(role_id, guild.as_str().into());
        Ok(())
    }

    #[psibase_plugin::authorized(High, whitelist = ["fractals"])]
    fn set_auto_join_fractal(enabled: bool) -> Result<(), Error> {
        Guilds::add_to_tx().set_auto_join(enabled);
        Ok(())
    }
}

impl UserEval for GuildsPlugin {
    #[psibase_plugin::authorized(Medium, whitelist = [parent_fractal(&guild_account)?.as_str()])]
    fn register(guild_account: String) -> Result<(), Error> {
        let guild = get_guild(&guild_account)?;
        EvaluationsUser::register(
            &psibase::services::guilds::SERVICE.to_string(),
            guild.eval_id()?,
        )
    }

    #[psibase_plugin::authorized(Medium, whitelist = [parent_fractal(&guild_account)?.as_str()])]
    fn unregister(guild_account: String) -> Result<(), Error> {
        let guild = get_guild(&guild_account)?;
        EvaluationsUser::unregister(
            &psibase::services::guilds::SERVICE.to_string(),
            guild.eval_id()?,
        )
    }

    fn get_group_users(guild_account: String, group_number: u32) -> Result<Vec<String>, Error> {
        let guild = get_guild(&guild_account)?;
        EvaluationsUser::get_group_users(
            &psibase::services::guilds::SERVICE.to_string(),
            guild.eval_id()?,
            group_number,
        )
    }

    #[psibase_plugin::authorized(Medium, whitelist = [parent_fractal(&guild_account)?.as_str()])]
    fn get_proposal(
        guild_account: String,
        group_number: u32,
    ) -> Result<Option<Vec<String>>, Error> {
        let guild = get_guild(&guild_account)?;
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

                let res: Vec<String> = guilds::helpers::parse_rank_to_accounts(rank_numbers, users)
                    .into_iter()
                    .map(|user| user.to_string())
                    .collect();

                Ok(Some(res))
            }
        }
    }

    #[psibase_plugin::authorized(Medium, whitelist = [parent_fractal(&guild_account)?.as_str()])]
    fn propose(
        guild_account: String,
        group_number: u32,
        proposal: Vec<String>,
    ) -> Result<(), Error> {
        let guild = get_guild(&guild_account)?;
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

    #[psibase_plugin::authorized(Medium, whitelist = [parent_fractal(&guild_account)?.as_str()])]
    fn attest(guild_account: String, group_number: u32) -> Result<(), Error> {
        let guild = get_guild(&guild_account)?;
        EvaluationsUser::attest(
            &psibase::services::guilds::SERVICE.to_string(),
            guild.eval_id()?,
            group_number,
        )
    }
}

impl AdminGuild for GuildsPlugin {
    #[psibase_plugin::authorized(Low, whitelist = [parent_fractal(&guild_account)?.as_str()])]
    fn close_eval(guild_account: String) -> Result<(), Error> {
        let guild = get_guild(&guild_account)?;
        close(
            &psibase::services::guilds::SERVICE.to_string(),
            guild.eval_id()?,
        )
    }

    #[psibase_plugin::authorized(Medium, whitelist = ["fractals"])]
    fn create_guild(
        display_name: String,
        fractal: String,
        guild_account: String,
    ) -> Result<(), Error> {
        Guilds::add_to_tx().create_guild(
            fractal.as_str().into(),
            guild_account.as_str().into(),
            Memo::try_from(display_name).unwrap(),
            accounts::plugin::api::gen_rand_account(Some("c-"))?
                .as_str()
                .into(),
            accounts::plugin::api::gen_rand_account(Some("r-"))?
                .as_str()
                .into(),
        );
        Ok(())
    }

    #[psibase_plugin::authorized(Medium, whitelist = [parent_fractal(&guild_account)?.as_str()])]
    fn remove_guild_rep(guild_account: String) -> Result<(), Error> {
        Guilds::add_to_tx().remove_g_rep();
        Ok(())
    }

    #[psibase_plugin::authorized(Medium, whitelist = [parent_fractal(&guild_account)?.as_str()])]
    fn resign_guild_rep(guild_account: String) -> Result<(), Error> {
        Guilds::add_to_tx().resign_g_rep();
        Ok(())
    }

    #[psibase_plugin::authorized(Medium, whitelist = [parent_fractal(&guild)?.as_str()])]
    fn set_bio(guild: String, bio: String) -> Result<(), Error> {
        Guilds::add_to_tx().set_g_bio(bio.try_into().unwrap());
        Ok(())
    }

    #[psibase_plugin::authorized(Medium, whitelist = [parent_fractal(&guild_account)?.as_str()])]
    fn set_description(guild_account: String, description: String) -> Result<(), Error> {
        Guilds::add_to_tx().set_g_desc(description);
        Ok(())
    }

    #[psibase_plugin::authorized(Medium, whitelist = [parent_fractal(&guild)?.as_str()])]
    fn set_display_name(guild: String, display_name: String) -> Result<(), Error> {
        Guilds::add_to_tx().set_g_disp(display_name.try_into().unwrap());
        Ok(())
    }

    #[psibase_plugin::authorized(Medium, whitelist = [parent_fractal(&guild_account)?.as_str()])]
    fn set_guild_rep(guild_account: String, rep: String) -> Result<(), Error> {
        Guilds::add_to_tx().set_g_rep(rep.as_str().into());
        Ok(())
    }

    #[psibase_plugin::authorized(High)]
    fn set_rank_ordering_threshold(threshold: u8) -> Result<(), Error> {
        Guilds::add_to_tx().set_thres(threshold);
        Ok(())
    }

    #[psibase_plugin::authorized(High)]
    fn set_candidacy_cooldown(cooldown: u32) -> Result<(), Error> {
        Guilds::add_to_tx().set_can_cd(cooldown);
        Ok(())
    }

    #[psibase_plugin::authorized(High, whitelist = ["fractals"])]
    fn set_ranked_guilds(ranked_guilds: Vec<String>) -> Result<(), Error> {
        Guilds::add_to_tx().set_rguilds(
            ranked_guilds
                .into_iter()
                .map(|g| AccountNumber::from(g.as_str()))
                .collect(),
        );
        Ok(())
    }

    #[psibase_plugin::authorized(High, whitelist = [parent_fractal(&guild_account)?.as_str()])]
    fn set_schedule(
        guild_account: String,
        registration: u32,
        deliberation: u32,
        submission: u32,
        finish_by: u32,
        interval_seconds: u32,
    ) -> Result<(), Error> {
        Guilds::add_to_tx().set_schedule(
            registration,
            deliberation,
            submission,
            finish_by,
            interval_seconds,
        );
        Ok(())
    }

    #[psibase_plugin::authorized(High, whitelist = [parent_fractal(&guild_account)?.as_str()])]
    fn start_eval(guild_account: String) -> Result<(), Error> {
        Guilds::add_to_tx().start_eval(guild_account.as_str().into());
        Ok(())
    }
}

impl UserGuild for GuildsPlugin {
    #[psibase_plugin::authorized(Medium, whitelist = [parent_fractal(&guild_account)?.as_str()])]
    fn apply_guild(guild_account: String, extra_info: String) -> Result<(), Error> {
        Guilds::add_to_tx().apply_guild(guild_account.as_str().into(), extra_info);
        Ok(())
    }

    #[psibase_plugin::authorized(Medium, whitelist = [parent_fractal(&guild_account)?.as_str()])]
    fn cancel_guild_app(guild_account: String) -> Result<(), Error> {
        Guilds::add_to_tx().cancel_g_app(guild_account.as_str().into());
        Ok(())
    }

    #[psibase_plugin::authorized(Medium, whitelist = [parent_fractal(&guild_account)?.as_str()])]
    fn attest_membership_app(
        guild_account: String,
        applicant: String,
        comment: String,
        endorses: bool,
    ) -> Result<(), Error> {
        Guilds::add_to_tx().at_mem_app(
            guild_account.as_str().into(),
            applicant.as_str().into(),
            comment,
            endorses,
        );
        Ok(())
    }

    #[psibase_plugin::authorized(Medium, whitelist = [parent_fractal(&guild_account)?.as_str()])]
    fn remove_attestation(guild_account: String, applicant: String) -> Result<(), Error> {
        Guilds::add_to_tx().rm_attest(guild_account.as_str().into(), applicant.as_str().into());
        Ok(())
    }

    #[psibase_plugin::authorized(Medium)]
    fn delete_guild_invite(invite_id: u32) -> Result<(), Error> {
        Guilds::add_to_tx().del_g_inv(invite_id);
        Ok(())
    }

    #[psibase_plugin::authorized(Medium)]
    fn join_fractal() -> Result<(), Error> {
        Guilds::add_to_tx().add_member(get_sender_app()?);
        Ok(())
    }

    #[psibase_plugin::authorized(Medium, whitelist = [parent_fractal(&guild_account)?.as_str()])]
    fn invite_member(
        guild_account: String,
        num_accounts: u16,
        pre_attest: bool,
    ) -> Result<String, Error> {
        let guild = get_guild(&guild_account)?;

        let d = bindings::invite::plugin::inviter::prepare_new_invite(
            num_accounts,
            &guild.fractal.to_string(),
        )?;

        Guilds::add_to_tx().inv_g_member(
            guild_account.as_str().into(),
            d.invite_id,
            d.payload,
            num_accounts,
            pre_attest,
        );

        Ok(d.invite_token)
    }

    #[psibase_plugin::authorized(Medium, whitelist = [parent_fractal(&guild_account)?.as_str()])]
    fn register_candidacy(guild_account: String, active: bool) -> Result<(), Error> {
        Guilds::add_to_tx().reg_can(guild_account.as_str().into(), active);
        Ok(())
    }

    #[psibase_plugin::authorized(Medium, whitelist = [parent_fractal(&guild_account)?.as_str()])]
    fn set_guild_app_info(guild_account: String, extra_info: String) -> Result<(), Error> {
        Guilds::add_to_tx().set_g_app(guild_account.as_str().into(), extra_info);
        Ok(())
    }
}

bindings::export!(GuildsPlugin with_types_in bindings);
