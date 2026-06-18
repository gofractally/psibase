#[psibase::service(name = "namemarket+1")]
#[allow(non_snake_case)]
mod service {
    use async_graphql::{connection::Connection, *};
    use name_market::tables::{AuctionsTable, PurchasedAccount, PurchasedAccountsTable};
    use name_market::Wrapper as NameMarketService;
    use psibase::services::diff_adjust::{RateLimitTable, Wrapper as DiffAdjust};
    use psibase::services::tokens::{Decimal, Quantity, Wrapper as TokensWrapper};
    use psibase::*;
    use serde::Deserialize;
    use serde_aux::field_attributes::deserialize_number_from_string;

    #[derive(SimpleObject)]
    struct MarketParams {
        length: u8,
        enabled: bool,
        #[graphql(name = "initialPrice")]
        initial_price: String,
        target: u32,
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
                name_market::service::BOUGHT => "bought".to_string(),
                name_market::service::CLAIMED => "claimed".to_string(),
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

    impl Query {
        fn require_authenticated(&self) -> async_graphql::Result<AccountNumber> {
            self.user.ok_or_else(|| {
                async_graphql::Error::new(
                    "permission denied: an authorized session is required for this query.",
                )
            })?;

            Ok(self.user.unwrap().clone())
        }
    }

    #[Object]
    impl Query {
        /// Current prices for each configured and enabled market (sparse list)
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
                .filter(|auction| auction.enabled)
                .map(|auction| {
                    // Delegate effective difficulty to DiffAdjust (same as `get_diff` action).
                    let mut price_raw = DiffAdjust::call().get_diff(auction.nft_id);
                    // Defensive: in edge cases active can read 0; fall back to stored floor.
                    if price_raw == 0 {
                        price_raw = rate_table
                            .get_index_pk()
                            .get(&auction.nft_id)
                            .map(|r| r.floor_difficulty)
                            .unwrap_or(0);
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
            let rate_table = RateLimitTable::read();
            let rows: Vec<MarketParams> = auctions_table
                .get_index_pk()
                .iter()
                .filter_map(|auction| {
                    let rate_limit = rate_table.get_index_pk().get(&auction.nft_id)?;
                    Some(MarketParams {
                        length: auction.length,
                        enabled: auction.enabled,
                        initial_price: Decimal::new(auction.initial_price, precision).to_string(),
                        target: rate_limit.target_min, // target_min == target_max in our usage
                        floor_price: Decimal::new(
                            Quantity::from(rate_limit.floor_difficulty),
                            precision,
                        ),
                        window_seconds: rate_limit.window_seconds,
                        increase_ppm: rate_limit.increase_ppm,
                        decrease_ppm: rate_limit.decrease_ppm,
                    })
                })
                .collect();
            rows
        }

        /// Bought-but-unclaimed account records for the authenticated user
        async fn unclaimed_names(
            &self,
            first: Option<i32>,
            last: Option<i32>,
            before: Option<String>,
            after: Option<String>,
        ) -> async_graphql::Result<Connection<RawKey, PurchasedAccount>> {
            let user = self.require_authenticated()?;

            TableQuery::subindex::<AccountNumber>(
                PurchasedAccountsTable::read().get_index_by_owner(),
                &user,
            )
            .first(first)
            .last(last)
            .before(before)
            .after(after)
            .query()
            .await
        }

        /// Events: premium **name** history for `owner`
        async fn name_events(
            &self,
            first: Option<i32>,
            last: Option<i32>,
            before: Option<String>,
            after: Option<String>,
        ) -> async_graphql::Result<EventConnection<PremiumAccountEvent>> {
            let user = self.require_authenticated()?;

            EventQuery::new(format!(
                "history.{}.premAcctEvent",
                NameMarketService::SERVICE
            ))
            .condition(format!("owner = '{}'", user))
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
            get_sender() == services::http_server::SERVICE,
            "permission denied: serveSys only callable by 'http-server'",
        );

        None.or_else(|| serve_graphql(&request, Query { user }))
            .or_else(|| serve_graphiql(&request))
    }
}
