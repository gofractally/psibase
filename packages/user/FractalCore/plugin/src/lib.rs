#[allow(warnings)]
mod bindings;

use bindings::exports::fractal_core::plugin::admin_fractal::Guest as AdminFractal;
use bindings::exports::fractal_core::plugin::admin_guild::Guest as AdminGuild;

use bindings::exports::fractal_core::plugin::user_eval::Guest as UserEval;
use bindings::exports::fractal_core::plugin::user_fractal::Guest as UserFractal;
use bindings::exports::fractal_core::plugin::user_guild::Guest as UserGuild;

use bindings::host::types::types::Error;

use psibase::define_trust;
mod errors;
mod propose;

use bindings::fractals::plugin as FractalsPlugin;

use trust::{assert_authorized, FunctionName};

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
            - Conclude membership applications
            - Set token init and guild ranking threshold
            ",
    }
    functions {
        None => [get_group_users],
        Low => [close_eval, dist_token, start_eval],
        Medium => [apply_guild, attest_membership_app, get_proposal, join, register, register_candidacy, unregister],
        High => [attest, con_membership_app, create_guild, exile_member, init_token, propose, remove_guild_rep, resign_guild_rep, set_bio, set_description, set_display_name, set_dist_interval, set_guild_rep, set_min_scorers, set_rank_ordering_threshold, set_ranked_guild_slots, set_ranked_guilds, set_schedule, set_token_threshold],
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

impl AdminGuild for FractalCorePlugin {
    fn con_membership_app(
        guild_account: String,
        member: String,
        accepted: bool,
    ) -> Result<(), Error> {
        assert_authorized(FunctionName::con_membership_app)?;
        propose::guild(&guild_account)?;

        FractalsPlugin::admin_guild::con_membership_app(&guild_account, &member, accepted)
    }

    fn set_rank_ordering_threshold(guild_account: String, threshold: u8) -> Result<(), Error> {
        assert_authorized(FunctionName::set_rank_ordering_threshold)?;
        propose::guild(&guild_account)?;

        FractalsPlugin::admin_guild::set_rank_ordering_threshold(threshold)
    }

    fn set_guild_rep(guild_account: String, rep: String) -> Result<(), Error> {
        assert_authorized(FunctionName::set_guild_rep)?;
        propose::guild(&guild_account)?;

        FractalsPlugin::admin_guild::set_guild_rep(&guild_account, &rep)
    }

    fn resign_guild_rep(guild_account: String) -> Result<(), Error> {
        assert_authorized(FunctionName::resign_guild_rep)?;
        propose::representative(&guild_account)?;

        FractalsPlugin::admin_guild::resign_guild_rep(&guild_account)
    }

    fn remove_guild_rep(guild_account: String) -> Result<(), Error> {
        assert_authorized(FunctionName::remove_guild_rep)?;
        propose::council(&guild_account)?;

        FractalsPlugin::admin_guild::remove_guild_rep(&guild_account)
    }

    fn set_schedule(
        guild_account: String,
        registration: u32,
        deliberation: u32,
        submission: u32,
        finish_by: u32,
        interval_seconds: u32,
    ) -> Result<(), Error> {
        assert_authorized(FunctionName::set_schedule)?;
        propose::guild(&guild_account)?;

        FractalsPlugin::admin_guild::set_eval_schedule(
            &guild_account,
            registration,
            deliberation,
            submission,
            finish_by,
            interval_seconds,
        )
    }

    fn close_eval(guild_account: String) -> Result<(), Error> {
        assert_authorized(FunctionName::close_eval)?;
        FractalsPlugin::admin_guild::close_eval(&guild_account)
    }

    fn set_display_name(guild_account: String, display_name: String) -> Result<(), Error> {
        assert_authorized(FunctionName::set_display_name)?;
        propose::guild(&guild_account)?;
        FractalsPlugin::admin_guild::set_display_name(&guild_account, &display_name)
    }

    fn set_bio(guild_account: String, bio: String) -> Result<(), Error> {
        assert_authorized(FunctionName::set_bio)?;
        propose::guild(&guild_account)?;
        FractalsPlugin::admin_guild::set_bio(&guild_account, &bio)
    }

    fn set_description(guild_account: String, description: String) -> Result<(), Error> {
        assert_authorized(FunctionName::set_description)?;
        propose::guild(&guild_account)?;
        FractalsPlugin::admin_guild::set_description(&guild_account, &description)
    }

    fn start_eval(guild_account: String) -> Result<(), Error> {
        assert_authorized(FunctionName::start_eval)?;
        FractalsPlugin::admin_guild::start_eval(&guild_account)
    }

    fn create_guild(display_name: String, account: String) -> Result<(), Error> {
        assert_authorized(FunctionName::create_guild)?;
        FractalsPlugin::admin_guild::create_guild(&display_name, &account)
    }
}

impl UserEval for FractalCorePlugin {
    fn propose(
        guild_account: String,
        group_number: u32,
        proposal: Vec<String>,
    ) -> Result<(), Error> {
        assert_authorized(FunctionName::propose)?;
        FractalsPlugin::user_eval::propose(&guild_account, group_number, &proposal)
    }

    fn get_group_users(guild_account: String, group_number: u32) -> Result<Vec<String>, Error> {
        FractalsPlugin::user_eval::get_group_users(&guild_account, group_number)
    }

    fn get_proposal(
        guild_account: String,
        group_number: u32,
    ) -> Result<Option<Vec<String>>, Error> {
        assert_authorized(FunctionName::get_proposal)?;
        FractalsPlugin::user_eval::get_proposal(&guild_account, group_number)
    }

    fn attest(guild_account: String, group_number: u32) -> Result<(), Error> {
        assert_authorized(FunctionName::attest)?;
        FractalsPlugin::user_eval::attest(&guild_account, group_number)
    }

    fn register(guild_account: String) -> Result<(), Error> {
        assert_authorized(FunctionName::register)?;
        FractalsPlugin::user_eval::register(&guild_account)
    }

    fn unregister(guild_account: String) -> Result<(), Error> {
        assert_authorized(FunctionName::unregister)?;
        FractalsPlugin::user_eval::unregister(&guild_account)
    }
}

impl UserFractal for FractalCorePlugin {
    fn join() -> Result<(), Error> {
        assert_authorized(FunctionName::join)?;
        FractalsPlugin::user_fractal::join()
    }

    fn dist_token() -> Result<(), Error> {
        assert_authorized(FunctionName::dist_token)?;
        FractalsPlugin::user_fractal::dist_token()
    }
}

impl UserGuild for FractalCorePlugin {
    fn apply_guild(guild_account: String, app: String) -> Result<(), Error> {
        assert_authorized(FunctionName::apply_guild)?;
        FractalsPlugin::user_guild::apply_guild(&guild_account, &app)
    }

    fn register_candidacy(guild_account: String, active: bool) -> Result<(), Error> {
        assert_authorized(FunctionName::register_candidacy)?;
        FractalsPlugin::user_guild::register_candidacy(&guild_account, active)
    }

    fn attest_membership_app(
        guild_account: String,
        applicant: String,
        comment: String,
        endorses: bool,
    ) -> Result<(), Error> {
        assert_authorized(FunctionName::attest_membership_app)?;
        FractalsPlugin::user_guild::attest_membership_app(
            &guild_account,
            &applicant,
            &comment,
            endorses,
        )
    }
}

bindings::export!(FractalCorePlugin with_types_in bindings);
