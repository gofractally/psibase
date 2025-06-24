#[psibase::service]
#[allow(non_snake_case)]
mod service {

    use std::u32;

    use async_graphql::{connection::Connection, *};
    use psibase::services::nft::Wrapper as Nfts;
    use psibase::*;
    use psibase::{AccountNumber, Asset};
    use serde::Deserialize;
    use tokens::tables::tables::{
        Balance, BalanceTable, SharedBalance, SharedBalanceTable, Token, TokenTable,
    };

    struct Query;

    #[derive(Deserialize, SimpleObject)]
    pub struct BalanceInstance {
        pub account: AccountNumber,
        pub token_id: u32,
        pub balance: Asset,
    }

    #[Object]
    impl Query {
        async fn token(&self, token_id: u32) -> Option<Token> {
            TokenTable::with_service(tokens::SERVICE)
                .get_index_pk()
                .get(&token_id)
        }

        async fn user_credits(
            &self,
            user: AccountNumber,
            first: Option<i32>,
            last: Option<i32>,
            before: Option<String>,
            after: Option<String>,
        ) -> async_graphql::Result<Connection<RawKey, SharedBalance>> {
            TableQuery::subindex::<(AccountNumber, u32)>(
                SharedBalanceTable::with_service(tokens::SERVICE).get_index_by_creditor(),
                &(user),
            )
            .first(first)
            .last(last)
            .before(before)
            .after(after)
            .query()
            .await
        }

        async fn user_debits(
            &self,
            user: AccountNumber,
            first: Option<i32>,
            last: Option<i32>,
            before: Option<String>,
            after: Option<String>,
        ) -> async_graphql::Result<Connection<RawKey, SharedBalance>> {
            TableQuery::subindex::<(AccountNumber, u32)>(
                SharedBalanceTable::with_service(tokens::SERVICE).get_index_by_debitor(),
                &(user),
            )
            .first(first)
            .last(last)
            .before(before)
            .after(after)
            .query()
            .await
        }

        async fn user_tokens(&self, user: AccountNumber) -> Vec<Token> {
            let tokens: Vec<Token> = TokenTable::with_service(tokens::SERVICE)
                .get_index_pk()
                .range(0..=(u32::MAX))
                .collect();

            tokens
                .into_iter()
                .filter(|token| {
                    let nft = Nfts::call_from(Wrapper::SERVICE).getNft(token.nft_id);
                    nft.owner == user
                })
                .collect()
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
