#[allow(warnings)]
mod bindings;

use bindings::exports::web_registry::plugin::api::Guest as Api;
use web_registry::service;
// use bindings::host::common::server as CommonServer;
// use bindings::host::common::types::Error;
// use bindings::transact::plugin::intf::add_action_to_transaction;
// use psibase::fracpack::Pack;

mod errors;
//use errors::ErrorType;

struct WebRegistryPlugin;

impl Api for WebRegistryPlugin {
    fn set_example_thing(_thing: String) {
        // NOP
    }
}

bindings::export!(WebRegistryPlugin with_types_in bindings);
