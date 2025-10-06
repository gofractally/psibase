#[allow(warnings)]
mod bindings;

use bindings::exports::fractal_core::plugin::admin::Guest as Admin;
use bindings::exports::fractal_core::plugin::user::Guest as User;

use bindings::host::types::types::Error;

use psibase::define_trust;

mod errors;

use bindings::fractals::plugin as FractalsPlugin;
use bindings::staged_tx::plugin::proposer::set_propose_latch;

use crate::bindings::host::common::client::get_receiver;

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
        guild_slug: String,
        registration: u32,
        deliberation: u32,
        submission: u32,
        finish_by: u32,
        interval_seconds: u32,
    ) -> Result<(), Error> {
        let _latch = ProposeLatch::new(&get_receiver());

        FractalsPlugin::admin::set_schedule(
            &guild_slug,
            registration,
            deliberation,
            submission,
            finish_by,
            interval_seconds,
        )
    }

    fn close_eval(guild_slug: String) -> Result<(), Error> {
        FractalsPlugin::admin::close_eval(&guild_slug)
    }
}

impl User for FractalCorePlugin {
    fn join() -> Result<(), Error> {
        trust::assert_authorized(trust::FunctionName::start_eval)?;

        FractalsPlugin::user::join()
    }

    fn apply_guild(guild_slug: String, app: String) -> Result<(), Error> {
        FractalsPlugin::user::apply_guild(&guild_slug, &app)
    }

    fn attest_membership_app(
        guild_slug: String,
        member: String,
        comment: String,
        endorses: bool,
    ) -> Result<(), Error> {
        FractalsPlugin::user::attest_membership_app(&guild_slug, &member, &comment, endorses)
    }

    fn propose(guild_slug: String, group_number: u32, proposal: Vec<String>) -> Result<(), Error> {
        FractalsPlugin::user::propose(&guild_slug, group_number, &proposal)
    }

    fn get_group_users(guild_slug: String, group_number: u32) -> Result<Vec<String>, Error> {
        FractalsPlugin::user::get_group_users(&guild_slug, group_number)
    }

    fn get_proposal(guild_slug: String, group_number: u32) -> Result<Option<Vec<String>>, Error> {
        FractalsPlugin::user::get_proposal(&guild_slug, group_number)
    }

    fn start_eval(guild_slug: String) -> Result<(), Error> {
        trust::assert_authorized(trust::FunctionName::start_eval)?;

        FractalsPlugin::admin::start(&guild_slug)
    }

    fn create_guild(display_name: String, slug: String) -> Result<(), Error> {
        trust::assert_authorized(trust::FunctionName::start_eval)?;

        FractalsPlugin::user::create_guild(&display_name, &slug)
    }

    fn attest(guild_slug: String, group_number: u32) -> Result<(), Error> {
        FractalsPlugin::user::attest(&guild_slug, group_number)
    }

    fn register(slug: String) -> Result<(), Error> {
        FractalsPlugin::user::register(&slug)
    }

    fn unregister(slug: String) -> Result<(), Error> {
        FractalsPlugin::user::unregister(&slug)
    }
}

bindings::export!(FractalCorePlugin with_types_in bindings);
