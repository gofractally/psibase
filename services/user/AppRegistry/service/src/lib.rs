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

    #[table(record = "WebContentRow", index = 1)]
    pub struct WebContentTable;

    #[action]
    pub fn setAppMetadata(
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

        Wrapper::emit().history().setAppMetadata(app_metadata);
    }

    #[action]
    fn storeSys(path: String, contentType: String, content: Hex<Vec<u8>>) {
        println!("{} {}", path, contentType);
        store_content(path, contentType, content, &WebContentTable::new()).unwrap()
    }

    #[event(history)]
    pub fn setAppMetadata(app_metadata: AppMetadata) {}  

    // #[action]
    // fn serveSys(request: HttpRequest) -> Option<HttpReply> {
    //     None.or_else(|| serve_content(&request, &WebContentTable::new()))
    //         .or_else(|| serve_simple_ui::<Wrapper>(&request))
    //         .or_else(|| serve_graphql(&request, Query))
    //         .or_else(|| serve_graphiql(&request))
    // } 
}


#[psibase::test_case(packages("AppRegistry"))]
fn test_app_registry(chain: psibase::Chain) -> Result<(), psibase::Error> {
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
