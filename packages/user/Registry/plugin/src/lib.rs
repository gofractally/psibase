#[allow(warnings)]
mod bindings;
use bindings::*;

mod types;

use ::registry::action_structs::*;
use bindings::registry::plugin::types::{AccountId, AppMetadata};
use exports::registry::plugin::developer::Guest as Developer;
use host::types::types::Error;
use psibase::{fracpack::Pack, AccountNumber, ActionMeta};

use transact::plugin::intf as Transact;

struct RegistryPlugin;

impl Developer for RegistryPlugin {
    fn set_app_metadata(metadata: AppMetadata) -> Result<(), Error> {
        Transact::add_action_to_transaction(
            setMetadata::ACTION_NAME,
            &setMetadata::from(metadata).packed(),
        )
        .unwrap();
        Ok(())
    }

    fn publish_app(account: AccountId) -> Result<(), Error> {
        let account_id: AccountNumber = account.parse().unwrap();
        Transact::add_action_to_transaction(publish::ACTION_NAME, &publish { account_id }.packed())
            .unwrap();
        Ok(())
    }

    fn unpublish_app(account: AccountId) -> Result<(), Error> {
        let account_id: AccountNumber = account.parse().unwrap();
        Transact::add_action_to_transaction(
            unpublish::ACTION_NAME,
            &unpublish { account_id }.packed(),
        )
        .unwrap();
        Ok(())
    }
}

bindings::export!(RegistryPlugin with_types_in bindings);
