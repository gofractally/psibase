#[psibase::service]
#[allow(non_snake_case)]
mod service {
    use async_graphql::{connection::Connection, *};
    use fractal::consts::COUNCIL_SIZE;
    use fractal::tables::tables::{Fractal, FractalTable, Member, MemberTable};
    use psibase::*;

    struct Query;

    #[Object]
    impl Query {
        async fn get_members(
            &self,
            fractal: AccountNumber,
            first: Option<i32>,
            last: Option<i32>,
            before: Option<String>,
            after: Option<String>,
        ) -> async_graphql::Result<Connection<RawKey, Member>> {
            TableQuery::subindex::<AccountNumber>(MemberTable::new().get_index_pk(), &fractal)
                .first(first)
                .last(last)
                .before(before)
                .after(after)
                .query()
                .await
        }

        async fn get_member(
            &self,
            fractal: AccountNumber,
            member: AccountNumber,
        ) -> Option<Member> {
            let table = MemberTable::new();
            let member = table
                .get_index_pk()
                .get(&(fractal, member))
                .unwrap_or_default();
            Some(member)
        }

        async fn get_fractal(&self, fractal: AccountNumber) -> Option<Fractal> {
            let table = FractalTable::new();
            let fractal = table.get_index_pk().get(&fractal).unwrap_or_default();
            Some(fractal)
        }

        async fn get_council(
            &self,
            fractal: AccountNumber,
        ) -> async_graphql::Result<Connection<RawKey, Member>> {
            TableQuery::subindex::<(AccountNumber, psibase::TimePointSec, u32)>(
                MemberTable::new().get_index_pk(),
                &fractal,
            )
            .first(Some(COUNCIL_SIZE as i32))
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

        // TODO: Is this needed? wasn't compiling and isn't in the package-template
        // // Serves a full service schema at the /schema endpoint
        // .or_else(|| serve_schema::<fractal::Wrapper>(&request))
    }
}
