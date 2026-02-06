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
            - Set app metadata in registry
        ",
        High => "
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
        assert_authorized_with_whitelist(FunctionName::set_metadata, vec!["workshop".to_string()])
            .unwrap();

        Transact::add_action_to_transaction(
            setMetadata::ACTION_NAME,
            &setMetadata::from(metadata).packed(),
        )
        .unwrap();
    }

    fn publish() {
        assert_authorized_with_whitelist(FunctionName::publish, vec!["workshop".to_string()])
            .unwrap();

        Transact::add_action_to_transaction(publish::ACTION_NAME, &publish {}.packed()).unwrap();
    }

    fn unpublish() {
        assert_authorized_with_whitelist(FunctionName::unpublish, vec!["workshop".to_string()])
            .unwrap();

        Transact::add_action_to_transaction(unpublish::ACTION_NAME, &unpublish {}.packed())
            .unwrap();
    }
}

bindings::export!(RegistryPlugin with_types_in bindings);
