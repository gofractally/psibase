mod constants;
mod tables;

#[psibase::service(name = "registry", tables = "tables::tables")]
#[allow(non_snake_case)]
pub mod service {
    pub use crate::tables::tables::*;
    use async_graphql::*;
    use psibase::services::auth_delegate::Wrapper as AuthDelegate;
    use psibase::services::nft::Wrapper as Nft;
    use psibase::*;
    use services::events::Wrapper as Events;

    #[action]
    fn init() {
        Events::call().addIndex(DbId::HistoryEvent, SERVICE, method!("appStatusChanged"), 0);

        // Reserve some accounts for known future platforms
        AuthDelegate::call().newAccount(account!("cli"), SERVICE);
    }

    /// This creates a new platform. The sender is the owner of the platform.
    /// The name does not need to be an account (AccountNumber is used for a
    /// fixed-size string).
    #[action]
    fn new_platform(name: AccountNumber) {
        let owner = get_sender();
        let owner_id = Nft::call().mint();
        Nft::call().debit(owner_id, "".to_string());
        Nft::call().credit(
            owner_id,
            owner,
            "new registry platform owner NFT".to_string(),
        );
        Platform::upsert(name, owner_id, owner);
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
        let app_metadata = AppMetadata::upsert(
            name,
            short_description,
            long_description,
            icon,
            icon_mime_type,
            tos_subpage,
            privacy_policy_subpage,
            app_homepage_subpage,
            redirect_uris,
        );

        let mut tags = tags;
        app_metadata.set_tags(&mut tags);
    }

    #[action]
    fn publish(account_id: AccountNumber) {
        check(account_id == get_sender(), "Unauthorized");
        AppMetadata::get(account_id).publish();
    }

    #[action]
    fn unpublish(account_id: AccountNumber) {
        check(account_id == get_sender(), "Unauthorized");
        AppMetadata::get(account_id).unpublish();
    }

    #[event(history)]
    fn appStatusChanged(app_account_id: AccountNumber, status: u32) {}
}

#[cfg(test)]
mod tests;
