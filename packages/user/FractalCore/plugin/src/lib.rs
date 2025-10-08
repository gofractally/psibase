#[allow(warnings)]
mod bindings;

use bindings::exports::fractal_core::plugin::admin::Guest as Admin;
use bindings::exports::fractal_core::plugin::user::Guest as User;

use bindings::host::types::types::Error;

use psibase::define_trust;

mod errors;

use bindings::fractals::plugin as FractalsPlugin;
use bindings::staged_tx::plugin::proposer::set_propose_latch;

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
            - Reading the value of the example-thing
        ",
        Medium => "",
        High => "
        High trust grants the abilities of all lower trust levels, plus these abilities:
            - Setting the example thing
        ",
    }
    functions {
        Low => [],
        High => [start_eval],
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
        let _latch = ProposeLatch::new(&guild_account);

        FractalsPlugin::admin::set_schedule(
            registration,
            deliberation,
            submission,
            finish_by,
            interval_seconds,
        )
    }

    fn close_eval(guild_account: String) -> Result<(), Error> {
        FractalsPlugin::admin::close_eval(&guild_account)
    }
}

impl User for FractalCorePlugin {
    fn join() -> Result<(), Error> {
        trust::assert_authorized(trust::FunctionName::start_eval)?;

        FractalsPlugin::user::join()
    }

    fn apply_guild(guild_account: String, app: String) -> Result<(), Error> {
        FractalsPlugin::user::apply_guild(&guild_account, &app)
    }

    fn attest_membership_app(
        guild_account: String,
        member: String,
        comment: String,
        endorses: bool,
    ) -> Result<(), Error> {
        FractalsPlugin::user::attest_membership_app(&guild_account, &member, &comment, endorses)
    }

    fn propose(
        guild_account: String,
        group_number: u32,
        proposal: Vec<String>,
    ) -> Result<(), Error> {
        FractalsPlugin::user::propose(&guild_account, group_number, &proposal)
    }

    fn get_group_users(guild_account: String, group_number: u32) -> Result<Vec<String>, Error> {
        FractalsPlugin::user::get_group_users(&guild_account, group_number)
    }

    fn get_proposal(
        guild_account: String,
        group_number: u32,
    ) -> Result<Option<Vec<String>>, Error> {
        FractalsPlugin::user::get_proposal(&guild_account, group_number)
    }

    fn start_eval(guild_account: String) -> Result<(), Error> {
        trust::assert_authorized(trust::FunctionName::start_eval)?;

        FractalsPlugin::admin::start(&guild_account)
    }

    fn create_guild(display_name: String, slug: String) -> Result<(), Error> {
        trust::assert_authorized(trust::FunctionName::start_eval)?;

        FractalsPlugin::user::create_guild(&display_name, &slug)
    }

    fn attest(guild_account: String, group_number: u32) -> Result<(), Error> {
        FractalsPlugin::user::attest(&guild_account, group_number)
    }

    fn register(guild_account: String) -> Result<(), Error> {
        FractalsPlugin::user::register(&guild_account)
    }

    fn unregister(guild_account: String) -> Result<(), Error> {
        FractalsPlugin::user::unregister(&guild_account)
    }
}

bindings::export!(FractalCorePlugin with_types_in bindings);
