mod constants;
mod tables;
mod utils;

#[psibase::service(name = "registry")]
#[allow(non_snake_case)]
pub mod service {
    use crate::constants::*;
    pub use crate::tables::tables::*;
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

        EventsSvc::call().setSchema(create_schema::<Wrapper>());
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

        updateAppTags(account_id, &tags);

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

    fn process_tag(
        tag: &str,
        account_id: AccountNumber,
        existing_app_tags: &Vec<AppTag>,
    ) -> AppTag {
        if let Some(existing_tag) = find_existing_app_tag(tag, existing_app_tags) {
            existing_tag.clone()
        } else {
            create_new_app_tag(tag, account_id)
        }
    }

    fn create_new_app_tag(tag: &str, account_id: AccountNumber) -> AppTag {
        let app_tags_table = AppTagsTable::new();
        let tag_id = get_or_create_tag_id(tag);
        let new_app_tag = AppTag {
            app_id: account_id,
            tag_id,
        };
        app_tags_table.put(&new_app_tag).unwrap();
        new_app_tag
    }

    fn find_existing_app_tag(tag: &str, existing_app_tags: &Vec<AppTag>) -> Option<AppTag> {
        let tags_table = TagsTable::new();
        existing_app_tags
            .iter()
            .find(|at| {
                tags_table
                    .get_index_pk()
                    .get(&at.tag_id)
                    .map(|tr| tr.tag == tag)
                    .unwrap_or(false)
            })
            .cloned()
    }

    fn updateAppTags(account_id: AccountNumber, tags: &Vec<String>) {
        let app_tags_table = AppTagsTable::new();

        // Get existing app tags
        let existing_app_tags: Vec<AppTag> = app_tags_table
            .get_index_pk()
            .range((account_id, 0)..(account_id, u32::MAX))
            .collect();

        let mut new_app_tags = Vec::new();

        for tag in tags {
            let app_tag = process_tag(tag, account_id, &existing_app_tags);
            new_app_tags.push(app_tag);
        }

        remove_obsolete_tags(&existing_app_tags, &new_app_tags);
    }

    fn get_or_create_tag_id(tag: &str) -> u32 {
        let tags_table = TagsTable::new();
        let idx = tags_table.get_index_by_tags();
        let tag_str = tag.to_string();
        idx.get(&tag_str)
            .map(|tag_row| tag_row.id)
            .unwrap_or_else(|| create_new_tag(tag_str))
    }

    fn create_new_tag(tag: String) -> u32 {
        let tags_table = TagsTable::new();
        let new_id = tags_table
            .get_index_pk()
            .into_iter()
            .last()
            .map(|last_tag| last_tag.id + 1)
            .unwrap_or(1);
        let new_tag = TagRecord {
            id: new_id,
            tag: tag.to_string(),
        };
        new_tag.check_valid();
        tags_table.put(&new_tag).unwrap();
        new_id
    }

    fn remove_obsolete_tags(existing_app_tags: &[AppTag], new_app_tags: &[AppTag]) {
        let app_tags_table = AppTagsTable::new();
        for existing_tag in existing_app_tags {
            if !new_app_tags
                .iter()
                .any(|at| at.tag_id == existing_tag.tag_id)
            {
                app_tags_table.remove(existing_tag);

                // If there are no apps using the tag, remove the tag
                let tag_apps_count = app_tags_table
                    .get_index_by_tag_id_apps()
                    .range(
                        (existing_tag.tag_id, AccountNumber::new(0))
                            ..(existing_tag.tag_id + 1, AccountNumber::new(0)),
                    )
                    .count();
                if tag_apps_count == 0 {
                    let tags_table = TagsTable::new();
                    tags_table.erase(&existing_tag.tag_id);
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::consts::MAX_APP_NAME_LENGTH;
    use crate::service::{AppMetadata, AppStatus, AppStatusU32, TagRecord};
    use psibase::{account, AccountNumber, ChainEmptyResult, TimePointUSec};

    fn default_metadata() -> AppMetadata {
        AppMetadata {
            account_id: AccountNumber::new(0),
            status: AppStatus::Draft as AppStatusU32,
            created_at: TimePointUSec::from(0),
            redirect_uris: vec!["http://localhost:3000/callback".to_string()],
            owners: vec![account!("alice"), account!("bob")],
            name: "Super Cooking App".to_string(),
            short_description: "Alice's Cooking App".to_string(),
            long_description: "Super cooking app".to_string(),
            icon: "icon-as-base64".to_string(),
            icon_mime_type: "image/png".to_string(),
            tos_subpage: "/tos".to_string(),
            privacy_policy_subpage: "/privacy-policy".to_string(),
            app_homepage_subpage: "/".to_string(),
        }
    }

    fn default_tags() -> Vec<String> {
        vec![
            "cozy".to_string(),
            "cuisine".to_string(),
            "cooking".to_string(),
        ]
    }

    fn push_set_metadata(
        chain: &psibase::Chain,
        metadata: AppMetadata,
        tags: Vec<String>,
    ) -> ChainEmptyResult {
        Wrapper::push_from(chain, account!("alice")).setMetadata(
            metadata.name,
            metadata.short_description,
            metadata.long_description,
            metadata.icon,
            metadata.icon_mime_type,
            metadata.tos_subpage,
            metadata.privacy_policy_subpage,
            metadata.app_homepage_subpage,
            tags,
            metadata.redirect_uris,
            metadata.owners,
        )
    }

    #[psibase::test_case(packages("AppRegistry"))]
    fn test_set_metadata_simple(chain: psibase::Chain) -> Result<(), psibase::Error> {
        chain.new_account(account!("alice"))?;

        push_set_metadata(&chain, default_metadata(), default_tags()).get()?;

        let app_metadata_with_tags = Wrapper::push(&chain)
            .getMetadata(account!("alice"))
            .get()?
            .unwrap();

        let metadata = app_metadata_with_tags.metadata;
        let tags = app_metadata_with_tags.tags;

        assert_eq!(metadata.name, "Super Cooking App");
        assert_eq!(metadata.short_description, "Alice's Cooking App");
        assert_eq!(metadata.long_description, "Super cooking app");
        assert_eq!(metadata.icon, "icon-as-base64");
        assert_eq!(metadata.icon_mime_type, "image/png");
        assert_eq!(metadata.tos_subpage, "/tos");
        assert_eq!(metadata.privacy_policy_subpage, "/privacy-policy");
        assert_eq!(metadata.app_homepage_subpage, "/");
        assert_eq!(metadata.status, 0);
        assert_eq!(metadata.status, AppStatus::Draft as AppStatusU32);

        assert_eq!(tags.len(), 3);
        assert!(tags.contains(&TagRecord {
            id: 1,
            tag: "cozy".to_string(),
        }));
        assert!(tags.contains(&TagRecord {
            id: 2,
            tag: "cuisine".to_string(),
        }));
        assert!(tags.contains(&TagRecord {
            id: 3,
            tag: "cooking".to_string(),
        }));

        Ok(())
    }

    #[psibase::test_case(packages("AppRegistry"))]
    fn test_tags_max_limit(chain: psibase::Chain) -> Result<(), psibase::Error> {
        chain.new_account(account!("alice"))?;

        let mut tags = default_tags();
        tags.push("new-tag".to_string());

        let error = push_set_metadata(&chain, default_metadata(), tags)
            .trace
            .error
            .unwrap();
        assert!(
            error.contains("App can only have up to 3 tags"),
            "error = {}",
            error
        );

        Ok(())
    }

    #[psibase::test_case(packages("AppRegistry"))]
    fn test_app_name_max_length(chain: psibase::Chain) -> Result<(), psibase::Error> {
        chain.new_account(account!("alice"))?;

        let mut metadata = default_metadata();
        metadata.name = "a".repeat(MAX_APP_NAME_LENGTH + 1);

        let error = push_set_metadata(&chain, metadata, default_tags())
            .trace
            .error
            .unwrap();
        assert!(
            error.contains(
                format!(
                    "App name can only be up to {} characters long",
                    MAX_APP_NAME_LENGTH
                )
                .as_str()
            ),
            "error = {}",
            error
        );

        Ok(())
    }
}
