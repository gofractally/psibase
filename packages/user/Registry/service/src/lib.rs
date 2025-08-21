mod constants;
mod tables;

#[psibase::service(name = "registry", tables = "tables::tables")]
#[allow(non_snake_case)]
pub mod service {
    pub use crate::tables::tables::*;
    use async_graphql::*;
    use psibase::*;
    use services::events::Wrapper as EventsSvc;

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
    ) {
        let app_metadata = AppMetadata::upsert(
            name,
            short_description,
            long_description,
            icon,
            icon_mime_type,
            tos_subpage,
            privacy_policy_subpage,
            app_homepage_subpage,
        );

        let mut tags = tags;
        app_metadata.set_tags(&mut tags);
    }

    #[action]
    fn publish(account_id: AccountNumber) {
        check(account_id == get_sender(), "Unauthorized");
        AppMetadata::get_assert(account_id).publish();
    }

    #[action]
    fn unpublish(account_id: AccountNumber) {
        check(account_id == get_sender(), "Unauthorized");
        AppMetadata::get_assert(account_id).unpublish();
    }

    #[event(history)]
    fn appStatusChanged(app_account_id: AccountNumber, status: u32) {}
}

#[cfg(test)]
mod tests;
