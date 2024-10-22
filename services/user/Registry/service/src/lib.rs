mod utils;

#[psibase::service(name = "registry")]
#[allow(non_snake_case)]
pub mod service {
    use async_graphql::*;
    use serde::{Deserialize, Serialize};

    use psibase::services::transact;
    use psibase::*;

    use crate::utils::increment_last_char;

    // An App can't have more than 3 tags
    const MAX_APP_TAGS: usize = 3;

    /// Holds tags
    #[table(name = "TagsTable", index = 0)]
    #[derive(Debug, Clone, Fracpack, ToSchema, Serialize, Deserialize, SimpleObject)]
    pub struct TagRecord {
        /// The unique identifier for the tag
        #[primary_key]
        pub id: u32,

        /// The name of the tag
        pub tag: String,
    }

    impl TagRecord {
        #[secondary_key(1)]
        fn by_tags(&self) -> (String, u32) {
            (self.tag.clone(), self.id)
        }
    }

    /// Holds metadata for a registered app
    #[table(name = "AppMetadataTable", index = 1)]
    #[derive(Default, Debug, Clone, Fracpack, ToSchema, Serialize, Deserialize, SimpleObject)]
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
        pub status: String, // TODO: Create enum

        /// The timestamp of when the app was created
        pub created_at: psibase::TimePointSec,

        pub redirect_uris: Vec<String>,

        pub owners: Vec<AccountNumber>,
    }

    #[table(name = "AppTagsTable", index = 2)]
    #[derive(Debug, Clone, Fracpack, ToSchema, Serialize, Deserialize, SimpleObject)]
    pub struct AppTags {
        /// The app ID
        pub app_id: AccountNumber,

        /// The tag ID
        pub tag_id: u32,
    }

    impl AppTags {
        #[primary_key]
        fn by_app_tag_ids(&self) -> (AccountNumber, u32) {
            (self.app_id, self.tag_id)
        }
    }

    #[derive(SimpleObject, Pack, Unpack, Deserialize, Serialize, ToSchema)]
    pub struct AppMetadataWithTags {
        pub metadata: AppMetadata,
        pub tags: Vec<TagRecord>,
    }

    #[derive(SimpleObject, Pack, Unpack, Deserialize, Serialize, ToSchema)]
    pub struct RelatedTags {
        pub tags: Vec<String>,
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
        status: String,
        tags: Vec<String>,
        redirect_uris: Vec<String>,
        owners: Vec<AccountNumber>,
    ) {
        let app_metadata_table = AppMetadataTable::new();
        let account_id = get_sender();
        let created_at = transact::Wrapper::call().currentBlock().time;

        check(
            tags.len() <= MAX_APP_TAGS,
            format!("App can only have up to {} tags", MAX_APP_TAGS).as_str(),
        );

        let mut metadata = app_metadata_table
            .get_index_pk()
            .get(&account_id)
            .unwrap_or_default();
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
        metadata.created_at = if metadata.created_at.seconds == 0 {
            created_at
        } else {
            metadata.created_at
        };
        metadata.redirect_uris = redirect_uris;
        metadata.owners = owners;

        println!("metadata to be inserted: {:?}", metadata);

        app_metadata_table.put(&metadata).unwrap();

        updateAppTags(account_id, &tags);

        println!("metadata inserted !!!");

        Wrapper::emit().history().appMetadataChanged(metadata);
    }

    #[action]
    fn getMetadata(account_id: AccountNumber) -> Option<AppMetadataWithTags> {
        let app_metadata_table = AppMetadataTable::new();
        let app_tags_table = AppTagsTable::new();
        let tags_table = TagsTable::new();
        // Get the app metadata
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
    fn getRelatedTags(partial_tag: String) -> Option<RelatedTags> {
        let table = TagsTable::new();
        let idx = table.get_index_by_tags();

        let from = partial_tag.to_lowercase();
        let excluded_to = increment_last_char(from.clone());

        let tags: Vec<String> = idx
            .range((from, 0)..(excluded_to, 0))
            .take(10)
            .map(|tag_row| tag_row.tag)
            .collect();

        Some(RelatedTags { tags })
    }

    #[event(history)]
    fn appMetadataChanged(app_metadata: AppMetadata) {}

    fn process_tag(
        tag: &str,
        account_id: AccountNumber,
        existing_app_tags: &Vec<AppTags>,
    ) -> AppTags {
        if let Some(existing_tag) = find_existing_app_tag(tag, existing_app_tags) {
            existing_tag.clone()
        } else {
            create_new_app_tag(tag, account_id)
        }
    }

    fn create_new_app_tag(tag: &str, account_id: AccountNumber) -> AppTags {
        let app_tags_table = AppTagsTable::new();
        let tag_id = get_or_create_tag_id(tag);
        let new_app_tag = AppTags {
            app_id: account_id,
            tag_id,
        };
        app_tags_table.put(&new_app_tag).unwrap();
        new_app_tag
    }

    fn find_existing_app_tag(tag: &str, existing_app_tags: &Vec<AppTags>) -> Option<AppTags> {
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
        let existing_app_tags: Vec<AppTags> = app_tags_table
            .get_index_pk()
            .range((account_id, 0)..(account_id, u32::MAX))
            .collect();

        let mut new_app_tags = Vec::new();

        for tag in tags {
            let app_tag = process_tag(tag, account_id, &existing_app_tags);
            new_app_tags.push(app_tag);
        }

        remove_obsolete_tags(&existing_app_tags, &new_app_tags);

        // todo: validate if tags are valid (lowercase alphanumeric and dashes)
    }

    fn get_or_create_tag_id(tag: &str) -> u32 {
        let tags_table = TagsTable::new();
        let idx = tags_table.get_index_by_tags();
        idx.range((tag.to_string(), 0)..(tag.to_string(), u32::MAX))
            .find(|tag_row| tag_row.tag == tag)
            .map(|tag_row| tag_row.id)
            .unwrap_or_else(|| create_new_tag(tag.to_string()))
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
        tags_table.put(&new_tag).unwrap();
        new_id
    }

    fn remove_obsolete_tags(existing_app_tags: &[AppTags], new_app_tags: &[AppTags]) {
        let app_tags_table = AppTagsTable::new();
        for existing_tag in existing_app_tags {
            if !new_app_tags
                .iter()
                .any(|at| at.tag_id == existing_tag.tag_id)
            {
                app_tags_table.remove(existing_tag);
                // TODO: Check if there are any apps using the tag from tags_table and remove if not
            }
        }
    }
}

// TODO: how to make these tests work?
#[psibase::test_case(packages("RegistryPackage"))]
fn test_foo(chain: psibase::Chain) -> Result<(), psibase::Error> {
    chain.new_account(account!("alice"))?;

    Wrapper::push_from(&chain, AccountNumber::from_exact("alice").unwrap())
        .setMetadata(
            "Super Cooking App".to_string(),
            "Alice's Cooking App".to_string(),
            "Super cooking app".to_string(),
            "icon-as-base64".to_string(),
            "image/png".to_string(),
            "/tos".to_string(),
            "/privacy-policy".to_string(),
            "/".to_string(),
            "DRAFT".to_string(),
            vec![
                "cozy".to_string(),
                "cuisine".to_string(),
                "cooking".to_string(),
            ],
            vec!["http://localhost:3000/callback".to_string()],
            vec![
                AccountNumber::from_exact("alice").unwrap(),
                AccountNumber::from_exact("bob").unwrap(),
            ],
        )
        .get()?;

    let metadata = Wrapper::push(&chain)
        .getMetadata(AccountNumber::from_exact("alice").unwrap())
        .unwrap();

    assert_eq!(metadata.metadata.name, "Super Cooking App");
    assert_eq!(metadata.metadata.short_description, "Alice's Cooking App");
    assert_eq!(metadata.metadata.long_description, "Super cooking app");
    assert_eq!(metadata.metadata.icon, "icon-as-base64");
    assert_eq!(metadata.metadata.icon_mime_type, "image/png");
    assert_eq!(metadata.metadata.tos_subpage, "/tos");
    assert_eq!(metadata.metadata.privacy_policy_subpage, "/privacy-policy");
    assert_eq!(metadata.metadata.app_homepage_subpage, "/");
    assert_eq!(metadata.metadata.status, "DRAFT");

    Ok(())
}
