#[psibase::service(name = "banx+1")]
#[allow(non_snake_case)]
mod service {
    use async_graphql::*;
    use psibase::*;

    struct Query;

    #[Object]
    impl Query {
        /// Placeholder until Banx GraphQL schema is wired to tables.
        async fn ping(&self) -> String {
            "banx".to_string()
        }
    }

    #[action]
    #[allow(non_snake_case)]
    fn serveSys(request: HttpRequest) -> Option<HttpReply> {
        None.or_else(|| serve_graphql(&request, Query))
            .or_else(|| serve_graphiql(&request))
    }
}
