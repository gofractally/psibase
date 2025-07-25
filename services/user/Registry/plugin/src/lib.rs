#[allow(warnings)]
mod bindings;
use bindings::*;

mod errors;
mod queries;
mod types;

use ::registry::action_structs::*;
use bindings::registry::plugin::types::{AccountId, AppMetadata, ExtraMetadata, FullAppMetadata};
use exports::registry::plugin::{consumer::Guest as Consumer, developer::Guest as Developer};
use host::common::types::Error;
use psibase::{fracpack::Pack, AccountNumber};
use transact::plugin::intf as Transact;

use chrono::DateTime;

struct RegistryPlugin;

impl Developer for RegistryPlugin {
    fn create_app(account: AccountId) -> Result<(), Error> {
        let account = account.parse().unwrap();
        Transact::add_action_to_transaction(
            createApp::ACTION_NAME,
            &createApp { account }.packed(),
        )
        .unwrap();
        Ok(())
    }

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

impl Consumer for RegistryPlugin {
    fn get_app_metadata(account: AccountId) -> Result<FullAppMetadata, Error> {
        let app_metadata_response = queries::query_app_metadata(account)?;

        let tags: Vec<String> = app_metadata_response
            .tags
            .iter()
            .map(|tag| tag.tag.to_owned())
            .collect();

        let metadata = app_metadata_response.metadata;

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
                tags,
            },
            extra_metadata: ExtraMetadata { created_at, status },
        };
        Ok(res)
    }

    fn get_related_tags(tag: String) -> Result<Vec<String>, Error> {
        let response = queries::query_all_related_tags(tag)?;
        Ok(response.tags)
    }
}

bindings::export!(RegistryPlugin with_types_in bindings);
