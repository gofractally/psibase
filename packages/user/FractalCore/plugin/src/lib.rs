#[allow(warnings)]
mod bindings;

use bindings::exports::fractal_core::plugin::admin_fractal::Guest as AdminFractal;

use bindings::exports::fractal_core::plugin::user_fractal::Guest as UserFractal;

use bindings::host::types::types::Error;

use psibase::{define_trust, fracpack::Pack};
mod errors;
mod propose;

use bindings::fractals::plugin as FractalsPlugin;

use trust::{assert_authorized, FunctionName};

use crate::bindings::host::db::store::{
    Bucket, Database, DbMode::Transactional, StorageDuration::Persistent,
};

define_trust! {
    descriptions {
        Low => "
            - Starting an evaluation cycle
            - Closing an evaluation cycle
            - Trigger a fractal wide token distribution
            - Initialise fractal token
        ",
        Medium => "
            - Joining the fractal
            - Registering for a guild evaluation
            - Create and delete guild member invites
            - Unregistering from guild evaluation
            - Applying to join a guild
            - Attesting guild membership for a fractal member
            - Retrieving a proposal in evaluation
        ",
        High => "
            - Proposing a vote in evaluation cycle
            - Exiling a member from a fractal
            - Set the fractal token distribution schedule
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
        None => [get_group_users],
        Low => [close_eval, dist_token, start_eval],
        Medium => [apply_guild, push_application, draft_application, delete_guild_invite, invite_member, attest_membership_app, get_proposal, join, register, register_candidacy, unregister],
        High => [attest, create_guild, exile_member, init_token, propose, remove_guild_rep, resign_guild_rep, set_bio, set_description, set_display_name, set_dist_interval, set_guild_rep, set_min_scorers, set_rank_ordering_threshold, set_ranked_guild_slots, set_ranked_guilds, set_schedule, set_token_threshold],
    }
}

struct FractalCorePlugin;

impl AdminFractal for FractalCorePlugin {
    fn set_ranked_guild_slots(slots_count: u8) -> Result<(), Error> {
        assert_authorized(FunctionName::set_ranked_guild_slots)?;
        propose::legislature()?;

        FractalsPlugin::admin_fractal::set_ranked_guild_slots(slots_count)
    }

    fn set_ranked_guilds(ranked_guilds: Vec<String>) -> Result<(), Error> {
        assert_authorized(FunctionName::set_ranked_guilds)?;
        propose::legislature()?;

        FractalsPlugin::admin_fractal::set_ranked_guilds(ranked_guilds.as_slice())
    }

    fn set_dist_interval(interval_seconds: u32) -> Result<(), Error> {
        assert_authorized(FunctionName::set_dist_interval)?;
        propose::legislature()?;

        FractalsPlugin::admin_fractal::set_dist_interval(interval_seconds)
    }

    fn exile_member(member_account: String) -> Result<(), Error> {
        assert_authorized(FunctionName::exile_member)?;
        propose::judiciary()?;

        FractalsPlugin::admin_fractal::exile_member(&member_account)
    }

    fn set_token_threshold(threshold: u8) -> Result<(), Error> {
        assert_authorized(FunctionName::set_token_threshold)?;
        propose::judiciary()?;

        FractalsPlugin::admin_fractal::set_token_threshold(threshold)
    }

    fn init_token() -> Result<(), Error> {
        assert_authorized(FunctionName::init_token)?;
        propose::judiciary()?;

        FractalsPlugin::admin_fractal::init_token()
    }
}

impl UserFractal for FractalCorePlugin {
    fn dist_token() -> Result<(), Error> {
        assert_authorized(FunctionName::dist_token)?;
        FractalsPlugin::user_fractal::dist_token()
    }
}

impl FractalCorePlugin {
    fn draft_bucket() -> Bucket {
        Bucket::new(
            Database {
                mode: Transactional,
                duration: Persistent,
            },
            "drafts",
        )
    }
}

bindings::export!(FractalCorePlugin with_types_in bindings);
