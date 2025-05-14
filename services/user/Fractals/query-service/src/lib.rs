#[psibase::service]
#[allow(non_snake_case)]
mod service {
    use std::str::FromStr;

    use async_graphql::{connection::Connection, *};
    use fractals::tables::tables::{
        EvaluationInstance, EvaluationInstanceTable, Fractal, FractalTable, Member, MemberTable,
    };
    use psibase::*;
    use serde::Deserialize;
    use serde_aux::field_attributes::deserialize_number_from_string;

    #[derive(Deserialize, SimpleObject)]
    struct HistoricalUpdate {
        old_thing: String,
        new_thing: String,
    }

    #[derive(Deserialize, SimpleObject)]
    struct EvaluationFinish {
        owner: AccountNumber,
        #[serde(deserialize_with = "deserialize_number_from_string")]
        evaluation_id: u32,
    }

    struct Query;

    #[Object]
    impl Query {
        async fn historical_updates(
            &self,
            first: Option<i32>,
            last: Option<i32>,
            before: Option<String>,
            after: Option<String>,
        ) -> async_graphql::Result<Connection<u64, HistoricalUpdate>> {
            EventQuery::new("history.fractals.updated")
                .first(first)
                .last(last)
                .before(before)
                .after(after)
                .query()
        }

        async fn evaluation_finishes(
            &self,
            fractal: AccountNumber,
        ) -> async_graphql::Result<Connection<u64, EvaluationFinish>> {
            EventQuery::new("history.fractals.evaluation_finished")
                .condition(format!("fractal_account = '{}'", fractal))
                .query()
        }

        async fn fractal(&self, fractal: String) -> Option<Fractal> {
            FractalTable::with_service(fractals::SERVICE)
                .get_index_pk()
                .get(&AccountNumber::from(fractal.as_str()))
        }

        async fn evaluations(&self, fractal: String) -> Vec<EvaluationInstance> {
            let fractal = AccountNumber::from_str(&fractal).expect("invalid account name");
            EvaluationInstanceTable::with_service(fractals::SERVICE)
                .get_index_pk()
                .range((fractal, 0)..=(fractal, u32::MAX))
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

        async fn member(&self, fractal: AccountNumber, member: AccountNumber) -> Option<Member> {
            MemberTable::with_service(fractals::SERVICE)
                .get_index_pk()
                .get(&(fractal, member))
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
        // Services graphql queries
        None.or_else(|| serve_graphql(&request, Query))
            // Serves a GraphiQL UI interface at the /graphiql endpoint
            .or_else(|| serve_graphiql(&request))
    }
}
