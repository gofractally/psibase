#[psibase::service]
#[allow(non_snake_case)]
mod service {
    use async_graphql::*;
    use psibase::*;
    use workshop;

    #[table(record = "WebContentRow", index = 0)]
    struct WebContentTable;

    #[action]
    fn storeSys(path: String, contentType: String, content: Hex<Vec<u8>>) {
        println!("{} {}", path, contentType);
        store_content(path, contentType, content, &WebContentTable::new()).unwrap()
    }

    pub struct Query;

    #[Object]
    impl Query {
        /// Get the app metadata for a specific app ID
        async fn app_metadata(
            &self,
            account_id: AccountNumber,
        ) -> Option<workshop::service::AppMetadata> {
            let x = workshop::Wrapper::call().getAppMetadata(account_id);
            x
        }
    }

    #[action]
    fn serveSys(request: HttpRequest) -> Option<HttpReply> {
        None.or_else(|| serve_content(&request, &WebContentTable::new()))
            .or_else(|| serve_simple_ui::<workshop::Wrapper>(&request))
            .or_else(|| serve_graphql(&request, Query))
            .or_else(|| serve_graphiql(&request))
    }
}
