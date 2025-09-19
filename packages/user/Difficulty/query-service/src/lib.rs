#[psibase::service]
#[allow(non_snake_case)]
mod service {
    use async_graphql::connection::{Connection};
    use async_graphql::*;
    use difficulty::tables::{Difficulty, DifficultyTable};
    use psibase::*;
    use serde::Deserialize;
    use serde_aux::field_attributes::deserialize_number_from_string;

    #[derive(Deserialize, SimpleObject)]
    struct DifficultyCreated {
        #[serde(deserialize_with = "deserialize_number_from_string")]
        nft_id: u32,
        actor: AccountNumber,
    }

    struct Query;

    #[Object]
    impl Query {
        async fn difficulty(&self, nft_id: u32) -> Option<Difficulty> {
            DifficultyTable::new()
                .get_index_pk()
                .get(&nft_id)
                .map(|mut difficulty| {
                    difficulty.check_price_decrease();
                    difficulty
                })
        }

        async fn created(
            &self,
            first: Option<i32>,
            last: Option<i32>,
            before: Option<String>,
            after: Option<String>,
        ) -> async_graphql::Result<Connection<u64, DifficultyCreated>> {
            EventQuery::new("history.difficulty.created")
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
