#[psibase::service_tables]
pub mod tables {
    use async_graphql::SimpleObject;
    use psibase::{AccountNumber, Fracpack, ToSchema};
    use serde::{Deserialize, Serialize};

    #[table(name = "AppMetadataTable", index = 0)]
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
        pub short_desc: String,

        /// A detailed description of the app
        pub long_desc: String,

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
    }

    #[table(name = "NextIdTable", index = 1)]
    #[derive(Default, Fracpack, Serialize, Deserialize, ToSchema, SimpleObject)]
    pub struct NextId {
        pub id: u32,
    }
    impl NextId {
        #[primary_key]
        fn pk(&self) {}
    }

    // TagsTable and AppTagsTable
    //
    // ┌─────────────────────────────────┐       ┌──────────────────────────────┐
    // │           TagsTable             │       │        AppTagsTable          │
    // ├─────────────────────────────────┤       ├──────────────────────────────┤
    // │ id: u32           [PK]          │◄──────┤ tag_id: u32                  │
    // │ tag: String       [SK1]         │       │ app_id: AccountNumber        │
    // └─────────────────────────────────┘       │                              │
    //                                           │ PK: (app_id, tag_id)         │
    //                                           │ SK1: (tag_id, app_id)        │
    //                                           └──────────────────────────────┘
    // Indexes:
    // • AppTagsTable PK: Allows lookup of all tags for an app
    // • AppTagsTable SK1: Allows lookup of all apps with a tag
    //
    // Example records:
    //
    // TagsTable
    // ┌─────┬────────────────┐
    // │ id  │ tag            │
    // ├─────┼────────────────┤
    // │ 1   │ "game"         │
    // │ 2   │ "social"       │
    // │ 3   │ "productivity" │
    // │ 4   │ "education"    │
    // └─────┴────────────────┘
    //
    // AppTagsTable
    // ┌─────────────┬─────────┐
    // │ app_id      │ tag_id  │
    // ├─────────────┼─────────┤
    // │ "app1"      │ 1       │
    // │ "app2"      │ 1       │
    // │ "app2"      │ 3       │
    // └─────────────┴─────────┘

    /// This table holds all unique tags
    /// One TagRecord per unique tag
    #[table(name = "TagsTable", index = 2)]
    #[derive(Debug, Clone, Fracpack, ToSchema, Serialize, Deserialize, SimpleObject, PartialEq)]
    pub struct TagRecord {
        /// The unique identifier for the tag
        #[primary_key]
        pub id: u32,

        /// The name of the tag
        pub tag: String,

        /// Reference count
        pub count: u32,
    }

    impl TagRecord {
        #[secondary_key(1)]
        fn by_tags(&self) -> String {
            self.tag.clone()
        }

        #[secondary_key(2)]
        fn by_count(&self) -> (u32, u32) {
            (self.count, self.id)
        }
    }

    /// This table maps apps to their tags
    /// One AppTag record per app-tag pair
    #[table(name = "AppTagsTable", index = 3)]
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

pub mod impls {
    use super::tables::*;
    use crate::constants::*;
    use crate::Wrapper;
    use async_graphql::*;
    use psibase::services::transact;
    use psibase::*;

    impl NextId {
        pub fn get() -> u32 {
            let table = NextIdTable::new();
            let record = table.get_index_pk().get(&()).unwrap_or_default();
            let id = record.id;
            table.put(&NextId { id: id + 1 }).unwrap();
            id
        }
    }

    impl TagRecord {
        pub fn new(tag: String) -> Self {
            let tag_record = TagRecord {
                id: NextId::get(),
                tag,
                count: 0,
            };
            tag_record.check_valid();
            tag_record
        }

        fn check_valid(&self) {
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

    impl AppTag {
        pub fn new(app_id: AccountNumber, tag_id: u32) -> Self {
            AppTag { app_id, tag_id }
        }
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

    fn validate_length(property_name: &str, property: &str, max_length: usize) {
        check(
            property.len() <= max_length,
            format!(
                "{} can only be up to {} characters long",
                property_name, max_length
            )
            .as_str(),
        );
    }

    fn validate_subpath(subpath_name: &str, subpath: &str) {
        check(
            subpath.starts_with("/"),
            format!("{} path must start with /", subpath_name).as_str(),
        );
    }

    fn set_diff<T>(a: &[T], b: &[T]) -> Vec<T>
    where
        T: Copy + PartialEq,
    {
        a.iter().filter(|&&x| !b.contains(&x)).copied().collect()
    }

    impl TagsTable {
        pub fn insert(&self, tag: &str) -> u32 {
            let record = self.get_index_by_tags().get(&tag.to_string());
            if record.is_none() {
                let tag_record = TagRecord::new(tag.to_string());
                self.put(&tag_record).unwrap();
                tag_record.id
            } else {
                record.unwrap().id
            }
        }

        pub fn decrement(&self, tag_id: u32) {
            let mut record = self.get_index_pk().get(&tag_id).unwrap();
            record.count -= 1;

            if record.count == 0 {
                self.erase(&tag_id);
            } else {
                self.put(&record).unwrap();
            }
        }

        pub fn increment(&self, tag_id: u32) {
            let mut record = self.get_index_pk().get(&tag_id).unwrap();
            record.count += 1;
            self.put(&record).unwrap();
        }
    }

    impl AppTagsTable {
        pub fn get_tags(&self, app: AccountNumber) -> Vec<u32> {
            self.get_index_pk()
                .range((app, 0)..(app, u32::MAX))
                .map(|t| t.tag_id)
                .collect()
        }

        pub fn remove(&self, app: AccountNumber, tags: &Vec<u32>) {
            let tags_table = TagsTable::new();
            for tag in tags {
                self.erase(&(app, *tag));
                tags_table.decrement(*tag);
            }
        }

        pub fn add(&self, app: AccountNumber, tags: &Vec<u32>) {
            let tags_table = TagsTable::new();
            for tag in tags {
                self.put(&AppTag::new(app, *tag)).unwrap();
                tags_table.increment(*tag);
            }
        }
    }

    impl AppMetadata {
        fn check_valid(&self) {
            validate_length("App name", &self.name, MAX_NAME_SIZE);
            validate_length("Short description", &self.short_desc, MAX_SHORT_DESC_SIZE);
            validate_length("Long description", &self.long_desc, MAX_LONG_DESC_SIZE);

            validate_subpath("TOS", &self.tos_subpage);
            validate_subpath("Privacy policy", &self.privacy_policy_subpage);
            validate_subpath("Homepage", &self.app_homepage_subpage);

            // Validate icon
            if self.icon.len() > 0 {
                check(
                    self.icon_mime_type.len() > 0,
                    "Icon MIME type is required if icon is present",
                );

                check(
                    ICON_MIME_TYPES.contains(&self.icon_mime_type.as_str()),
                    "Unsupported icon MIME type",
                );
            }
        }

        pub fn get(account_id: AccountNumber) -> Self {
            let app_metadata_table = AppMetadataTable::new();
            app_metadata_table.get_index_pk().get(&account_id).unwrap()
        }

        pub fn upsert(
            name: String,
            short_desc: String,
            long_desc: String,
            icon: String,
            icon_mime_type: String,
            tos_subpage: String,
            privacy_policy_subpage: String,
            app_homepage_subpage: String,
        ) -> Self {
            let app_metadata_table = AppMetadataTable::new();

            let app = get_sender();
            let metadata = app_metadata_table.get_index_pk().get(&app);
            let is_new_app = metadata.is_none();
            let mut metadata = metadata.unwrap_or_default();

            metadata.account_id = app;
            metadata.name = name;
            metadata.short_desc = short_desc;
            metadata.long_desc = long_desc;
            metadata.icon = icon;
            metadata.icon_mime_type = icon_mime_type;
            metadata.tos_subpage = tos_subpage;
            metadata.privacy_policy_subpage = privacy_policy_subpage;
            metadata.app_homepage_subpage = app_homepage_subpage;
            metadata.status = if is_new_app {
                app_status::DRAFT
            } else {
                metadata.status
            };

            if is_new_app {
                let created_at = transact::Wrapper::call().currentBlock().time;
                metadata.created_at = created_at;
            }

            metadata.check_valid();

            app_metadata_table.put(&metadata).unwrap();

            if is_new_app {
                Wrapper::emit()
                    .history()
                    .appStatusChanged(app, metadata.status);
            }

            metadata
        }

        pub fn set_tags(&self, tags: &mut Vec<String>) {
            check(
                tags.len() <= MAX_APP_TAGS,
                format!("Max {} tags per app", MAX_APP_TAGS).as_str(),
            );
            tags.dedup();

            let mut desired_tags = Vec::new();
            let tags_table = TagsTable::new();
            for tag in tags {
                desired_tags.push(tags_table.insert(tag));
            }

            let app_tags_table = AppTagsTable::new();
            let current_tags = app_tags_table.get_tags(self.account_id);

            app_tags_table.remove(self.account_id, &set_diff(&current_tags, &desired_tags));
            app_tags_table.add(self.account_id, &set_diff(&desired_tags, &current_tags));
        }

        pub fn publish(&mut self) {
            check(
                self.status != app_status::PUBLISHED,
                "App is already published",
            );

            let required_fields = [
                ("account_id", &self.account_id.to_string()),
                ("name", &self.name),
                ("short_description", &self.short_desc),
                ("long_description", &self.long_desc),
                ("tos_subpage", &self.tos_subpage),
                ("privacy_policy_subpage", &self.privacy_policy_subpage),
                ("app_homepage_subpage", &self.app_homepage_subpage),
            ];
            for (name, v) in required_fields {
                check(v.len() > 0, &format!("{} required to publish", name));
            }

            // TODO: check each of those subpages exist
            // in the caller's namespace in sites (or it must be an SPA)

            self.status = app_status::PUBLISHED;
            AppMetadataTable::new().put(&self).unwrap();

            Wrapper::emit()
                .history()
                .appStatusChanged(self.account_id, self.status);
        }

        pub fn unpublish(&mut self) {
            check(self.status == app_status::PUBLISHED, "App is not published");
            self.status = app_status::UNPUBLISHED;
            AppMetadataTable::new().put(&self).unwrap();

            Wrapper::emit()
                .history()
                .appStatusChanged(self.account_id, self.status);
        }
    }
}
