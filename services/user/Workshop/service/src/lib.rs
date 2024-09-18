#[psibase::service(name = "workshop")]
#[allow(non_snake_case)]
pub mod service {
    use async_graphql::*;
    use serde::{Deserialize, Serialize};

    use psibase::services::transact;
    use psibase::*;

    // #[derive(Debug, Pack, Unpack, Serialize, Deserialize, ToSchema, Clone)]
    // pub enum AppStatus {
    //     Draft,
    //     Published,
    //     Unpublished,
    // }

    /// Holds tags for the app
    #[table(name = "TagRowTable", index = 0)]
    #[derive(Debug, Clone, Fracpack, ToSchema, Serialize, Deserialize, SimpleObject)]
    pub struct TagRow {
        /// The unique identifier for the tag
        #[primary_key]
        id: u64,

        /// The name of the tag
        tag: String,

        /// The account number of the app
        app: AccountNumber,
    }

    /// Holds metadata for a registered app
    #[table(name = "AppMetadataTable", index = 1)]
    #[derive(Debug, Clone, Fracpack, ToSchema, Serialize, Deserialize, SimpleObject)]
    pub struct AppMetadata {
        /// The unique identifier for the app
        #[primary_key]
        pub account_id: AccountNumber,

        /// The name of the app
        pub name: String,

        /// A short description of the app
        pub short_description: String,

        /// A detailed description of the app
        pub long_description: String,

        /// The icon of the app (stored as a base64 string)
        pub icon: Option<String>,

        /// The subpage for Terms of Service
        pub tos_subpage: String,

        /// The subpage for Privacy Policy
        pub privacy_policy_subpage: String,

        /// The subpage for the app's homepage
        pub app_homepage_subpage: String,

        /// The status of the app (DRAFT, PUBLISHED, or UNPUBLISHED)
        pub status: String,

        /// The timestamp of when the app was created
        pub created_at: psibase::TimePointSec,

        /// The tags associated with the app
        pub tags: Vec<u64>,
    }

    #[action]
    fn getMetadata(account_id: AccountNumber) -> Option<AppMetadata> {
        AppMetadataTable::new().get_index_pk().get(&account_id)
    }

    #[action]
    fn setMetadata(
        name: String,
        short_description: String,
        long_description: String,
        icon: Option<String>,
        tos_subpage: String,
        privacy_policy_subpage: String,
        app_homepage_subpage: String,
        status: String,
        tags: Vec<String>,
    ) {
        let app_metadata_table = AppMetadataTable::new();
        let tag_table = TagRowTable::new();
        let account_id = get_sender();
        let created_at = transact::Wrapper::call().currentBlock().time;

        let tags = tags.into_iter().take(3).collect::<Vec<String>>();

        let mut tag_ids = Vec::new();
        let tag_index = tag_table.get_index_pk();

        // Get the last tag ID or start from 0 if the table is empty
        let last_tag_id = tag_index
            .into_iter()
            .last()
            .map(|last_tag| last_tag.id)
            .unwrap_or(0);

        for (i, tag) in tags.iter().enumerate() {
            let id = last_tag_id + i as u64 + 1; // Increment ID for each new tag
            let tag_row = TagRow {
                id,
                tag: tag.clone(),
                app: account_id,
            };
            tag_table.put(&tag_row).unwrap();
            tag_ids.push(id);
        }

        // let status = match status.as_str() {
        //     "Draft" => AppStatus::Draft,
        //     "Published" => AppStatus::Published,
        //     "Unpublished" => AppStatus::Unpublished,
        //     _ => return,
        // };

        let app_metadata = AppMetadata {
            account_id,
            name,
            short_description,
            long_description,
            icon,
            tos_subpage,
            privacy_policy_subpage,
            app_homepage_subpage,
            status,
            created_at,
            tags: tag_ids,
        };

        app_metadata_table.put(&app_metadata).unwrap();

        Wrapper::emit().history().appMetaChanged(app_metadata);
    }

    #[event(history)]
    fn appMetaChanged(app_metadata: AppMetadata) {}
}

// #[psibase::test_case(packages("workshop"))]
// fn test_set_app_metadata(chain: psibase::Chain) -> Result<(), psibase::Error> {
//     use psibase::services::http_server;
//     use psibase::HttpBody;
//     use serde_json::{json, Value};

//     // Test setMetadata
//     let result = Wrapper::push(&chain).setMetadata(
//         "Test App".to_string(),
//         "A short description".to_string(),
//         "A long description".to_string(),
//         Some("base64_encoded_icon".to_string()),
//         "/tos".to_string(),
//         "/privacy".to_string(),
//         "/".to_string(),
//         "Draft".to_string(),
//         vec!["tag1".to_string(), "tag2".to_string(), "tag3".to_string()],
//     );
//     assert!(result.get().is_ok());

//     chain.finish_block();

//     http_server::Wrapper::push_from(&chain, SERVICE).registerServer(SERVICE);

//     // Test getMetadata
//     let reply: Value = chain.graphql(
//         SERVICE,
//         r#"query { appMetadata(account_id: "app1") { name shortDescription status } }"#,
//     )?;
//     assert_eq!(
//         reply,
//         json!({
//             "data": {
//                 "appMetadata": {
//                     "name": "Test App",
//                     "shortDescription": "A short description",
//                     "status": "Draft"
//                 }
//             }
//         })
//     );

//     Ok(())
// }

#[psibase::test_case(packages("workshop"))]
fn test_workshop_actions(chain: psibase::Chain) -> Result<(), psibase::Error> {
    use psibase::services::http_server;
    use psibase::AccountNumber;
    use serde_json::{json, Value};

    let SERVICE = AccountNumber::from_exact("app1").unwrap();
    let APP1 = AccountNumber::from_exact("app1").unwrap();

    // Test setMetadata
    let result = Wrapper::push_from(&chain, APP1).setMetadata(
        "Test App".to_string(),
        "A short description".to_string(),
        "A long description".to_string(),
        Some("base64_encoded_icon".to_string()),
        "/tos".to_string(),
        "/privacy".to_string(),
        "/".to_string(),
        "Draft".to_string(),
        vec!["tag1".to_string(), "tag2".to_string(), "tag3".to_string()],
    );
    assert!(result.get().is_ok());

    chain.finish_block();

    http_server::Wrapper::push_from(&chain, SERVICE).registerServer(SERVICE);

    // Test getMetadata
    let reply: Value = chain.graphql(
        SERVICE,
        &*format!(r#"query {{ getMetadata(account_id: "{APP1}") {{ name shortDescription status tags }} }}"#),
    )?;
    assert_eq!(
        reply,
        json!({
            "data": {
                "getMetadata": {
                    "name": "Test App",
                    "shortDescription": "A short description",
                    "status": "Draft",
                    "tags": [1, 2, 3]
                }
            }
        })
    );

    // Test updating metadata
    let update_result = Wrapper::push_from(&chain, APP1).setMetadata(
        "Updated App".to_string(),
        "Updated short description".to_string(),
        "Updated long description".to_string(),
        Some("updated_base64_icon".to_string()),
        "/updated-tos".to_string(),
        "/updated-privacy".to_string(),
        "/updated".to_string(),
        "Published".to_string(),
        vec!["newtag1".to_string(), "newtag2".to_string()],
    );
    assert!(update_result.get().is_ok());

    chain.finish_block();

    // Test getting updated metadata
    let updated_reply: Value = chain.graphql(
        SERVICE,
        &*format!(r#"query {{ getMetadata(account_id: "{APP1}") {{ name shortDescription status tags }} }}"#),
    )?;
    assert_eq!(
        updated_reply,
        json!({
            "data": {
                "getMetadata": {
                    "name": "Updated App",
                    "shortDescription": "Updated short description",
                    "status": "Published",
                   "tags": [4, 5]
                }
            }
        })
    );

    // Test invalid status
    let invalid_status_result = Wrapper::push_from(&chain, APP1).setMetadata(
        "Invalid Status App".to_string(),
        "Short description".to_string(),
        "Long description".to_string(),
        None,
        "/tos".to_string(),
        "/privacy".to_string(),
        "/".to_string(),
        "INVALID_STATUS".to_string(),
        vec![],
    );
    assert!(invalid_status_result.get().is_ok());

    Ok(())
}
