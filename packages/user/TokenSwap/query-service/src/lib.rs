#[psibase::service]
#[allow(non_snake_case)]
mod service {
    use async_graphql::{connection::Connection, *};
    use psibase::{
        services::tokens::{Quantity, TID},
        *,
    };
    use serde::Deserialize;

    #[derive(Deserialize, SimpleObject)]
    struct HistoricalUpdate {
        old_thing: String,
        new_thing: String,
    }

    struct Query;

    #[Object]
    impl Query {
        async fn quote(&self, pool_id: u32, token_in: TID, amount: Quantity) -> String {
            "quote".into()
        }

        /// This query gets paginated historical updates of the Example Thing.
        async fn historical_updates(
            &self,
            first: Option<i32>,
            last: Option<i32>,
            before: Option<String>,
            after: Option<String>,
        ) -> async_graphql::Result<Connection<u64, HistoricalUpdate>> {
            EventQuery::new("history.token-swap.updated")
                .first(first)
                .last(last)
                .before(before)
                .after(after)
                .query()
        }
    }

    #[action]
    #[allow(non_snake_case)]
    fn serveSys(request: HttpRequest) -> Option<HttpReply> {
        // Services graphql queries
        None.or_else(|| serve_graphql(&request, Query))
            // Serves a GraphiQL UI interface at the /graphiql endpoint
            .or_else(|| serve_graphiql(&request))
    }
}
