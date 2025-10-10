#[allow(warnings)]
mod bindings;

use bindings::exports::fractal_core::plugin::admin::Guest as Admin;
use bindings::exports::fractal_core::plugin::user::Guest as User;

use bindings::host::types::types::Error;

use psibase::define_trust;

mod errors;

use bindings::fractals::plugin as FractalsPlugin;
use bindings::staged_tx::plugin::proposer::set_propose_latch;
use trust::{assert_authorized, FunctionName};

struct ProposeLatch;

impl ProposeLatch {
    fn new(app: &str) -> Self {
        set_propose_latch(Some(app)).unwrap();
        Self
    }
}

impl Drop for ProposeLatch {
    fn drop(&mut self) {
        set_propose_latch(None).unwrap();
    }
}

define_trust! {
    descriptions {
        Low => "
        Low trust grants these abilities:
            - Starting an evaluation cycle
            - Register for a guild evaluation
            - Unregistering from guild evaluation
            - Closing an evaluation cycle
        ",
        Medium => "
        Medium trust grants the abilities of the Low trust level, plus these abilities:
            - Joining the fractal
            - Applying to join a guild
            - Attesting guild membership for a fractal member
            - Proposing vote in evaluation cycle
            - Retrieving group users in evaluation
            - Retrieving a proposal in evaluation
            - Creating a new guild
            - Attesting in an evaluation
        ",
        High => "
        High trust grants the abilities of all lower trust levels, plus these abilities:
            - Setting the guild evaluation schedule
            - Setting the guild display name
            - Setting the guild bio
            - Setting the guild description
        ",
    }
    functions {
        Low => [start_eval, register, unregister, close_eval],
        Medium => [join, apply_guild, attest_membership_app, propose, get_group_users, get_proposal, create_guild, attest],
        High => [set_schedule, set_guild_display_name, set_guild_bio, set_guild_description],
    }
}

struct FractalCorePlugin;

impl Admin for FractalCorePlugin {
    fn set_schedule(
        guild_account: String,
        registration: u32,
        deliberation: u32,
        submission: u32,
        finish_by: u32,
        interval_seconds: u32,
    ) -> Result<(), Error> {
        assert_authorized(FunctionName::set_schedule)?;
        let _latch = ProposeLatch::new(&guild_account);

        FractalsPlugin::admin::set_schedule(
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
        FractalsPlugin::admin::close_eval(&guild_account)
    }

    fn set_guild_display_name(guild_account: String, display_name: String) -> Result<(), Error> {
        assert_authorized(FunctionName::set_guild_display_name)?;
        let _latch = ProposeLatch::new(&guild_account);
        FractalsPlugin::admin::set_guild_display_name(&guild_account, &display_name)
    }

    fn set_guild_bio(guild_account: String, bio: String) -> Result<(), Error> {
        assert_authorized(FunctionName::set_guild_bio)?;
        let _latch = ProposeLatch::new(&guild_account);
        FractalsPlugin::admin::set_guild_bio(&guild_account, &bio)
    }

    fn set_guild_description(guild_account: String, description: String) -> Result<(), Error> {
        assert_authorized(FunctionName::set_guild_description)?;
        let _latch = ProposeLatch::new(&guild_account);
        FractalsPlugin::admin::set_guild_description(&guild_account, &description)
    }
}

impl User for FractalCorePlugin {
    fn join() -> Result<(), Error> {
        assert_authorized(FunctionName::join)?;
        FractalsPlugin::user::join()
    }

    fn apply_guild(guild_account: String, app: String) -> Result<(), Error> {
        assert_authorized(FunctionName::apply_guild)?;
        FractalsPlugin::user::apply_guild(&guild_account, &app)
    }

    fn attest_membership_app(
        guild_account: String,
        member: String,
        comment: String,
        endorses: bool,
    ) -> Result<(), Error> {
        assert_authorized(FunctionName::attest_membership_app)?;
        FractalsPlugin::user::attest_membership_app(&guild_account, &member, &comment, endorses)
    }

    fn propose(
        guild_account: String,
        group_number: u32,
        proposal: Vec<String>,
    ) -> Result<(), Error> {
        assert_authorized(FunctionName::propose)?;
        FractalsPlugin::user::propose(&guild_account, group_number, &proposal)
    }

    fn get_group_users(guild_account: String, group_number: u32) -> Result<Vec<String>, Error> {
        assert_authorized(FunctionName::get_group_users)?;
        FractalsPlugin::user::get_group_users(&guild_account, group_number)
    }

    fn get_proposal(
        guild_account: String,
        group_number: u32,
    ) -> Result<Option<Vec<String>>, Error> {
        assert_authorized(FunctionName::get_proposal)?;
        FractalsPlugin::user::get_proposal(&guild_account, group_number)
    }

    fn start_eval(guild_account: String) -> Result<(), Error> {
        assert_authorized(FunctionName::start_eval)?;
        FractalsPlugin::admin::start(&guild_account)
    }

    fn create_guild(display_name: String, account: String) -> Result<(), Error> {
        assert_authorized(FunctionName::create_guild)?;
        FractalsPlugin::user::create_guild(&display_name, &account)
    }

    fn attest(guild_account: String, group_number: u32) -> Result<(), Error> {
        assert_authorized(FunctionName::attest)?;
        FractalsPlugin::user::attest(&guild_account, group_number)
    }

    fn register(guild_account: String) -> Result<(), Error> {
        assert_authorized(FunctionName::register)?;
        FractalsPlugin::user::register(&guild_account)
    }

    fn unregister(guild_account: String) -> Result<(), Error> {
        assert_authorized(FunctionName::unregister)?;
        FractalsPlugin::user::unregister(&guild_account)
    }
}

bindings::export!(FractalCorePlugin with_types_in bindings);
