#[psibase::service]
#[allow(non_snake_case)]
mod service {

    use async_graphql::{connection::Connection, *};
    use fractals::tables::tables::{Fractal, FractalMember, FractalMemberTable, FractalTable};
    use psibase::{AccountNumber, *};
    use serde::Deserialize;
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
            EventQuery::new("history.fractals.evaluation_finished")
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
            EventQuery::new("history.fractals.scheduled_evaluation")
                .condition(format!("guild = '{}'", guild))
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

        async fn member(
            &self,
            fractal: AccountNumber,
            member: AccountNumber,
        ) -> Option<FractalMember> {
            FractalMemberTable::with_service(fractals::SERVICE)
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
        ) -> async_graphql::Result<Connection<RawKey, FractalMember>> {
            TableQuery::subindex::<AccountNumber>(
                FractalMemberTable::with_service(fractals::SERVICE).get_index_by_member(),
                &(member),
            )
            .first(first)
            .last(last)
            .before(before)
            .after(after)
            .query()
            .await
        }

        async fn members(
            &self,
            fractal: AccountNumber,
            first: Option<i32>,
            last: Option<i32>,
            before: Option<String>,
            after: Option<String>,
        ) -> async_graphql::Result<Connection<RawKey, FractalMember>> {
            TableQuery::subindex::<AccountNumber>(
                FractalMemberTable::with_service(fractals::SERVICE).get_index_pk(),
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
