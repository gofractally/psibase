#[psibase::service]
#[allow(non_snake_case)]
mod service {

    use std::u32;

    use async_graphql::{connection::Connection, *};
    use psibase::services::{accounts::Account, nft::Wrapper as Nfts};
    use psibase::Asset;
    use psibase::*;
    use serde::Deserialize;
    use tokens::tables::tables::{Balance, BalanceTable, Token, TokenTable};

    #[derive(Deserialize, SimpleObject)]
    struct HistoricalUpdate {
        old_thing: String,
        new_thing: String,
    }

    struct Query;

    #[derive(SimpleObject)]
    struct TokenDetail {
        pub id: u32,
        pub nft_id: u32,
        pub precision: u8,
        pub current_supply: Asset,
        pub max_supply: Asset,
        pub owner: AccountNumber,
        pub symbol: Option<AccountNumber>,
    }

    #[derive(Deserialize, SimpleObject)]
    pub struct BalanceInstance {
        pub account: AccountNumber,
        pub token_id: u32,
        pub balance: Asset,
    }

    impl TokenDetail {
        fn from_token(token: Token, owner: AccountNumber) -> TokenDetail {
            TokenDetail {
                owner,
                id: token.id,
                nft_id: token.nft_id,
                precision: token.precision,
                current_supply: token.current_supply.to_asset(token.precision.into()),
                max_supply: token.max_supply.to_asset(token.precision.into()),
                symbol: token.symbol,
            }
        }
    }

    #[Object]
    impl Query {
        async fn token(&self, token_id: u32) -> Option<TokenDetail> {
            let token = TokenTable::with_service(tokens::SERVICE)
                .get_index_pk()
                .get(&token_id)?;

            Some(TokenDetail::from_token(
                token,
                Nfts::call().getNft(token_id).owner,
            ))
        }

        async fn user_balances(&self, user: AccountNumber) -> Vec<BalanceInstance> {
            let token_balances: Vec<Balance> = BalanceTable::with_service(tokens::SERVICE)
                .get_index_pk()
                .range((user, 0)..=(user, u32::MAX))
                .collect();

            let tokens: Vec<Token> = token_balances
                .iter()
                .map(|balance| {
                    TokenTable::with_service(tokens::SERVICE)
                        .get_index_pk()
                        .get(&balance.token_id)
                        .expect("faled to find token")
                })
                .collect();

            token_balances
                .into_iter()
                .map(|token_balance| {
                    let precision = tokens
                        .iter()
                        .find_map(|token| {
                            if token.id == token_balance.token_id {
                                Some(token.precision)
                            } else {
                                None
                            }
                        })
                        .expect("failed to find precision");

                    BalanceInstance {
                        account: token_balance.account,
                        balance: token_balance.balance.to_asset(precision.into()),
                        token_id: token_balance.token_id,
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
            EventQuery::new("history.tokens.updated")
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
