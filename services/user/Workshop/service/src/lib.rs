#[psibase::service]
#[allow(non_snake_case)]
pub mod service {
    use async_graphql::*;
    use psibase::*;
    use serde::{Deserialize, Serialize};

    /// Holds metadata for a registered app
    #[table(name = "AppMetadataTable", index = 0)]
    #[derive(Debug, Clone, Fracpack, ToSchema, Serialize, Deserialize, SimpleObject)]
    pub struct AppMetadata {
        /// The unique identifier for the app
        #[primary_key]
        account_id: AccountNumber,

        /// The name of the app
        name: String,

        /// A short description of the app
        short_description: String,

        /// A detailed description of the app
        long_description: String,

        /// The icon of the app (stored as a base64 string)
        icon: Option<String>,

        /// The subpage for Terms of Service
        tos_subpage: String,

        /// The subpage for Privacy Policy
        privacy_policy_subpage: String,

        /// The subpage for the app's homepage
        app_homepage_subpage: String,

        /// The status of the app (DRAFT, PUBLISHED, or UNPUBLISHED)
        status: String, // todo: change to enum
    }

    #[action]
    fn getAppMetadata(account_id: AccountNumber) -> Option<AppMetadata> {
        AppMetadataTable::new().get_index_pk().get(&account_id)
    }

    #[action]
    fn setAppMetadata(
        // todo: make all fields optional
        name: String,
        short_description: String,
        long_description: String,
        icon: Option<String>, // todo: add hex and type
        tos_subpage: String,
        privacy_policy_subpage: String,
        app_homepage_subpage: String,
        status: String,
    ) {
        let app_metadata_table = AppMetadataTable::new();
        let account_id = get_sender();

        // todo: read the app metadata first and only update the fields that are passed in

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
        };

        app_metadata_table.put(&app_metadata).unwrap();

        Wrapper::emit().history().appMetaChanged(app_metadata);
    }

    #[event(history)]
    fn appMetaChanged(app_metadata: AppMetadata) {}
}

#[psibase::test_case(packages("Workshop"))]
fn test_set_app_metadata(chain: psibase::Chain) -> Result<(), psibase::Error> {
    // use psibase::services::http_server;
    // use psibase::HttpBody;
    // use serde_json::{json, Value};

    // Test setAppMetadata
    let result = Wrapper::push(&chain).setAppMetadata(
        "Test App".to_string(),
        "A short description".to_string(),
        "A long description".to_string(),
        Some("base64_encoded_icon".to_string()), // todo: change to hex and type
        "/tos".to_string(),
        "/privacy".to_string(),
        "/".to_string(),
        "DRAFT".to_string(),
    );
    assert!(result.get().is_ok());

    // chain.finish_block();

    // http_server::Wrapper::push_from(&chain, SERVICE).registerServer(SERVICE);

    // // Test getAppMetadata
    // let reply: Value = chain.graphql(
    //     SERVICE,
    //     r#"query { appMetadata(account_id: "app1") { name shortDescription status } }"#,
    // )?;
    // assert_eq!(
    //     reply,
    //     json!({
    //         "data": {
    //             "appMetadata": {
    //                 "name": "Test App",
    //                 "shortDescription": "A short description",
    //                 "status": "DRAFT"
    //             }
    //         }
    //     })
    // );

    Ok(())
}
