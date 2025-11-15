#[psibase::service]
#[allow(non_snake_case)]
mod service {
    use async_graphql::{connection::Connection, *};
    use auth_dyn::tables::{Policy, PolicyTable};
    use psibase::*;

    struct Query;

    #[Object]
    impl Query {
        async fn policy(&self, account: AccountNumber) -> Option<Policy> {
            Policy::get(account)
        }

        async fn policies(
            &self,
            policy: AccountNumber,
            first: Option<i32>,
            last: Option<i32>,
            before: Option<String>,
            after: Option<String>,
        ) -> async_graphql::Result<Connection<RawKey, Policy>> {
            TableQuery::subindex::<AccountNumber>(
                PolicyTable::with_service(auth_dyn::SERVICE).get_index_by_policy(),
                &(policy),
            )
            .first(first)
            .last(last)
            .before(before)
            .after(after)
            .query()
            .await
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
