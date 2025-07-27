#[psibase::service_tables]
pub mod tables {
    use async_graphql::SimpleObject;
    use psibase::*;
    use serde::{Deserialize, Serialize};

    /// This table contains all web-app related metadata
    #[table(name = "AppMetadataTable", index = 0)]
    #[derive(Default, Debug, Clone, Fracpack, ToSchema, Serialize, SimpleObject, Deserialize)]
    #[serde(rename_all = "camelCase")]
    pub struct AppMetadata {
        /// The unique identifier for the app: its own account id
        #[primary_key]
        pub account_id: AccountNumber,

        /// The icon of the app (stored as a base64 string)
        pub icon: String,

        /// The MIME type of the icon
        pub icon_mime_type: String,

        /// The subpage for Terms of Service
        pub tos_subpage: String,

        /// The subpage for Privacy Policy
        pub privacy_policy_subpage: String,

        /// The subpage for the app's homepage
        pub app_homepage_subpage: String,

        /// The redirect URIs for the app
        pub redirect_uris: Vec<String>,
    }
}

pub mod impls {
    use crate::tables::tables::*;
    use psibase::*;

    impl AppMetadata {
        pub fn get(account_id: AccountNumber) -> Self {
            let table = AppMetadataTable::new();
            table.get_index_pk().get(&account_id).unwrap_or_default()
        }
    }
}
