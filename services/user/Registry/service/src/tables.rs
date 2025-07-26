#[psibase::service_tables]
pub mod tables {
    use async_graphql::{ComplexObject, SimpleObject};
    use psibase::{check, AccountNumber, Fracpack, Table, ToSchema};
    use serde::{Deserialize, Serialize};
    use url::Url;

    use crate::constants::*;

    /// Holds tags
    #[table(name = "TagsTable", index = 0)]
    #[derive(Debug, Clone, Fracpack, ToSchema, Serialize, Deserialize, SimpleObject, PartialEq)]
    pub struct TagRecord {
        /// The unique identifier for the tag
        #[primary_key]
        pub id: u32,

        /// The name of the tag
        pub tag: String,
    }

    impl TagRecord {
        #[secondary_key(1)]
        fn by_tags(&self) -> String {
            self.tag.clone()
        }

        /// Validate the tag is lowercase alphanumeric and dashes, under the max length
        pub fn check_valid(&self) {
            check(self.tag.len() > 0, "Tag cannot be empty");

            check(
                self.tag
                    .chars()
                    .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-'),
                "Tags must be lowercase and can only contain dashes",
            );

            check(
                !self.tag.starts_with('-') && !self.tag.ends_with('-'),
                "Tag cannot start or end with a dash",
            );

            check(
                self.tag.len() <= MAX_TAG_LENGTH,
                format!("Tag can only be up to {} characters long", MAX_TAG_LENGTH).as_str(),
            );
        }
    }
    #[table(name = "AppMetadataTable", index = 1)]
    #[derive(Default, Debug, Clone, Fracpack, ToSchema, Serialize, SimpleObject, Deserialize)]
    #[serde(rename_all = "camelCase")]
    #[graphql(complex)]
    pub struct AppMetadata {
        /// The unique identifier for the app: it's own account id
        #[primary_key]
        pub account_id: AccountNumber,

        /// The name of the app
        pub name: String,

        /// A short description of the app
        pub short_description: String,

        /// A detailed description of the app
        pub long_description: String,

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

        /// The status of the app (DRAFT, PUBLISHED, or UNPUBLISHED)
        #[graphql(skip)]
        pub status: u32,

        /// The timestamp of when the app was created
        pub created_at: psibase::BlockTime,

        /// The redirect URIs for the app
        pub redirect_uris: Vec<String>,
    }

    #[ComplexObject]
    impl AppMetadata {
        async fn tags(&self) -> Vec<String> {
            let app_tags_table = AppTagsTable::new();
            let tags_table = TagsTable::new();

            app_tags_table
                .get_index_pk()
                .range((self.account_id, 0)..(self.account_id, u32::MAX))
                .map(|app_tag| {
                    let tag_id = app_tag.tag_id;
                    tags_table.get_index_pk().get(&tag_id).unwrap().tag
                })
                .collect()
        }

        async fn status(&self) -> String {
            match self.status {
                app_status::DRAFT => "Draft".to_string(),
                app_status::PUBLISHED => "Published".to_string(),
                app_status::UNPUBLISHED => "Unpublished".to_string(),
                _ => "Unknown".to_string(),
            }
        }
    }

    impl AppMetadata {
        pub fn check_valid(&self) {
            check(
                self.name.len() <= MAX_APP_NAME_LENGTH,
                format!(
                    "App name can only be up to {} characters long",
                    MAX_APP_NAME_LENGTH
                )
                .as_str(),
            );
            check(
                self.short_description.len() <= MAX_APP_SHORT_DESCRIPTION_LENGTH,
                format!(
                    "App short description can only be up to {} characters long",
                    MAX_APP_SHORT_DESCRIPTION_LENGTH
                )
                .as_str(),
            );
            check(
                self.long_description.len() <= MAX_APP_LONG_DESCRIPTION_LENGTH,
                format!(
                    "App long description can only be up to {} characters long",
                    MAX_APP_LONG_DESCRIPTION_LENGTH
                )
                .as_str(),
            );

            // Check subpages start with "/"
            check(
                self.tos_subpage.starts_with("/"),
                "TOS subpage must start with /",
            );
            check(
                self.privacy_policy_subpage.starts_with("/"),
                "Privacy policy subpage must start with /",
            );
            check(
                self.app_homepage_subpage.starts_with("/"),
                "App homepage subpage must start with /",
            );

            // Validate icon
            if self.icon.len() > 0 {
                check(
                    self.icon_mime_type.len() > 0,
                    "Icon MIME type is required if icon is present",
                );

                // validate the mime type is a valid image mime type for icons
                check(
                    self.icon_mime_type == "image/png"
                        || self.icon_mime_type == "image/jpeg"
                        || self.icon_mime_type == "image/svg+xml"
                        || self.icon_mime_type == "image/x-icon"
                        || self.icon_mime_type == "image/vnd.microsoft.icon",
                    "Icon MIME type must be png, jpeg, svg, x-icon, or vnd.microsoft.icon",
                );
            }

            for uri in &self.redirect_uris {
                check(
                    Url::parse(uri).is_ok(),
                    format!("Invalid redirect URI format: {}", uri).as_str(),
                );
            }

            if self.status == app_status::PUBLISHED as u32 {
                let publishing_required_fields = [
                    ("account_id", &self.account_id.to_string()),
                    ("name", &self.name),
                    ("short_description", &self.short_description),
                    ("long_description", &self.long_description),
                    ("tos_subpage", &self.tos_subpage),
                    ("privacy_policy_subpage", &self.privacy_policy_subpage),
                    ("app_homepage_subpage", &self.app_homepage_subpage),
                ];
                for (field_name, field_value) in publishing_required_fields {
                    check(
                        field_value.len() > 0,
                        format!("{} is required for published apps", field_name).as_str(),
                    );
                }

                // TODO: check each of those subpages exist
                // in the caller's namespace in sites.
            }
        }
    }

    #[table(name = "AppTagsTable", index = 2)]
    #[derive(Debug, Clone, Fracpack, ToSchema, Serialize, Deserialize, SimpleObject)]
    pub struct AppTag {
        /// The unique identifier for the app
        pub app_id: AccountNumber,

        /// The unique identifier for the tag
        pub tag_id: u32,
    }

    impl AppTag {
        #[primary_key]
        fn by_app_tag_ids(&self) -> (AccountNumber, u32) {
            (self.app_id, self.tag_id)
        }

        #[secondary_key(1)]
        fn by_tag_id_apps(&self) -> (u32, AccountNumber) {
            (self.tag_id, self.app_id)
        }
    }
}
