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

    use crate::events::{BalanceEvent, ConfigureEvent, SupplyEvent};

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
        /// Given a token id, return a record that represents token 
        /// configuration, ownership, and supply details.
        async fn token(&self, token_id: String) -> Option<Token> {
            TokenTable::with_service(tokens::SERVICE)
                .get_index_pk()
                .get(&token_id_to_number(token_id))
        }

        /// Given a user account, return a record that represents the user's 
        /// configuration within the token service.
        async fn user_settings(&self, user: AccountNumber) -> UserConfig {
            UserConfigTable::with_service(tokens::SERVICE)
                .get_index_pk()
                .get(&user)
                .unwrap_or(UserConfig {
                    account: user,
                    flags: 0,
                })
        }

        /// Given a user account, return a list of records that represent the
        /// user's current pending outgoing credits. These are tokens that have
        /// yet to be claimed (debited) by the receiver.
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
                &user,
            )
            .first(first)
            .last(last)
            .before(before)
            .after(after)
            .query()
            .await
        }

        /// Given a user account, return a list of records that represent the
        /// user's current pending incoming debits. These are tokens that were 
        /// credited to the user but have yet to be debited (claimed).
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

        /// Returns the specified user's current balances for all of their tokens.
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

        /// Returns the specified user's current balance for the specified token.
        async fn user_balance(&self, user: AccountNumber, token_id: String) -> async_graphql::Result<Balance> {
            let token_id = token_id_to_number(token_id);

            Ok(BalanceTable::with_service(tokens::SERVICE)
                .get_index_pk()
                .get(&(user, token_id))
                .unwrap_or(Balance {
                    account: user,
                    balance: 0.into(),
                    token_id,
                })
            )
        }

        /// Returns a list of all tokens for which the specified user is the owner/issuer.
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

        /// Returns a paginated subset of all historical events (that haven't yet been pruned
        /// from this node) related to changes to the configuration of the specified token. 
        async fn configurations(
            &self,
            token_id: TID,
            first: Option<i32>,
            last: Option<i32>,
            before: Option<String>,
            after: Option<String>,
        ) -> async_graphql::Result<Connection<u64, ConfigureEvent>> {
            EventQuery::new("history.tokens.configured")
                .condition(format!("token_id = {}", token_id))
                .first(first)
                .last(last)
                .before(before)
                .after(after)
                .query()
        }

        /// Returns a paginated subset of all historical events (that haven't yet been pruned
        /// from this node) related to changes to the supply of the specified token.
        /// Changes in supply happen when tokens are minted, burned, or recalled.
        async fn supplyChanges(
            &self,
            token_id: TID,
            first: Option<i32>,
            last: Option<i32>,
            before: Option<String>,
            after: Option<String>,
        ) -> async_graphql::Result<Connection<u64, SupplyEvent>> {
            EventQuery::new("history.tokens.supplyChanged")
                .condition(format!("token_id = {}", token_id))
                .first(first)
                .last(last)
                .before(before)
                .after(after)
                .query()
        }

        /// Returns a paginated subset of all historical events (that haven't yet been pruned
        /// from this node) related to changes to the balances of the specified token for the 
        /// specified user.
        /// Changes in the balance of at least one user happen when tokens are recalled, burned, 
        /// credited, debited, uncredited, rejected.
        async fn balChanges(
            &self,
            token_id: TID,
            account: AccountNumber,
            counter_parties: Option<Vec<String>>,
            excluded_counter_parties: Option<Vec<String>>,
            action: Option<String>,
            amount_min: Option<String>,
            amount_max: Option<String>,
            memo: Option<String>,
            first: Option<i32>,
            last: Option<i32>,
            before: Option<String>,
            after: Option<String>,
        ) -> async_graphql::Result<Connection<u64, BalanceEvent>> {
            let mut conditions = vec![
                format!("token_id = {}", token_id),
                format!("account = '{}'", account),
            ];

            if let Some(cps) = &counter_parties {
                if !cps.is_empty() {
                    let cp_conditions: Vec<String> = cps
                        .iter()
                        .map(|cp| format!("counter_party LIKE '%{}%'", cp))
                        .collect();
                    conditions.push(format!("({})", cp_conditions.join(" OR ")));
                }
            }

            if let Some(excluded_cps) = &excluded_counter_parties {
                if !excluded_cps.is_empty() {
                    let excluded_conditions: Vec<String> = excluded_cps
                        .iter()
                        .map(|cp| format!("counter_party NOT LIKE '%{}%'", cp))
                        .collect();
                    conditions.push(format!("({})", excluded_conditions.join(" AND ")));
                }
            }

            if let Some(act) = &action {
                conditions.push(format!("action = '{}'", act));
            }

            if let Some(min) = &amount_min {
                conditions.push(format!("amount >= '{}'", min));
            }

            if let Some(max) = &amount_max {
                conditions.push(format!("amount <= '{}'", max));
            }

            if let Some(m) = &memo {
                conditions.push(format!("memo LIKE '%{}%'", m));
            }

            EventQuery::new("history.tokens.balChanged")
                .condition(conditions.join(" AND "))
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
