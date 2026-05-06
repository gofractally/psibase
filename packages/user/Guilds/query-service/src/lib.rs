#[psibase::service]
#[allow(non_snake_case)]
mod service {
    use std::u64;

    use async_graphql::{connection::Connection, *};
    use guilds::{
        helpers::parse_rank_to_accounts,
        tables::tables::{
            Guild, GuildApplication, GuildApplicationTable, GuildInvite, GuildInviteTable,
            GuildMember, GuildMemberTable, GuildTable, RankingTable, RoleMap, RoleMapTable,
        },
    };
    use serde::{Deserialize, Deserializer};

    use psibase::{AccountNumber, *};

    use serde_aux::field_attributes::deserialize_number_from_string;

    #[derive(Deserialize, SimpleObject)]
    struct EvaluationFinish {
        guild: AccountNumber,
        #[serde(deserialize_with = "deserialize_number_from_string")]
        evaluation_id: u32,
    }

    #[derive(Deserialize, SimpleObject)]
    struct ScheduledEvaluation {
        fractal: AccountNumber,
        guild: AccountNumber,
        #[serde(deserialize_with = "deserialize_number_from_string")]
        evaluation_id: u32,
        #[serde(deserialize_with = "deserialize_number_from_string")]
        registration: u32,
        #[serde(deserialize_with = "deserialize_number_from_string")]
        deliberation: u32,
        #[serde(deserialize_with = "deserialize_number_from_string")]
        submission: u32,
        #[serde(deserialize_with = "deserialize_number_from_string")]
        finish_by: u32,
    }

    #[derive(SimpleObject)]
    struct GroupFinish {
        evaluation_id: u32,
        group_number: u32,
        users: Vec<AccountNumber>,
        result: Vec<AccountNumber>,
    }

    impl<'de> Deserialize<'de> for GroupFinish {
        fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
        where
            D: Deserializer<'de>,
        {
            #[derive(Deserialize)]
            struct GroupFinishRaw {
                #[serde(deserialize_with = "deserialize_number_from_string")]
                evaluation_id: u32,
                #[serde(deserialize_with = "deserialize_number_from_string")]
                group_number: u32,
                users: Vec<AccountNumber>,
                result: Vec<u8>,
            }

            let raw = GroupFinishRaw::deserialize(deserializer)?;
            Ok(GroupFinish {
                evaluation_id: raw.evaluation_id,
                group_number: raw.group_number,
                users: raw.users.clone(),
                result: parse_rank_to_accounts(raw.result, raw.users),
            })
        }
    }

    #[derive(Deserialize, SimpleObject)]
    struct NewGroup {
        owner: AccountNumber,
        #[serde(deserialize_with = "deserialize_number_from_string")]
        evaluation_id: u32,
        #[serde(deserialize_with = "deserialize_number_from_string")]
        group_number: u32,
        users: Vec<AccountNumber>,
    }

    struct Query;

    #[Object]
    impl Query {
        async fn get_groups_created(
            &self,
            evaluation_id: u32,
            first: Option<i32>,
            last: Option<i32>,
            before: Option<String>,
            after: Option<String>,
        ) -> async_graphql::Result<EventConnection<NewGroup>> {
            EventQuery::new("history.evaluations.new_group")
                .condition(format!(
                    "owner = 'guilds' AND evaluation_id = {}",
                    evaluation_id
                ))
                .first(first)
                .last(last)
                .before(before)
                .after(after)
                .query()
        }

        async fn group_finishes(
            &self,
            evaluation_id: u32,
            first: Option<i32>,
            last: Option<i32>,
            before: Option<String>,
            after: Option<String>,
        ) -> async_graphql::Result<EventConnection<GroupFinish>> {
            EventQuery::new("history.evaluations.group_fin")
                .condition(format!(
                    "owner = 'fractals' AND evaluation_id = {}",
                    evaluation_id
                ))
                .first(first)
                .last(last)
                .before(before)
                .after(after)
                .query()
        }

        async fn evaluation_finishes(
            &self,
            guild: AccountNumber,
            first: Option<i32>,
            last: Option<i32>,
            before: Option<String>,
            after: Option<String>,
        ) -> async_graphql::Result<EventConnection<EvaluationFinish>> {
            EventQuery::new("history.guilds.evaluation_finished")
                .condition(format!("guild = '{}'", guild))
                .first(first)
                .last(last)
                .before(before)
                .after(after)
                .query()
        }

        async fn scheduled_evaluations(
            &self,
            guild: AccountNumber,
            first: Option<i32>,
            last: Option<i32>,
            before: Option<String>,
            after: Option<String>,
        ) -> async_graphql::Result<EventConnection<ScheduledEvaluation>> {
            EventQuery::new("history.guilds.scheduled_evaluation")
                .condition(format!("guild = '{}'", guild))
                .first(first)
                .last(last)
                .before(before)
                .after(after)
                .query()
        }

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
                .get_index_pk()
                .get(&(guild, applicant))
        }

        async fn guild_applications(
            &self,
            guild: AccountNumber,
            first: Option<i32>,
            last: Option<i32>,
            before: Option<String>,
            after: Option<String>,
        ) -> async_graphql::Result<Connection<RawKey, GuildApplication>> {
            TableQuery::subindex::<AccountNumber>(
                GuildApplicationTable::with_service(guilds::SERVICE).get_index_pk(),
                &(guild),
            )
            .first(first)
            .last(last)
            .before(before)
            .after(after)
            .query()
            .await
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
