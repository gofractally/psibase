#[psibase::service]
#[allow(non_snake_case)]
mod service {
    use std::u64;

    use async_graphql::{connection::Connection, *};
    use guilds::tables::tables::{
        Guild, GuildApplication, GuildApplicationTable, GuildInvite, GuildInviteTable, GuildMember,
        GuildMemberTable, GuildTable, RankingTable, RoleMap, RoleMapTable,
    };
    use psibase::{AccountNumber, *};

    struct Query;

    #[Object]
    impl Query {
        async fn ranked_guilds(&self, fractal: AccountNumber) -> Vec<AccountNumber> {
            let mut guilds: Vec<_> = RankingTable::read()
                .get_index_pk()
                .range((fractal, u8::MIN)..=(fractal, u8::MAX))
                .collect();

            guilds.sort_by_key(|x| x.index);

            guilds.into_iter().map(|ranking| ranking.guild).collect()
        }

        async fn role_map(
            &self,
            fractal: AccountNumber,
            role_id: Option<u8>,
        ) -> async_graphql::Result<Connection<RawKey, RoleMap>> {
            if let Some(role_id) = role_id {
                TableQuery::subindex::<AccountNumber>(
                    RoleMapTable::with_service(guilds::SERVICE).get_index_pk(),
                    &(fractal, role_id),
                )
                .query()
                .await
            } else {
                TableQuery::subindex::<AccountNumber>(
                    RoleMapTable::with_service(guilds::SERVICE).get_index_pk(),
                    &(fractal),
                )
                .query()
                .await
            }
        }

        async fn guild_membership(
            &self,
            guild: AccountNumber,
            member: AccountNumber,
        ) -> Option<GuildMember> {
            GuildMemberTable::read()
                .get_index_pk()
                .get(&(guild, member))
        }

        async fn guild_invite(&self, id: u32) -> Option<GuildInvite> {
            GuildInviteTable::with_service(guilds::SERVICE)
                .get_index_pk()
                .get(&id)
        }

        async fn guilds_by_fractal(
            &self,
            fractal: AccountNumber,
            first: Option<i32>,
            last: Option<i32>,
            before: Option<String>,
            after: Option<String>,
        ) -> async_graphql::Result<Connection<RawKey, Guild>> {
            TableQuery::subindex::<AccountNumber>(
                GuildTable::with_service(guilds::SERVICE).get_index_by_fractal(),
                &(fractal),
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

        async fn scores(
            &self,
            guild: AccountNumber,
            first: Option<i32>,
            last: Option<i32>,
            before: Option<String>,
            after: Option<String>,
        ) -> async_graphql::Result<Connection<RawKey, GuildMember>> {
            TableQuery::subindex::<AccountNumber>(
                GuildMemberTable::with_service(guilds::SERVICE).get_index_pk(),
                &(guild),
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
