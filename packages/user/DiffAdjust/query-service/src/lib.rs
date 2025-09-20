#[psibase::service]
#[allow(non_snake_case)]
mod service {
    use async_graphql::*;
    use diff_adjust::tables::{RateLimit, RateLimitTable};
    use psibase::*;

    struct Query;

    #[Object]
    impl Query {
        async fn rateLimit(&self, nft_id: u32) -> Option<RateLimit> {
            RateLimitTable::new()
                .get_index_pk()
                .get(&nft_id)
                .map(|mut rateLimit| {
                    rateLimit.check_difficulty_decrease();
                    rateLimit
                })
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
