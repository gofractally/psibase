#[psibase::service]
#[allow(non_snake_case)]
mod service {
    use async_graphql::{connection::Connection, *};
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
            fractal::Wrapper::call().getExampleThing()
        }

        async fn get_members(&self,
            (fractal: AccountNumber, member_type: Option<String>, titles: Option<u32>),
            first: Option<i32>,
            last: Option<i32>,
            before: Option<String>,
            after: Option<String>,
        // ) -> Option<Vec<Member>> {
        ) -> async_graphql::Result<Connection<u64, Member>> {
            // let fractal = Fractal::new(fractal);
            // let members = fractal.get_members(member_type, titles);
            // Some(members)
            TableQuery::subindex::<(psibase::TimePointSec)>(MemberTable::new().get_index_pk().get(&(fractal, member_type, titles)).unwrap_or_default())
            .first(first)
            .last(last)
            .before(before)
            .after(after)
            .query()
            .await
        }

        async fn get_member(&self, fractal: AccountNumber, member: String) -> Option<Member> {
            let table = MemberTable::new();
            let member = table.get_index_pk().get(&(fractal, member)).unwrap_or_default();
            Some(member)
        }


        /// This query gets paginated historical updates of the Example Thing.
        async fn historical_updates(
            &self,
            first: Option<i32>,
            last: Option<i32>,
            before: Option<String>,
            after: Option<String>,
        ) -> async_graphql::Result<Connection<u64, HistoricalUpdate>> {
            EventQuery::new("history.fractal.updated")
                .first(first)
                .last(last)
                .before(before)
                .after(after)
                .query()
        }
    }

    #[action]
    #[allow(non_snake_case)]
    fn serveSys(request: HttpRequest) -> Option<HttpReply> {
            // Services graphql queries
        None.or_else(|| serve_graphql(&request, Query))

            // Serves a GraphiQL UI interface at the /graphiql endpoint
            .or_else(|| serve_graphiql(&request))

            // TODO: Is this needed? wasn't compiling and isn't in the package-template
            // // Serves a full service schema at the /schema endpoint
            // .or_else(|| serve_schema::<fractal::Wrapper>(&request))
    }
}
