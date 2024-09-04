#[psibase::service]
#[allow(non_snake_case)]
mod service {
    use workshop;
    use async_graphql::*;
    use psibase::*;

    pub struct Query;

    #[Object]
    impl Query {
        /// Get the app metadata for a specific app ID
        async fn app_metadata(
            &self,
            account_id: AccountNumber,
        ) -> Option<workshop::service::AppMetadata> {
            workshop::service::AppMetadataTable::new()
                .get_index_pk()
                .get(&account_id)
        }

        async fn event(
            &self,
            id: u64,
        ) -> Result<workshop::service::event_structs::HistoryEvents, anyhow::Error> {
            get_event(id)
        }
    }

    #[action]
    fn serveSys(request: HttpRequest) -> Option<HttpReply> {
        None.or_else(|| serve_content(&request, &workshop::service::WebContentTable::new()))
            .or_else(|| serve_simple_ui::<workshop::Wrapper>(&request))
            .or_else(|| serve_graphql(&request, Query))
            .or_else(|| serve_graphiql(&request))
    }
}
