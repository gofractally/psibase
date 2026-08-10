#[psibase::service(name = "profiles+1")]
#[allow(non_snake_case)]
mod service {
    use async_graphql::*;
    use profiles::tables::Profile;
    use psibase::*;

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
        None.or_else(|| serve_graphql(&request, Query))
            .or_else(|| serve_graphiql(&request))
    }
}
