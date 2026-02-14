#[psibase::service]
#[allow(non_snake_case)]
mod service {
    use async_graphql::*;
    use cost::tables::{Cost, CostTable};
    use psibase::*;

    struct Query;

    #[Object]
    impl Query {
        async fn cost(&self, manager: AccountNumber, id: AccountNumber) -> Option<Cost> {
            CostTable::read().get_index_pk().get(&(manager, id))
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
