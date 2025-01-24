#[psibase::service]
#[allow(non_snake_case)]
mod service {
    use async_graphql::{connection::Connection, *};
    use psibase::*;
    use serde::Deserialize;
    use staged_tx::service::*;

    #[derive(Deserialize, SimpleObject)]
    struct Update {
        txid: Hex<[u8; 32]>,     // The txid of the staged transaction
        actor: AccountNumber,    // The sender of the action causing the event
        datetime: TimePointUSec, // The time of the event emission
        event_type: String,      // The type of event
    }

    struct Query;

    #[async_graphql::Object]
    impl Query {
        /// Gets a staged transaction by its ID
        async fn get_staged_tx(&self, id: u32) -> Option<StagedTx> {
            StagedTxTable::with_service(staged_tx::SERVICE)
                .get_index_pk()
                .get(&id)
        }

        /// Gets all staged transactions
        async fn get_all_staged(&self) -> async_graphql::Result<Connection<RawKey, StagedTx>> {
            TableQuery::new(StagedTxTable::with_service(staged_tx::SERVICE).get_index_pk())
                .query()
                .await
        }

        /// This query gets the historical staged-tx updates
        async fn historical_updates(&self) -> Vec<Update> {
            let json_str = services::r_events::Wrapper::call()
                .sqlQuery("SELECT * FROM \"history.staged-tx.updated\" ORDER BY ROWID".to_string());
            serde_json::from_str(&json_str).unwrap_or_default()
        }
    }

    #[action]
    #[allow(non_snake_case)]
    fn serveSys(request: HttpRequest) -> Option<HttpReply> {
        None.or_else(|| serve_graphql(&request, Query))
            .or_else(|| serve_graphiql(&request))
            .or_else(|| serve_simple_ui::<staged_tx::Wrapper>(&request))
            .or_else(|| serve_schema::<staged_tx::Wrapper>(&request))
    }
}
