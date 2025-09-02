#[psibase::service]
#[allow(non_snake_case)]
mod service {
    use async_graphql::*;
    use psibase::*;
    use secrets::tables::{Secret, SecretsTable};

    struct Query;

    #[Object]
    impl Query {
        /// This query gets an encrypted secret by id.
        async fn get_secret(&self, id: u32) -> Option<Secret> {
            SecretsTable::with_service(secrets::SERVICE)
                .get_index_pk()
                .get(&id)
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
