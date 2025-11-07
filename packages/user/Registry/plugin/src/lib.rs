#[allow(warnings)]
mod bindings;
use bindings::*;

mod types;

use crate::trust::*;
use bindings::registry::plugin::types::AppMetadata;
use ::registry::action_structs::*;
use exports::registry::plugin::developer::Guest as Developer;
use psibase::fracpack::Pack;
use transact::plugin::intf as Transact;

psibase::define_trust! {
    descriptions {
        Low => "",
        Medium => "
        Medium trust grants these abilities:
            - Set app metadata in registry
        ",
        High => "
        High trust grants the abilities of all lower trust levels, plus these abilities:
            - Publish apps to registry
            - Unpublish apps from registry
        ",
    }
    functions {
        None => [],
        Low => [],
        Medium => [set_metadata],
        High => [publish, unpublish],
    }
}

struct RegistryPlugin;

impl Developer for RegistryPlugin {
    fn set_metadata(metadata: AppMetadata) {
        assert_authorized(FunctionName::set_metadata).unwrap();

        Transact::add_action_to_transaction(
            setMetadata::ACTION_NAME,
            &setMetadata::from(metadata).packed(),
        )
        .unwrap();
    }

    fn publish() {
        assert_authorized(FunctionName::publish).unwrap();

        Transact::add_action_to_transaction(publish::ACTION_NAME, &publish {}.packed()).unwrap();
    }

    fn unpublish() {
        assert_authorized(FunctionName::unpublish).unwrap();

        Transact::add_action_to_transaction(unpublish::ACTION_NAME, &unpublish {}.packed())
            .unwrap();
    }
}

bindings::export!(RegistryPlugin with_types_in bindings);
