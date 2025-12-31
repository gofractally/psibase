#[psibase::service]
#[allow(non_snake_case)]
mod service {
    use async_graphql::{connection::Connection, *};
    use psibase::{
        services::{
            nft::NID,
            tokens::{self, Decimal, Quantity, TID},
        },
        *,
    };
    use serde::{Deserialize, Serialize};
    use token_swap::tables::{Pool, PoolTable};

    #[derive(Deserialize, SimpleObject)]
    struct HistoricalUpdate {
        old_thing: String,
        new_thing: String,
    }

    #[derive(Serialize, Deserialize, SimpleObject, ToSchema, Fracpack, Debug)]
    pub struct PoolItem {
        pub id: u32,
        pub liquidity_token: TID,
        pub token_a: TID,
        pub token_a_tariff_ppm: u32,
        pub token_a_admin: NID,
        pub token_b: TID,
        pub token_b_tariff_ppm: u32,
        pub token_b_admin: NID,
        pub token_a_balance: String,
        pub token_b_balance: String,
    }

    struct Query;

    #[Object]
    impl Query {
        async fn all_pools(
            &self,
            first: Option<i32>,
            last: Option<i32>,
            before: Option<String>,
            after: Option<String>,
        ) -> Vec<PoolItem> {
            let pools: Vec<_> = PoolTable::with_service(token_swap::SERVICE)
                .get_index_pk()
                .range(0..=(u32::MAX))
                .collect();

            pools
                .into_iter()
                .map(|pool| {
                    let (amount_a, amount_b) =
                        psibase::services::token_swap::Wrapper::call().get_reserves(pool.id);

                    PoolItem {
                        id: pool.id,
                        liquidity_token: pool.liquidity_token,
                        token_a: pool.token_a,
                        token_a_admin: pool.token_a_admin,
                        token_a_balance: Decimal::new(
                            amount_a,
                            tokens::Wrapper::call().getToken(pool.token_a).precision,
                        )
                        .to_string(),
                        token_a_tariff_ppm: pool.token_a_tariff_ppm,
                        token_b: pool.token_b,
                        token_b_admin: pool.token_b_admin,
                        token_b_balance: Decimal::new(
                            amount_b,
                            tokens::Wrapper::call().getToken(pool.token_b).precision,
                        )
                        .to_string(),
                        token_b_tariff_ppm: pool.token_b_tariff_ppm,
                    }
                })
                .collect()
        }

        /// This query gets paginated historical updates of the Example Thing.
        async fn historical_updates(
            &self,
            first: Option<i32>,
            last: Option<i32>,
            before: Option<String>,
            after: Option<String>,
        ) -> async_graphql::Result<Connection<u64, HistoricalUpdate>> {
            EventQuery::new("history.token-swap.updated")
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
