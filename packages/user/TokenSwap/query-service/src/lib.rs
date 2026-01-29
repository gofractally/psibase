#[psibase::service]
#[allow(non_snake_case)]
mod service {
    use async_graphql::{connection::Connection, *};
    use psibase::{services::tokens::TID, *};
    use serde::Deserialize;
    use token_swap::tables::{Pool, PoolTable, Reserve, ReserveTable};

    #[derive(Deserialize, SimpleObject)]
    struct CreatedPool {
        token_a: String,
        token_b: String,
    }

    struct Query;

    #[Object]
    impl Query {
        async fn all_pools(
            &self,
            first: Option<i32>,
            last: Option<i32>,
            before: Option<String>,
            after: Option<String>,
        ) -> async_graphql::Result<Connection<RawKey, Pool>> {
            TableQuery::subindex::<u32>(
                PoolTable::with_service(token_swap::SERVICE).get_index_pk(),
                &(),
            )
            .first(first)
            .last(last)
            .before(before)
            .after(after)
            .query()
            .await
        }

        async fn reserves_by_token(
            &self,
            token_id: TID,
        ) -> async_graphql::Result<Connection<RawKey, Reserve>> {
            TableQuery::subindex::<TID>(
                ReserveTable::with_service(token_swap::SERVICE).get_index_by_token(),
                &(token_id),
            )
            .query()
            .await
        }

        async fn pool(&self, pool_id: u32) -> Option<Pool> {
            PoolTable::with_service(token_swap::SERVICE)
                .get_index_pk()
                .get(&pool_id)
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
