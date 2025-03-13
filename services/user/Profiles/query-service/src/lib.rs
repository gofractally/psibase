#[psibase::service]
#[allow(non_snake_case)]
mod service {
    use async_graphql::*;
    use psibase::*;
    use serde::Deserialize;
    use profiles::tables::Profile;

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
            profiles::Wrapper::call().getExampleThing()
        }

        /// This query gets the historical updates of the Example Thing.
        async fn historical_updates(&self) -> Vec<HistoricalUpdate> {
            let json_str = services::r_events::Wrapper::call()
                .sqlQuery("SELECT * FROM \"history.profiles.updated\" ORDER BY ROWID".to_string());
            serde_json::from_str(&json_str).unwrap_or_default()
        }

        async fn profile(&self, account: AccountNumber) -> Option<Profile> {
            profiles::Wrapper::call().getProfile(account)
        }
    }

    #[action]
    #[allow(non_snake_case)]
    fn serveSys(request: HttpRequest) -> Option<HttpReply> {
            // Services graphql queries
        None.or_else(|| serve_graphql(&request, Query))

            // Serves a GraphiQL UI interface at the /graphiql endpoint
            .or_else(|| serve_graphiql(&request))

            // Serves a full service schema at the /schema endpoint
            .or_else(|| serve_schema::<profiles::Wrapper>(&request))
    }
}
