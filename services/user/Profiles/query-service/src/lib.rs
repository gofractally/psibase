#[psibase::service]
#[allow(non_snake_case)]
mod service {
    use async_graphql::*;
    use psibase::*;
    use serde::Deserialize;
    use profiles::tables::Profile;

    struct Query;

    #[Object]
    impl Query {
        
        async fn profile(&self, account: AccountNumber) -> Option<Profile> {
            profiles::Wrapper::call().getProfile(account)
        }
    }

    #[action]
    #[allow(non_snake_case)]
    fn serveSys(request: HttpRequest) -> Option<HttpReply> {
            // Services graphql queries
        None.or_else(|| serve_graphql(&request, Query))

            // Serves a GraphiQL UI interface at the /graphiql endpoint
            .or_else(|| serve_graphiql(&request))

            // Serves a full service schema at the /schema endpoint
            .or_else(|| serve_schema::<profiles::Wrapper>(&request))
    }
}
