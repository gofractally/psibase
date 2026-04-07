#[psibase::service]
#[allow(non_snake_case)]
mod service {
    use async_graphql::connection::Connection;
    use async_graphql::*;
    use diff_adjust::tables::RateLimitTable;
    use prem_accounts::tables::{AuctionsTable, PurchasedAccountsTable};
    use psibase::services::tokens::{Decimal, Quantity, Wrapper as TokensWrapper};
    use psibase::*;
    use serde::Deserialize;
    use serde_aux::field_attributes::deserialize_number_from_string;

    #[derive(SimpleObject)]
    struct MarketParams {
        length: u8,
        enabled: bool,
        target: u32,
        #[graphql(name = "initialPrice")]
        initial_price: Decimal,
        #[graphql(name = "floorPrice")]
        floor_price: Decimal,
        #[graphql(name = "windowSeconds")]
        window_seconds: u32,
        #[graphql(name = "increasePpm")]
        increase_ppm: u32,
        #[graphql(name = "decreasePpm")]
        decrease_ppm: u32,
    }

    #[derive(SimpleObject)]
    struct MarketPrice {
        length: u8,
        price: Decimal,
    }

    #[derive(Deserialize, SimpleObject)]
    #[graphql(complex)]
    struct PremiumAccountEvent {
        owner: AccountNumber,
        account: AccountNumber,
        #[serde(deserialize_with = "deserialize_number_from_string")]
        #[graphql(skip)]
        action: u8,
    }

    #[ComplexObject]
    impl PremiumAccountEvent {
        pub async fn action(&self) -> String {
            match self.action {
                prem_accounts::service::BOUGHT => "bought".to_string(),
                prem_accounts::service::CLAIMED => "claimed".to_string(),
                _ => "unknown".to_string(),
            }
        }

        pub async fn length(&self) -> u8 {
            self.account.to_string().len() as u8
        }
    }

    struct Query {
        user: Option<AccountNumber>,
    }

    fn query_name_events(
        q: &Query,
        owner: AccountNumber,
        first: Option<i32>,
        last: Option<i32>,
        before: Option<String>,
        after: Option<String>,
    ) -> async_graphql::Result<Connection<u64, PremiumAccountEvent>> {
        q.check_user_auth(owner.clone())?;

        EventQuery::new(format!("history.{}.premAcctEvent", Wrapper::SERVICE))
            .condition(format!("owner = '{}'", owner))
            .first(first)
            .last(last)
            .before(before)
            .after(after)
            .query()
    }

    impl Query {
        fn check_user_auth(&self, user: AccountNumber) -> async_graphql::Result<()> {
            if self.user != Some(user) {
                return Err(async_graphql::Error::new(format!(
                    "permission denied: '{}' must authorize this query.",
                    user
                )));
            }
            Ok(())
        }

        fn require_authenticated(&self) -> async_graphql::Result<AccountNumber> {
            if self.user.is_none() {
                return Err(async_graphql::Error::new(
                    "permission denied: an authorized session is required for this query.",
                ));
            }
            Ok(self.user.unwrap().clone())
        }
    }

    #[Object]
    impl Query {
        /// Current prices for each configured market (sparse list)
        /// If no system token configured, returns empty list
        async fn current_prices(&self) -> Vec<MarketPrice> {
            let Some(token) = TokensWrapper::call().getSysToken() else {
                return vec![];
            };
            let precision = token.precision;
            let auctions_table = AuctionsTable::read();
            let rate_table = RateLimitTable::read();
            let mut rows: Vec<MarketPrice> = auctions_table
                .get_index_pk()
                .iter()
                .map(|auction| {
                    let mut price_raw = rate_table
                        .get_index_pk()
                        .get(&auction.nft_id)
                        .map(|mut rate_limit| rate_limit.check_difficulty_decrease())
                        .unwrap_or(0);
                    // DiffAdjust can read 0 before the rate row is populated or in edge cases
                    if auction.enabled && price_raw == 0 && auction.initial_price > 0 {
                        price_raw = auction.initial_price;
                    }
                    MarketPrice {
                        length: auction.length,
                        price: Decimal::new(Quantity::from(price_raw), precision),
                    }
                })
                .collect();
            rows.sort_by_key(|r| r.length);
            rows
        }

        /// All configured premium name markets (sparse list): status plus pricing parameters.
        async fn market_params(&self) -> Vec<MarketParams> {
            let Some(token) = TokensWrapper::call().getSysToken() else {
                return vec![];
            };
            let precision = token.precision;
            let auctions_table = AuctionsTable::read();
            let rows: Vec<MarketParams> = auctions_table
                .get_index_pk()
                .iter()
                .map(|a| MarketParams {
                    length: a.length,
                    enabled: a.enabled,
                    target: a.target,
                    initial_price: Decimal::new(Quantity::from(a.initial_price), precision),
                    floor_price: Decimal::new(Quantity::from(a.floor_price), precision),
                    window_seconds: a.window_seconds,
                    increase_ppm: a.increase_ppm,
                    decrease_ppm: a.decrease_ppm,
                })
                .collect();
            rows
        }

        /// Bought-but-unclaimed account names for the user
        async fn unclaimed_names(&self) -> async_graphql::Result<Vec<String>> {
            let user = self.require_authenticated()?;

            let purchased_table = PurchasedAccountsTable::read();
            let mut names: Vec<String> = purchased_table
                .get_index_pk()
                .iter()
                .filter(|record| record.owner == user)
                .map(|record| record.account.to_string())
                .collect();
            names.sort();
            Ok(names)
        }

        /// Events: premium **name** history for `owner`
        async fn name_events(
            &self,
            owner: AccountNumber,
            first: Option<i32>,
            last: Option<i32>,
            before: Option<String>,
            after: Option<String>,
        ) -> async_graphql::Result<Connection<u64, PremiumAccountEvent>> {
            self.require_authenticated()?;
            query_name_events(self, owner, first, last, before, after)
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
            "permission denied: serveSys only callable by 'http-server'",
        );

        None.or_else(|| serve_graphql(&request, Query { user }))
            .or_else(|| serve_graphiql(&request))
    }
}
