#[allow(warnings)]
mod bindings;

use bindings::exports::fractals::plugin::admin_fractal::Guest as AdminFractal;
use bindings::exports::fractals::plugin::queries::Guest as Queries;
use bindings::exports::fractals::plugin::user_fractal::Guest as UserFractal;

use bindings::host::types::types::Error;
use bindings::transact::plugin::intf::add_action_to_transaction;

use psibase::fracpack::Pack;

mod errors;
mod graphql;
mod helpers;
use psibase::AccountNumber;

use crate::bindings::accounts::plugin::api::gen_rand_account;
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
            - Create and delete guild member invites
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
            - Set token init and guild ranking threshold
            ",
    }
    functions {
        None => [exile_member, get_group_users, init_token, set_dist_interval],
        Low => [close_eval, dist_token, start],
        Medium => [apply_guild, delete_guild_invite, set_guild_app_info, invite_member, attest_membership_app, create_fractal, get_proposal, join, register, register_candidacy, unregister],
        High => [attest, create_guild, propose, remove_guild_rep, resign_guild_rep, set_bio, set_description, set_display_name, set_guild_rep, set_min_scorers, set_rank_ordering_threshold, set_ranked_guild_slots, set_ranked_guilds, set_schedule],
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
    fn create_fractal(
        fractal_account: String,
        guild_account: String,
        name: String,
        mission: String,
    ) -> Result<(), Error> {
        assert_authorized(FunctionName::create_fractal)?;
        let packed_args = fractals::action_structs::create_fractal {
            fractal_account: fractal_account.parse().unwrap(),
            name,
            mission,
            judiciary: gen_rand_account(None)?.as_str().into(),
            legislature: gen_rand_account(None)?.as_str().into(),
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

impl UserFractal for FractallyPlugin {
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
