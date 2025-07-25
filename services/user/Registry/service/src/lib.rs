mod constants;
mod tables;
mod tags;
mod utils;

#[psibase::service(name = "registry", tables = "tables::tables")]
#[allow(non_snake_case)]
pub mod service {
    use crate::constants::*;
    pub use crate::tables::tables::*;
    use crate::tags::*;
    use async_graphql::*;
    use psibase::services::transact;
    use psibase::*;
    use serde::{Deserialize, Serialize};
    use services::events::Wrapper as EventsSvc;
    use std::collections::HashSet;

    use crate::utils::increment_last_char;

    pub type AppStatusU32 = u32;

    pub enum AppStatus {
        Draft = 0,
        Published = 1,
        Unpublished = 2,
    }

    impl From<AppStatusU32> for AppStatus {
        fn from(status: AppStatusU32) -> Self {
            match status {
                0 => AppStatus::Draft,
                1 => AppStatus::Published,
                2 => AppStatus::Unpublished,
                _ => abort_message("Invalid app status"),
            }
        }
    }

    /// Holds metadata for a registered app
    #[derive(SimpleObject, Pack, Unpack, Deserialize, Serialize, ToSchema)]
    pub struct AppMetadataWithTags {
        pub metadata: crate::tables::tables::AppMetadata,
        pub tags: Vec<TagRecord>,
    }

    #[derive(SimpleObject, Pack, Unpack, Deserialize, Serialize, ToSchema)]
    pub struct RelatedTags {
        pub tags: Vec<String>,
    }

    #[action]
    fn init() {
        let table = InitTable::new();
        table.put(&InitRow {}).unwrap();

        EventsSvc::call().addIndex(
            DbId::HistoryEvent,
            SERVICE,
            MethodNumber::from("appStatusChanged"),
            0,
        );
    }

    #[action]
    fn createApp(account: AccountNumber) {
        psibase::services::auth_delegate::Wrapper::call().newAccount(account, get_sender());
    }

    #[action]
    fn setMetadata(
        name: String,
        short_description: String,
        long_description: String,
        icon: String,
        icon_mime_type: String,
        tos_subpage: String,
        privacy_policy_subpage: String,
        app_homepage_subpage: String,
        tags: Vec<String>,
        redirect_uris: Vec<String>,
        owners: Vec<AccountNumber>,
    ) {
        let app_metadata_table = AppMetadataTable::new();
        let account_id = get_sender();
        let mut metadata = app_metadata_table
            .get_index_pk()
            .get(&account_id)
            .unwrap_or_default();

        let is_new_app = metadata.account_id.value == 0;

        let status: AppStatusU32 = if is_new_app {
            AppStatus::Draft as AppStatusU32
        } else {
            metadata.status
        };

        metadata.account_id = account_id;
        metadata.name = name;
        metadata.short_description = short_description;
        metadata.long_description = long_description;
        metadata.icon = icon;
        metadata.icon_mime_type = icon_mime_type;
        metadata.tos_subpage = tos_subpage;
        metadata.privacy_policy_subpage = privacy_policy_subpage;
        metadata.app_homepage_subpage = app_homepage_subpage;
        metadata.status = status;
        metadata.redirect_uris = redirect_uris;
        metadata.owners = owners;

        // If the app is new, set the created_at to the current time
        if is_new_app {
            let created_at = transact::Wrapper::call().currentBlock().time;
            metadata.created_at = created_at;
        }

        metadata.check_valid();

        check(
            tags.len() <= MAX_APP_TAGS,
            format!("App can only have up to {} tags", MAX_APP_TAGS).as_str(),
        );

        // check there are no duplicate tags in the input
        let unique_tags = (&tags).into_iter().collect::<HashSet<_>>();
        check(unique_tags.len() == tags.len(), "Tags must be unique");

        app_metadata_table.put(&metadata).unwrap();

        update_app_tags(account_id, &tags);

        if is_new_app {
            Wrapper::emit()
                .history()
                .appStatusChanged(account_id, status);
        }
    }

    #[action]
    fn publish(account_id: AccountNumber) {
        let app_metadata_table = AppMetadataTable::new();
        let mut metadata = app_metadata_table.get_index_pk().get(&account_id).unwrap();
        let sender = get_sender();
        check(
            account_id == sender || metadata.owners.contains(&sender),
            "Only app owners can unpublish the app",
        );
        check(
            metadata.status != AppStatus::Published as AppStatusU32,
            "App is already published",
        );
        metadata.status = AppStatus::Published as AppStatusU32;
        metadata.check_valid();
        app_metadata_table.put(&metadata).unwrap();

        Wrapper::emit()
            .history()
            .appStatusChanged(account_id, metadata.status);
    }

    #[action]
    fn unpublish(account_id: AccountNumber) {
        let app_metadata_table = AppMetadataTable::new();
        let mut metadata = app_metadata_table.get_index_pk().get(&account_id).unwrap();
        let sender = get_sender();
        check(
            account_id == sender || metadata.owners.contains(&sender),
            "Only app owners can unpublish the app",
        );
        check(
            metadata.status == AppStatus::Published as AppStatusU32,
            "App is not published",
        );
        metadata.status = AppStatus::Unpublished as AppStatusU32;
        app_metadata_table.put(&metadata).unwrap();

        Wrapper::emit()
            .history()
            .appStatusChanged(account_id, metadata.status);
    }

    #[action]
    fn getMetadata(account_id: AccountNumber) -> Option<AppMetadataWithTags> {
        let app_metadata_table = AppMetadataTable::new();
        let app_tags_table = AppTagsTable::new();
        let tags_table = TagsTable::new();
        let metadata = app_metadata_table.get_index_pk().get(&account_id)?;

        // Get the app tag IDs
        let tags: Vec<TagRecord> = app_tags_table
            .get_index_pk()
            .range((account_id, 0)..(account_id, u32::MAX))
            .map(|app_tag| {
                let tag_id = app_tag.tag_id;
                tags_table.get_index_pk().get(&tag_id).unwrap()
            })
            .collect();

        Some(AppMetadataWithTags {
            metadata: metadata,
            tags,
        })
    }

    #[action]
    fn getTag(tag_id: u32) -> Option<TagRecord> {
        let tags_table = TagsTable::new();
        tags_table.get_index_pk().get(&tag_id)
    }

    #[action]
    fn getRelatedTags(partial_tag: String) -> RelatedTags {
        let table = TagsTable::new();
        let idx = table.get_index_by_tags();

        let from = partial_tag.to_lowercase();
        let excluded_to = increment_last_char(from.clone());

        let tags: Vec<String> = idx
            .range(from..excluded_to)
            .take(10)
            .map(|tag_row| tag_row.tag)
            .collect();

        RelatedTags { tags }
    }

    #[event(history)]
    fn appStatusChanged(app_account_id: AccountNumber, status: AppStatusU32) {}
}

#[cfg(test)]
mod tests;
