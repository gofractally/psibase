#[psibase::service]
#[allow(non_snake_case)]
mod service {
    use async_graphql::*;
    use psibase::*;
    use serde::Deserialize;

    #[derive(Deserialize, SimpleObject)]
    struct HistoricalUpdate {
        old_thing: String,
        new_thing: String,
    }

    struct Query;

    #[Object]
    impl Query {
        /// This query gets the current value of the Example Thing.
        async fn example_thing(&self) -> String {
            "cost::Wrapper::call().getExampleThing()".to_string()
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
