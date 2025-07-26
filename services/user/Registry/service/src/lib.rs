mod constants;
mod tables;
mod tags;

#[psibase::service(name = "registry", tables = "tables::tables")]
#[allow(non_snake_case)]
pub mod service {
    use crate::constants::*;
    pub use crate::tables::tables::*;
    use crate::tags::*;
    use async_graphql::*;
    use psibase::services::transact;
    use psibase::*;
    use services::events::Wrapper as EventsSvc;
    use std::collections::HashSet;

    #[action]
    fn init() {
        EventsSvc::call().addIndex(DbId::HistoryEvent, SERVICE, method!("appStatusChanged"), 0);
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
    ) {
        let app_metadata_table = AppMetadataTable::new();
        let account_id = get_sender();
        let mut metadata = app_metadata_table
            .get_index_pk()
            .get(&account_id)
            .unwrap_or_default();

        let is_new_app = metadata.account_id.value == 0;

        let status: u32 = if is_new_app {
            app_status::DRAFT
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
        check(account_id == get_sender(), "Unauthorized");
        check(
            metadata.status != app_status::PUBLISHED,
            "App is already published",
        );
        metadata.status = app_status::PUBLISHED;
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
        check(account_id == sender, "Unauthorized");
        check(
            metadata.status == app_status::PUBLISHED,
            "App is not published",
        );
        metadata.status = app_status::UNPUBLISHED;
        app_metadata_table.put(&metadata).unwrap();

        Wrapper::emit()
            .history()
            .appStatusChanged(account_id, metadata.status);
    }

    #[event(history)]
    fn appStatusChanged(app_account_id: AccountNumber, status: u32) {}
}

#[cfg(test)]
mod tests;
