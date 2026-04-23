#[psibase::service]
#[allow(non_snake_case)]
mod service {
    use std::u64;

    use async_graphql::{connection::Connection, *};
    use guilds::tables::tables::{
        Guild, GuildApplication, GuildApplicationTable, GuildMember, GuildMemberTable, GuildTable,
        RankingTable,
    };
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
        async fn ranked_guilds(&self, fractal: AccountNumber) -> Vec<AccountNumber> {
            let mut guilds: Vec<_> = RankingTable::read()
                .get_index_pk()
                .range(
                    (fractal, u8::MIN, AccountNumber::new(0))
                        ..=(fractal, u8::MAX, AccountNumber::new(u64::MAX)),
                )
                .collect();

            guilds.sort_by_key(|x| x.index);

            guilds.into_iter().map(|ranking| ranking.guild).collect()
        }

        async fn guilds_by_owner(
            &self,
            owner: AccountNumber,
            first: Option<i32>,
            last: Option<i32>,
            before: Option<String>,
            after: Option<String>,
        ) -> async_graphql::Result<Connection<RawKey, Guild>> {
            TableQuery::subindex::<AccountNumber>(
                GuildTable::with_service(guilds::SERVICE).get_index_by_owner(),
                &(owner),
            )
            .first(first)
            .last(last)
            .before(before)
            .after(after)
            .query()
            .await
        }

        async fn guild_application(
            &self,
            guild: AccountNumber,
            applicant: AccountNumber,
        ) -> Option<GuildApplication> {
            GuildApplicationTable::with_service(guilds::SERVICE)
                .get_index_by_applicant()
                .get(&(guild, applicant))
        }

        async fn guild(&self, account: AccountNumber) -> Option<Guild> {
            GuildTable::with_service(guilds::SERVICE)
                .get_index_pk()
                .get(&account)
        }

        async fn memberships(
            &self,
            member: AccountNumber,
            first: Option<i32>,
            last: Option<i32>,
            before: Option<String>,
            after: Option<String>,
        ) -> async_graphql::Result<Connection<RawKey, GuildMember>> {
            TableQuery::subindex::<AccountNumber>(
                GuildMemberTable::with_service(guilds::SERVICE).get_index_by_member(),
                &(member),
            )
            .first(first)
            .last(last)
            .before(before)
            .after(after)
            .query()
            .await
        }

        async fn example_thing(&self) -> String {
            "guilds::Wrapper::call().getExampleThing()".to_string()
        }

        /// This query gets paginated historical updates of the Example Thing.
        async fn historical_updates(
            &self,
            first: Option<i32>,
            last: Option<i32>,
            before: Option<String>,
            after: Option<String>,
        ) -> async_graphql::Result<Connection<u64, HistoricalUpdate>> {
            EventQuery::new("history.guilds.updated")
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
    }
}
