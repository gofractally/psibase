mod events;

#[psibase::service]
#[allow(non_snake_case)]
mod service {

    use async_graphql::{connection::Connection, *};
    use psibase::services::{nft::Wrapper as Nfts, tokens::TID};

    use psibase::*;
    use tokens::{
        helpers::{identify_token_type, TokenType},
        tables::tables::{
            Balance, BalanceTable, SharedBalance, SharedBalanceTable, Token, TokenTable,
            UserConfig, UserConfigTable,
        },
    };

    use crate::events::{
        BurnedEvent, CreatedEvent, CreditedEvent, DebitedEvent, MintedEvent, RecalledEvent,
        RejectedEvent, UncreditedEvent,
    };

    pub fn token_id_to_number(token_id: String) -> u32 {
        match identify_token_type(token_id) {
            TokenType::Number(num) => num,
            TokenType::Symbol(account) => {
                Token::get_by_symbol(account)
                    .expect("token by symbol not found")
                    .id
            }
        }
    }

    struct Query;

    #[Object]
    impl Query {
        async fn token(&self, token_id: String) -> Option<Token> {
            TokenTable::with_service(tokens::SERVICE)
                .get_index_pk()
                .get(&token_id_to_number(token_id))
        }

        async fn user_settings(&self, user: AccountNumber) -> UserConfig {
            UserConfigTable::with_service(tokens::SERVICE)
                .get_index_pk()
                .get(&user)
                .unwrap_or(UserConfig {
                    account: user,
                    flags: 0,
                })
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
                SharedBalanceTable::with_service(tokens::SERVICE).get_index_pk(),
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

        async fn user_balances(
            &self,
            user: AccountNumber,
            first: Option<i32>,
            last: Option<i32>,
            before: Option<String>,
            after: Option<String>,
        ) -> async_graphql::Result<Connection<RawKey, Balance>> {
            TableQuery::subindex::<u32>(
                BalanceTable::with_service(tokens::SERVICE).get_index_pk(),
                &(user),
            )
            .first(first)
            .last(last)
            .before(before)
            .after(after)
            .query()
            .await
        }

        async fn user_balance(&self, user: AccountNumber, token_id: String) -> Balance {
            let token_id = token_id_to_number(token_id);

            BalanceTable::with_service(tokens::SERVICE)
                .get_index_pk()
                .get(&(user, token_id))
                .unwrap_or(Balance {
                    account: user,
                    balance: 0.into(),
                    token_id,
                })
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

        async fn creditedEvents(
            &self,
            token_id: TID,
            creditor: AccountNumber,
            first: Option<i32>,
            last: Option<i32>,
            before: Option<String>,
            after: Option<String>,
        ) -> async_graphql::Result<Connection<u64, CreditedEvent>> {
            EventQuery::new("history.tokens.credited")
                .condition(format!(
                    "token_id = {} AND creditor = '{}'",
                    token_id, creditor
                ))
                .first(first)
                .last(last)
                .before(before)
                .after(after)
                .query()
        }

        async fn debitedEvents(
            &self,
            token_id: TID,
            debitor: AccountNumber,
            first: Option<i32>,
            last: Option<i32>,
            before: Option<String>,
            after: Option<String>,
        ) -> async_graphql::Result<Connection<u64, DebitedEvent>> {
            EventQuery::new("history.tokens.debited")
                .condition(format!(
                    "token_id = {} AND debitor = '{}'",
                    token_id, debitor
                ))
                .first(first)
                .last(last)
                .before(before)
                .after(after)
                .query()
        }

        async fn uncreditedEvents(
            &self,
            token_id: TID,
            creditor: AccountNumber,
            first: Option<i32>,
            last: Option<i32>,
            before: Option<String>,
            after: Option<String>,
        ) -> async_graphql::Result<Connection<u64, UncreditedEvent>> {
            EventQuery::new("history.tokens.uncredited")
                .condition(format!(
                    "token_id = {} AND creditor = '{}'",
                    token_id, creditor
                ))
                .first(first)
                .last(last)
                .before(before)
                .after(after)
                .query()
        }

        async fn rejectedEvents(
            &self,
            token_id: TID,
            debitor: AccountNumber,
            first: Option<i32>,
            last: Option<i32>,
            before: Option<String>,
            after: Option<String>,
        ) -> async_graphql::Result<Connection<u64, RejectedEvent>> {
            EventQuery::new("history.tokens.rejected")
                .condition(format!(
                    "token_id = {} AND debitor = '{}'",
                    token_id, debitor
                ))
                .first(first)
                .last(last)
                .before(before)
                .after(after)
                .query()
        }

        async fn recalledEvents(
            &self,
            token_id: TID,
            from: AccountNumber,
            first: Option<i32>,
            last: Option<i32>,
            before: Option<String>,
            after: Option<String>,
        ) -> async_graphql::Result<Connection<u64, RecalledEvent>> {
            EventQuery::new("history.tokens.recalled")
                .condition(format!("token_id = {} AND from = '{}'", token_id, from))
                .first(first)
                .last(last)
                .before(before)
                .after(after)
                .query()
        }

        async fn burnedEvents(
            &self,
            token_id: TID,
            sender: AccountNumber,
            first: Option<i32>,
            last: Option<i32>,
            before: Option<String>,
            after: Option<String>,
        ) -> async_graphql::Result<Connection<u64, BurnedEvent>> {
            EventQuery::new("history.tokens.burned")
                .condition(format!("token_id = {} AND sender = '{}'", token_id, sender))
                .first(first)
                .last(last)
                .before(before)
                .after(after)
                .query()
        }

        async fn mintedEvents(
            &self,
            token_id: TID,
            first: Option<i32>,
            last: Option<i32>,
            before: Option<String>,
            after: Option<String>,
        ) -> async_graphql::Result<Connection<u64, MintedEvent>> {
            EventQuery::new("history.tokens.minted")
                .condition(format!("token_id = {}", token_id))
                .first(first)
                .last(last)
                .before(before)
                .after(after)
                .query()
        }

        async fn createdEvents(
            &self,
            token_id: TID,
            sender: AccountNumber,
            first: Option<i32>,
            last: Option<i32>,
            before: Option<String>,
            after: Option<String>,
        ) -> async_graphql::Result<Connection<u64, CreatedEvent>> {
            EventQuery::new("history.tokens.created")
                .condition(format!("token_id = {} AND sender = '{}'", token_id, sender))
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
