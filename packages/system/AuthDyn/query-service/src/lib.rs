#[psibase::service]
#[allow(non_snake_case)]
mod service {
    use async_graphql::{connection::Connection, *};
    use auth_dyn::tables::{Management, ManagementTable};
    use psibase::*;

    struct Query;

    #[Object]
    impl Query {
        async fn get_management(&self, account: AccountNumber) -> Option<Management> {
            Management::get(account)
        }

        async fn get_managed(
            &self,
            manager: AccountNumber,
            first: Option<i32>,
            last: Option<i32>,
            before: Option<String>,
            after: Option<String>,
        ) -> async_graphql::Result<Connection<RawKey, Management>> {
            TableQuery::subindex::<AccountNumber>(
                ManagementTable::with_service(auth_dyn::SERVICE).get_index_by_manager(),
                &(manager),
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
