#[psibase::service]
#[allow(non_snake_case)]
mod service {
    use std::{str::FromStr, u64};

    use async_graphql::{connection::Connection, *};
    use fractals::tables::tables::{
        EvaluationInstance, EvaluationInstanceTable, Fractal, FractalTable, Member, MemberTable,
        Score, ScoreTable,
    };
    use psibase::*;
    use serde::{Deserialize, Deserializer};
    use serde_aux::field_attributes::deserialize_number_from_string;

    #[derive(Deserialize, SimpleObject)]
    struct EvaluationFinish {
        fractal_account: AccountNumber,
        #[serde(deserialize_with = "deserialize_number_from_string")]
        evaluation_id: u32,
    }

    #[derive(Deserialize, SimpleObject)]
    struct ScheduledEvaluation {
        fractal_account: AccountNumber,
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

    #[derive(Deserialize, SimpleObject)]
    struct NewGroup {
        owner: AccountNumber,
        #[serde(deserialize_with = "deserialize_number_from_string")]
        evaluation_id: u32,
        #[serde(deserialize_with = "deserialize_number_from_string")]
        group_number: u32,
        users: Vec<AccountNumber>,
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
                result: fractals::helpers::parse_rank_to_accounts(raw.result, raw.users),
            })
        }
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
        ) -> async_graphql::Result<Connection<u64, NewGroup>> {
            EventQuery::new("history.evaluations.new_group")
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
            fractal: AccountNumber,
            first: Option<i32>,
            last: Option<i32>,
            before: Option<String>,
            after: Option<String>,
        ) -> async_graphql::Result<Connection<u64, EvaluationFinish>> {
            EventQuery::new("history.fractals.evaluation_finished")
                .condition(format!("fractal_account = '{}'", fractal))
                .first(first)
                .last(last)
                .before(before)
                .after(after)
                .query()
        }

        async fn scheduled_evaluations(
            &self,
            fractal: AccountNumber,
            first: Option<i32>,
            last: Option<i32>,
            before: Option<String>,
            after: Option<String>,
        ) -> async_graphql::Result<Connection<u64, ScheduledEvaluation>> {
            EventQuery::new("history.fractals.scheduled_evaluation")
                .condition(format!("fractal_account = '{}'", fractal))
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
        ) -> async_graphql::Result<Connection<u64, GroupFinish>> {
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

        async fn fractal(&self, fractal: AccountNumber) -> Option<Fractal> {
            FractalTable::with_service(fractals::SERVICE)
                .get_index_pk()
                .get(&fractal)
        }

        async fn evaluations(&self, fractal: AccountNumber) -> Vec<EvaluationInstance> {
            EvaluationInstanceTable::with_service(fractals::SERVICE)
                .get_index_pk()
                .range((fractal, 0)..=(fractal, u8::MAX))
                .collect()
        }

        async fn scores(
            &self,
            fractal: AccountNumber,
            member: Option<AccountNumber>,
        ) -> Vec<Score> {
            ScoreTable::with_service(fractals::SERVICE)
                .get_index_pk()
                .range(
                    (fractal, 0, member.unwrap_or(AccountNumber::new(0)))
                        ..=(
                            fractal,
                            u8::MAX,
                            member.unwrap_or(AccountNumber::new(u64::MAX)),
                        ),
                )
                .collect()
        }

        async fn fractals(
            &self,
            first: Option<i32>,
            last: Option<i32>,
            before: Option<String>,
            after: Option<String>,
        ) -> async_graphql::Result<Connection<RawKey, Fractal>> {
            TableQuery::new(FractalTable::with_service(fractals::SERVICE).get_index_pk())
                .first(first)
                .last(last)
                .before(before)
                .after(after)
                .query()
                .await
        }

        async fn fractals_list(&self, fractals: Vec<AccountNumber>) -> Vec<Option<Fractal>> {
            fractals
                .into_iter()
                .map(|account| {
                    FractalTable::with_service(fractals::SERVICE)
                        .get_index_pk()
                        .get(&account)
                })
                .collect()
        }

        async fn member(&self, fractal: AccountNumber, member: AccountNumber) -> Option<Member> {
            MemberTable::with_service(fractals::SERVICE)
                .get_index_pk()
                .get(&(fractal, member))
        }

        async fn memberships(
            &self,
            member: AccountNumber,
            first: Option<i32>,
            last: Option<i32>,
            before: Option<String>,
            after: Option<String>,
        ) -> async_graphql::Result<Connection<RawKey, Member>> {
            TableQuery::subindex::<AccountNumber>(
                MemberTable::with_service(fractals::SERVICE).get_index_by_member(),
                &(member),
            )
            .first(first)
            .last(last)
            .before(before)
            .after(after)
            .query()
            .await
        }

        async fn fractal_memberships(&self, member: AccountNumber) -> Vec<Fractal> {
            let memberships: Vec<Member> = MemberTable::with_service(fractals::SERVICE)
                .get_index_by_member()
                .range((member, AccountNumber::from(0))..=(member, AccountNumber::from(u64::MAX)))
                .collect();

            let fractal_accounts: Vec<AccountNumber> = memberships
                .into_iter()
                .map(|membership| membership.fractal)
                .collect();

            fractal_accounts
                .into_iter()
                .filter_map(|account| {
                    FractalTable::with_service(fractals::SERVICE)
                        .get_index_pk()
                        .get(&account)
                })
                .collect()
        }

        async fn members(
            &self,
            fractal: AccountNumber,
            first: Option<i32>,
            last: Option<i32>,
            before: Option<String>,
            after: Option<String>,
        ) -> async_graphql::Result<Connection<RawKey, Member>> {
            TableQuery::subindex::<AccountNumber>(
                MemberTable::with_service(fractals::SERVICE).get_index_pk(),
                &(fractal),
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
        None.or_else(|| serve_graphql(&request, Query))
            .or_else(|| serve_graphiql(&request))
    }
}
