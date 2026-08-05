#[psibase::service(name = "r-{{project-name | kebab_case}}")]
#[allow(non_snake_case)]
mod service {
    use async_graphql::*;
    use psibase::*;

    struct Query;

    #[Object]
    impl Query {
        /// Current value of the Example Thing.
        async fn example_thing(&self) -> String {
            {{project-name | snake_case}}::Wrapper::call().getExampleThing()
        }
    }

    #[action]
    #[allow(non_snake_case)]
    fn serveSys(request: HttpRequest) -> Option<HttpReply> {
        None.or_else(|| serve_graphql(&request, Query))
            .or_else(|| serve_graphiql(&request))
    }
}
