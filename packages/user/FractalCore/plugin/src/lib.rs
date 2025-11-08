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

use bindings::fractals::plugin as FractalsPlugin;
use bindings::staged_tx::plugin::proposer::set_propose_latch;
use trust::{assert_authorized, FunctionName};

define_trust! {
    descriptions {
        Low => "
        Low trust grants these abilities:
            - Starting an evaluation cycle
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
            ",
            High => "
            High trust grants the abilities of all lower trust levels, plus these abilities:
            - Proposing a vote in evaluation cycle
            - Exiling a member from a fractal
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
        Low => [start_eval, close_eval],
        Medium => [join, register, unregister, apply_guild, attest_membership_app, get_proposal],
        High => [exile_member, propose, set_schedule, set_display_name, set_bio, set_description, attest, create_guild],
    }
}

struct FractalCorePlugin;

impl AdminFractal for FractalCorePlugin {
    fn exile_member(fractal_account: String, member_account: String) -> Result<(), Error> {
        assert_authorized(FunctionName::exile_member)?;
        set_propose_latch(Some(&fractal_account))?;

        FractalsPlugin::admin_fractal::exile_member(&member_account)
    }
}

impl AdminGuild for FractalCorePlugin {
    fn set_schedule(
        guild_account: String,
        registration: u32,
        deliberation: u32,
        submission: u32,
        finish_by: u32,
        interval_seconds: u32,
    ) -> Result<(), Error> {
        assert_authorized(FunctionName::set_schedule)?;

        set_propose_latch(Some(&guild_account))?;

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
        set_propose_latch(Some(&guild_account))?;
        FractalsPlugin::admin_guild::set_display_name(&guild_account, &display_name)
    }

    fn set_bio(guild_account: String, bio: String) -> Result<(), Error> {
        assert_authorized(FunctionName::set_bio)?;
        set_propose_latch(Some(&guild_account))?;
        FractalsPlugin::admin_guild::set_bio(&guild_account, &bio)
    }

    fn set_description(guild_account: String, description: String) -> Result<(), Error> {
        assert_authorized(FunctionName::set_description)?;
        set_propose_latch(Some(&guild_account))?;
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
}

impl UserGuild for FractalCorePlugin {
    fn apply_guild(guild_account: String, app: String) -> Result<(), Error> {
        assert_authorized(FunctionName::apply_guild)?;
        FractalsPlugin::user_guild::apply_guild(&guild_account, &app)
    }

    fn attest_membership_app(
        guild_account: String,
        member: String,
        comment: String,
        endorses: bool,
    ) -> Result<(), Error> {
        assert_authorized(FunctionName::attest_membership_app)?;
        FractalsPlugin::user_guild::attest_membership_app(
            &guild_account,
            &member,
            &comment,
            endorses,
        )
    }
}

bindings::export!(FractalCorePlugin with_types_in bindings);
