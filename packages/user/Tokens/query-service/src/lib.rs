mod events;

#[psibase::service]
#[allow(non_snake_case)]
mod service {

    use async_graphql::{connection::Connection, *};
    use psibase::services::{nft::Wrapper as Nfts, tokens::TID};

    use psibase::*;
    use tokens::tables::tables::{UserPendingRecord, UserPendingTable};
    use tokens::{
        helpers::{identify_token_type, to_fixed, TokenType},
        tables::tables::{
            Balance, BalanceTable, ConfigRow, ConfigTable, SubAccount, SubAccountBalance,
            SubAccountBalanceTable, SubAccountTable, Token, TokenTable, UserConfig,
            UserConfigTable,
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

    struct Query {
        user: Option<AccountNumber>,
    }

    impl Query {
        fn check_user_auth(&self, user: AccountNumber) -> async_graphql::Result<()> {
            if self.user != Some(user) {
                return Err(async_graphql::Error::new(format!(
                    "permission denied: '{}' must authorize your app to make this query. Send it through `tokens:plugin/authorized::graphql`.",
                    user
                )));
            }
            Ok(())
        }

        fn get_subaccount(
            &self,
            user: AccountNumber,
            sub_account: &str,
        ) -> async_graphql::Result<SubAccount> {
            SubAccountTable::with_service(tokens::SERVICE)
                .get_index_pk()
                .get(&(user, sub_account.to_string()))
                .ok_or_else(|| {
                    async_graphql::Error::new(format!(
                        "Sub-account '{}' not found for user '{}'",
                        sub_account, user
                    ))
                })
        }
    }

    #[Object]
    impl Query {
        /// Returns the token service global configuration
        async fn config(&self) -> Option<ConfigRow> {
            ConfigTable::with_service(tokens::SERVICE)
                .get_index_pk()
                .get(&())
        }

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
        /// user's current pending transfers, including both debits and credits.
        async fn user_pending(
            &self,
            user: AccountNumber,
            token_id: Option<TID>,
            first: Option<i32>,
            last: Option<i32>,
            before: Option<String>,
            after: Option<String>,
        ) -> async_graphql::Result<Connection<RawKey, UserPendingRecord>> {
            self.check_user_auth(user)?;

            if token_id.is_some() {
                TableQuery::subindex::<u64>(
                    UserPendingTable::with_service(tokens::SERVICE).get_index_pk(),
                    &(user, token_id.unwrap()),
                )
                .first(first)
                .last(last)
                .before(before)
                .after(after)
                .query()
                .await
            } else {
                TableQuery::subindex::<(TID, u64)>(
                    UserPendingTable::with_service(tokens::SERVICE).get_index_pk(),
                    &(user),
                )
                .first(first)
                .last(last)
                .before(before)
                .after(after)
                .query()
                .await
            }
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
            self.check_user_auth(user)?;

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
        async fn user_balance(
            &self,
            user: AccountNumber,
            token_id: String,
        ) -> async_graphql::Result<Balance> {
            let token_id = token_id_to_number(token_id);

            self.check_user_auth(user)?;

            Ok(BalanceTable::with_service(tokens::SERVICE)
                .get_index_pk()
                .get(&(user, token_id))
                .unwrap_or(Balance {
                    account: user,
                    balance: 0.into(),
                    token_id,
                }))
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

        /// Returns the specified user's sub-accounts.
        async fn user_subaccounts(
            &self,
            user: AccountNumber,
            first: Option<i32>,
            last: Option<i32>,
            before: Option<String>,
            after: Option<String>,
        ) -> async_graphql::Result<Connection<RawKey, SubAccount>> {
            self.check_user_auth(user)?;

            TableQuery::subindex::<String>(
                SubAccountTable::with_service(tokens::SERVICE).get_index_pk(),
                &(user),
            )
            .first(first)
            .last(last)
            .before(before)
            .after(after)
            .query()
            .await
        }

        /// Returns the token balance for a specific sub-account and token.
        async fn subaccount_balance(
            &self,
            user: AccountNumber,
            sub_account: String,
            token_id: TID,
        ) -> async_graphql::Result<SubAccountBalance> {
            self.check_user_auth(user)?;

            let subaccount = self.get_subaccount(user, &sub_account)?;

            Ok(SubAccountBalanceTable::with_service(tokens::SERVICE)
                .get_index_pk()
                .get(&(subaccount.id, token_id))
                .unwrap_or(SubAccountBalance {
                    subaccount_id: subaccount.id,
                    token_id,
                    balance: 0.into(),
                }))
        }

        /// Returns a paginated list of all token balances for the specified sub-account.
        async fn subaccount_balances(
            &self,
            user: AccountNumber,
            sub_account: String,
            first: Option<i32>,
            last: Option<i32>,
            before: Option<String>,
            after: Option<String>,
        ) -> async_graphql::Result<Connection<RawKey, SubAccountBalance>> {
            self.check_user_auth(user)?;

            let subaccount = self.get_subaccount(user, &sub_account)?;

            TableQuery::subindex::<TID>(
                SubAccountBalanceTable::with_service(tokens::SERVICE).get_index_pk(),
                &(subaccount.id),
            )
            .first(first)
            .last(last)
            .before(before)
            .after(after)
            .query()
            .await
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
            self.check_user_auth(account)?;

            let precision = TokenTable::with_service(tokens::SERVICE)
                .get_index_pk()
                .get(&token_id)
                .ok_or_else(|| {
                    async_graphql::Error::new(format!("token '{}' not found", token_id))
                })?
                .precision
                .value();

            // Create fixed-precision string versions of the specified amount bounds
            let min_fixed = amount_min.as_deref().map(|s| to_fixed(s, precision));
            let max_fixed = amount_max.as_deref().map(|s| to_fixed(s, precision));

            let mut conditions = vec![format!("token_id = {}", token_id)];
            let mut params = Vec::new();

            conditions.push("account = ?".to_string());
            params.push(account.to_string());

            if let Some(cps) = &counter_parties {
                if !cps.is_empty() {
                    let cp_conditions: Vec<String> = (0..cps.len())
                        .map(|_| "counter_party LIKE ?".to_string())
                        .collect();
                    conditions.push(format!("({})", cp_conditions.join(" OR ")));
                    for cp in cps {
                        params.push(format!("%{}%", cp));
                    }
                }
            }

            if let Some(excluded_cps) = &excluded_counter_parties {
                if !excluded_cps.is_empty() {
                    let excluded_conditions: Vec<String> = (0..excluded_cps.len())
                        .map(|_| "counter_party NOT LIKE ?".to_string())
                        .collect();
                    conditions.push(format!("{}", excluded_conditions.join(" AND ")));
                    for cp in excluded_cps {
                        params.push(format!("%{}%", cp));
                    }
                }
            }

            if let Some(act) = &action {
                conditions.push("action = ?".to_string());
                params.push(act.clone());
            }

            if let Some(min) = &min_fixed {
                conditions.push(
                    "(length(amount) > length(?) OR (length(amount) = length(?) AND amount >= ?))"
                        .to_string(),
                );
                params.push(min.clone());
                params.push(min.clone());
                params.push(min.clone());
            }

            if let Some(max) = &max_fixed {
                conditions.push(
                    "(length(amount) < length(?) OR (length(amount) = length(?) AND amount <= ?))"
                        .to_string(),
                );
                params.push(max.clone());
                params.push(max.clone());
                params.push(max.clone());
            }

            if let Some(m) = &memo {
                conditions.push("memo LIKE ?".to_string());
                params.push(format!("%{}%", m));
            }

            EventQuery::new("history.tokens.balChanged")
                .condition_with_params(conditions.join(" AND "), params)
                .first(first)
                .last(last)
                .before(before)
                .after(after)
                .query()
        }
    }

    #[action]
    #[allow(non_snake_case)]
    fn serveSys(
        request: HttpRequest,
        _socket: Option<i32>,
        user: Option<AccountNumber>,
    ) -> Option<HttpReply> {
        check(
            get_sender() == AccountNumber::from("http-server"),
            "permission denied: tokens::serveSys only callable by 'http-server'",
        );

        // Services graphql queries
        None.or_else(|| serve_graphql(&request, Query { user }))
            // Serves a GraphiQL UI interface at the /graphiql endpoint
            .or_else(|| serve_graphiql(&request))
    }
}
