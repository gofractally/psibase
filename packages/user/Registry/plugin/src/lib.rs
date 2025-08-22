#[allow(warnings)]
mod bindings;
use bindings::*;

mod types;

use ::registry::action_structs::*;
use bindings::registry::plugin::types::AppMetadata;
use exports::registry::plugin::developer::Guest as Developer;
use psibase::fracpack::Pack;
use transact::plugin::intf as Transact;

struct RegistryPlugin;

impl Developer for RegistryPlugin {
    fn set_metadata(metadata: AppMetadata) {
        Transact::add_action_to_transaction(
            setMetadata::ACTION_NAME,
            &setMetadata::from(metadata).packed(),
        )
        .unwrap();
    }

    fn publish() {
        Transact::add_action_to_transaction(publish::ACTION_NAME, &publish {}.packed()).unwrap();
    }

    fn unpublish() {
        Transact::add_action_to_transaction(unpublish::ACTION_NAME, &unpublish {}.packed())
            .unwrap();
    }
}

bindings::export!(RegistryPlugin with_types_in bindings);
