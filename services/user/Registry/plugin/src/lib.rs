#[allow(warnings)]
mod bindings;

mod errors;
mod queries;
mod types;

use chrono::DateTime;

use psibase::fracpack::Pack;
use registry as RegistryService;

use bindings::exports::registry::plugin::consumer::Guest as Consumer;
use bindings::exports::registry::plugin::developer::Guest as Developer;
use bindings::host::common::types as CommonTypes;
use bindings::registry::plugin::types::{AccountId, AppMetadata, ExtraMetadata, FullAppMetadata};
use bindings::transact::plugin::intf as Transact;

struct RegistryPlugin;

impl Developer for RegistryPlugin {
    fn set_app_metadata(metadata: AppMetadata) -> Result<(), CommonTypes::Error> {
        let action_metadata_input = RegistryService::action_structs::setMetadata::from(metadata);
        Transact::add_action_to_transaction("setMetadata", &action_metadata_input.packed())?;
        Ok(())
    }

    fn publish_app(account: AccountId) -> Result<(), CommonTypes::Error> {
        let action_publish_input = RegistryService::action_structs::publish {
            account_id: account.parse().unwrap(),
        };
        Transact::add_action_to_transaction("publish", &action_publish_input.packed())?;
        Ok(())
    }

    fn unpublish_app(account: AccountId) -> Result<(), CommonTypes::Error> {
        let action_unpublish_input = RegistryService::action_structs::unpublish {
            account_id: account.parse().unwrap(),
        };
        Transact::add_action_to_transaction("unpublish", &action_unpublish_input.packed())?;
        Ok(())
    }
}

impl Consumer for RegistryPlugin {
    fn get_app_metadata(account: AccountId) -> Result<FullAppMetadata, CommonTypes::Error> {
        let app_metadata_response = queries::query_app_metadata(account)?;

        let tags: Vec<String> = app_metadata_response
            .tags
            .iter()
            .map(|tag| tag.tag.to_owned())
            .collect();

        let metadata = app_metadata_response.metadata;

        let owners = metadata
            .owners
            .iter()
            .map(|owner| owner.to_string())
            .collect();

        let created_at = DateTime::from(metadata.created_at).to_string();

        let status = metadata.status.into();

        let res = FullAppMetadata {
            app_metadata: AppMetadata {
                name: metadata.name,
                short_description: metadata.short_description,
                long_description: metadata.long_description,
                icon: metadata.icon,
                icon_mime_type: metadata.icon_mime_type,
                tos_subpage: metadata.tos_subpage,
                privacy_policy_subpage: metadata.privacy_policy_subpage,
                app_homepage_subpage: metadata.app_homepage_subpage,
                redirect_uris: metadata.redirect_uris,
                owners,
                tags,
            },
            extra_metadata: ExtraMetadata { created_at, status },
        };
        Ok(res)
    }

    fn get_related_tags(tag: String) -> Result<Vec<String>, CommonTypes::Error> {
        let response = queries::query_all_related_tags(tag)?;
        Ok(response.tags)
    }
}

bindings::export!(RegistryPlugin with_types_in bindings);
