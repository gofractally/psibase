#[allow(warnings)]
mod bindings;

use bindings::exports::workshop::plugin::consumer::Guest as Consumer;
use bindings::exports::workshop::plugin::developer::Guest as Developer;
use bindings::host::common::{client as Client, server as Server, types as CommonTypes};
use bindings::workshop::plugin::types::{AccountId};
use psibase::fracpack::Pack;
use psibase::AccountNumber;
use workshop as WorkshopService;

struct WorkshopPlugin;

impl Developer for WorkshopPlugin {
    fn set_app_metadata(
        name: String,
        short_description: String,
        long_description: String,
        icon: String,
        tos_subpage: String,
        privacy_policy_subpage: String,
        app_homepage_subpage: String,
        status: String,
        tags: Vec<String>,
    ) -> Result<(), CommonTypes::Error> {
        // convert js blob bytes to base64
        Server::add_action_to_transaction(
            "setAppMetadata",
            &WorkshopService::action_structs::setAppMetadata {
                name: name.to_owned(),
                short_description: short_description.to_owned(),
                long_description: long_description.to_owned(),
                icon: None,
                tos_subpage: tos_subpage.to_owned(),
                privacy_policy_subpage: privacy_policy_subpage.to_owned(),
                app_homepage_subpage: app_homepage_subpage.to_owned(),
                status: status.to_owned(),
                tags: tags.to_owned(),
            }
            .packed(),
        )?;
        Ok(())
    }
}

impl Consumer for WorkshopPlugin {
    fn get_app_metadata(account: AccountId) -> Result<(), CommonTypes::Error> {
        // convert timestamps from unix to iso strings
        Ok(())
    }
}

bindings::export!(WorkshopPlugin with_types_in bindings);
