#[psibase::service]
#[allow(non_snake_case)]
mod service {
    use async_graphql::connection::Connection;
    use psibase::*;
    use staged_tx::service::*;

    struct Query;

    #[async_graphql::Object]
    impl Query {
        /// Gets a staged transaction by its ID
        async fn get_staged_tx(&self, id: u32) -> Option<StagedTx> {
            StagedTxTable::new().get_index_pk().get(&id)
        }

        /// Gets all staged transactions
        async fn get_all_staged(&self) -> async_graphql::Result<Connection<RawKey, StagedTx>> {
            TableQuery::new(StagedTxTable::new().get_index_pk())
                .query()
                .await
        }
    }

    #[action]
    #[allow(non_snake_case)]
    fn serveSys(request: HttpRequest) -> Option<HttpReply> {
        None.or_else(|| serve_graphql(&request, Query))
            .or_else(|| serve_graphiql(&request))
            .or_else(|| serve_simple_ui::<staged_tx::Wrapper>(&request))
    }
}
