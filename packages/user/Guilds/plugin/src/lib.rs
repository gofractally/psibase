#[allow(warnings)]
mod bindings;

use bindings::exports::guilds::plugin::admin_guild::Guest as AdminGuild;
use bindings::exports::guilds::plugin::user_guild::Guest as UserGuild;

use bindings::exports::guilds::plugin::api::Guest as Api;

use bindings::host::common::server as CommonServer;
use bindings::host::types::types::Error;
use bindings::transact::plugin::intf::add_action_to_transaction;

use psibase::define_trust;
use psibase::fracpack::Pack;

mod errors;
use errors::ErrorType;

use bindings::evaluations::plugin::admin::close;
use bindings::evaluations::plugin::user as EvaluationsUser;

mod graphql;

define_trust! {
    descriptions {
        Low => "
            - Reading the value of the example-thing
        ",
        Medium => "",
        High => "
            - Setting the example thing
        ",
    }
    functions {
        Low => [get_example_thing],
        High => [set_example_thing],
    }
}

struct GuildsPlugin;

impl AdminGuild for GuildsPlugin {
    fn close_eval(guild_account: String) -> Result<(), Error> {
        let guild = get_guild(guild_account)?;
        guild.assert_authorized(FunctionName::close_eval)?;

        close(&"fractals".to_string(), guild.eval_id()?)
    }
}

impl UserGuild for GuildsPlugin {}

impl Api for GuildsPlugin {
    fn set_example_thing(thing: String) -> Result<(), Error> {
        // trust::assert_authorized(trust::FunctionName::set_example_thing)?;
        // let packed_example_thing_args = guilds::action_structs::setExampleThing { thing }.packed();
        // add_action_to_transaction("setExampleThing", &packed_example_thing_args).unwrap();
        Ok(())
    }
}

bindings::export!(GuildsPlugin with_types_in bindings);
