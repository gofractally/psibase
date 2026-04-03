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

    fn deserialize_sqlite_bool<'de, D>(deserializer: D) -> Result<bool, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        match u64::deserialize(deserializer)? {
            0 => Ok(false),
            1 => Ok(true),
            n => Err(serde::de::Error::custom(format!(
                "expected SQLite bool as 0 or 1, got {n}"
            ))),
        }
    }

    fn default_market_window_seconds() -> u32 {
        30 * 86400
    }

    fn default_market_ppm() -> u32 {
        50_000
    }

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

    #[derive(SimpleObject)]
    struct UnclaimedNamesByLength {
        length: u8,
        names: Vec<String>,
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

        /// UTF-8 length of the premium account name (same convention as on-chain markets).
        pub async fn length(&self) -> u8 {
            self.account.to_string().len() as u8
        }
    }

    #[derive(Deserialize, SimpleObject)]
    struct MarketConfiguredEvent {
        #[serde(deserialize_with = "deserialize_number_from_string")]
        length: u8,
        #[graphql(name = "initialPrice")]
        #[serde(deserialize_with = "deserialize_number_from_string")]
        initial_price: u64,
        #[serde(deserialize_with = "deserialize_number_from_string")]
        target: u32,
        #[graphql(name = "floorPrice")]
        #[serde(deserialize_with = "deserialize_number_from_string")]
        floor_price: u64,
        #[serde(deserialize_with = "deserialize_sqlite_bool")]
        enable: bool,
        #[serde(
            default = "default_market_window_seconds",
            deserialize_with = "deserialize_number_from_string"
        )]
        #[graphql(name = "windowSeconds")]
        window_seconds: u32,
        #[serde(
            default = "default_market_ppm",
            deserialize_with = "deserialize_number_from_string",
            alias = "ppm"
        )]
        #[graphql(name = "increasePpm")]
        increase_ppm: u32,
        #[serde(
            default = "default_market_ppm",
            deserialize_with = "deserialize_number_from_string"
        )]
        #[graphql(name = "decreasePpm")]
        decrease_ppm: u32,
    }

    #[derive(Deserialize, SimpleObject)]
    struct MarketStatusEvent {
        #[serde(deserialize_with = "deserialize_number_from_string")]
        length: u8,
        #[serde(deserialize_with = "deserialize_sqlite_bool")]
        enabled: bool,
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

        EventQuery::new("history.prem-accounts.premAcctEvent")
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

        fn require_authenticated(&self) -> async_graphql::Result<()> {
            if self.user.is_none() {
                return Err(async_graphql::Error::new(
                    "permission denied: an authorized session is required for this query.",
                ));
            }
            Ok(())
        }
    }

    #[Object]
    impl Query {
        /// Current prices for each configured premium name-length market (sparse rows; lengths follow PremAccounts service limits).
        /// GraphQL field: `currentPrices`. Returns an empty list when the system token is not configured (avoids GraphQL failure).
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
                    let mut raw = rate_table
                        .get_index_pk()
                        .get(&auction.nft_id)
                        .map(|mut rate_limit| rate_limit.check_difficulty_decrease())
                        .unwrap_or(0);
                    // DiffAdjust can read 0 before the rate row is populated or in edge cases; the auction still stores the configured ask.
                    if auction.enabled && raw == 0 && auction.initial_price > 0 {
                        raw = auction.initial_price;
                    }
                    MarketPrice {
                        length: auction.length,
                        price: Decimal::new(Quantity::from(raw), precision),
                    }
                })
                .collect();
            rows.sort_by_key(|r| r.length);
            rows
        }

        /// All configured premium name-length markets (sparse): status plus pricing parameters.
        /// GraphQL field: `marketParams`.
        async fn market_params(&self) -> Vec<MarketParams> {
            let Some(token) = TokensWrapper::call().getSysToken() else {
                return vec![];
            };
            let precision = token.precision;
            let auctions_table = AuctionsTable::read();
            let mut rows: Vec<MarketParams> = auctions_table
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
            rows.sort_by_key(|r| r.length);
            rows
        }

        /// Bought-but-unclaimed names for the user, grouped by name length (sparse: only lengths with names).
        async fn unclaimed_names(
            &self,
            user: AccountNumber,
        ) -> async_graphql::Result<Vec<UnclaimedNamesByLength>> {
            self.check_user_auth(user)?;

            let purchased_table = PurchasedAccountsTable::read();
            let mut by_length: std::collections::BTreeMap<u8, Vec<String>> =
                std::collections::BTreeMap::new();

            for record in purchased_table.get_index_pk().iter() {
                if record.owner == user {
                    let name = record.account.to_string();
                    let len = name.len() as u8;
                    by_length.entry(len).or_default().push(name);
                }
            }

            Ok(by_length
                .into_iter()
                .map(|(length, mut names)| {
                    names.sort();
                    UnclaimedNamesByLength { length, names }
                })
                .collect())
        }

        /// Historical premium **name** activity for `owner` (`premAcctEvent`: purchases and claims).
        /// The caller must authorize as `owner`.
        async fn name_events(
            &self,
            owner: AccountNumber,
            first: Option<i32>,
            last: Option<i32>,
            before: Option<String>,
            after: Option<String>,
        ) -> async_graphql::Result<Connection<u64, PremiumAccountEvent>> {
            query_name_events(self, owner, first, last, before, after)
        }

        /// Historical **market configuration** changes (`marketConfigured` events). Requires an authenticated session.
        async fn market_config_events(
            &self,
            length: Option<u8>,
            first: Option<i32>,
            last: Option<i32>,
            before: Option<String>,
            after: Option<String>,
        ) -> async_graphql::Result<Connection<u64, MarketConfiguredEvent>> {
            self.require_authenticated()?;

            let mut q = EventQuery::new("history.prem-accounts.marketConfigured");
            if let Some(l) = length {
                q = q.condition(format!("length = {l}"));
            }
            q.first(first)
                .last(last)
                .before(before)
                .after(after)
                .query()
        }

        /// Historical **market enabled/disabled** changes (`marketStatus` events). Requires an authenticated session.
        async fn market_status_events(
            &self,
            length: Option<u8>,
            first: Option<i32>,
            last: Option<i32>,
            before: Option<String>,
            after: Option<String>,
        ) -> async_graphql::Result<Connection<u64, MarketStatusEvent>> {
            self.require_authenticated()?;

            let mut q = EventQuery::new("history.prem-accounts.marketStatus");
            if let Some(l) = length {
                q = q.condition(format!("length = {l}"));
            }
            q.first(first)
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
            "permission denied: prem-accounts::serveSys only callable by 'http-server'",
        );

        None.or_else(|| serve_graphql(&request, Query { user }))
            .or_else(|| serve_graphiql(&request))
    }
}
