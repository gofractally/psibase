#[psibase::service(name = "namemarket+1")]
#[allow(non_snake_case)]
mod service {
    use std::sync::OnceLock;

    use async_graphql::{connection::Connection, *};
    use name_market::tables::{
        Auction as AuctionRow, AuctionsTable, PurchasedAccount, PurchasedAccountsTable,
    };
    use name_market::Wrapper as NameMarketService;
    use psibase::services::diff_adjust::{RateLimit, Wrapper as DiffAdjust};
    use psibase::services::tokens::{Decimal, Precision, Quantity, Wrapper as TokensWrapper};
    use psibase::*;
    use serde::Deserialize;
    use serde_aux::field_attributes::deserialize_number_from_string;

    struct Auction {
        row: AuctionRow,
        rate_limit: OnceLock<Option<RateLimit>>,
    }

    impl From<AuctionRow> for Auction {
        fn from(row: AuctionRow) -> Self {
            Self {
                row,
                rate_limit: OnceLock::new(),
            }
        }
    }

    impl Auction {
        fn rate_limit(&self) -> Option<&RateLimit> {
            self.rate_limit
                .get_or_init(|| DiffAdjust::call().get(self.row.nft_id))
                .as_ref()
        }

        fn sys_precision() -> Precision {
            TokensWrapper::call()
                .getSysToken()
                .expect("system token must be defined")
                .precision
        }
    }

    #[Object]
    impl Auction {
        async fn length(&self) -> u8 {
            self.row.length
        }

        async fn enabled(&self) -> bool {
            self.row.enabled
        }

        /// Stored create price, as a Decimal in the system token.
        async fn initial_price(&self) -> Decimal {
            Decimal::new(self.row.initial_price, Self::sys_precision())
        }

        /// DiffAdjust target (target_min == target_max in NameMarket usage).
        async fn target(&self) -> u32 {
            self.rate_limit().map(|r| r.target_min).unwrap_or(0)
        }

        /// Floor price from DiffAdjust, as a Decimal in the system token.
        async fn floor_price(&self) -> Decimal {
            Decimal::new(
                Quantity::from(self.rate_limit().map(|r| r.floor_difficulty).unwrap_or(0)),
                Self::sys_precision(),
            )
        }

        async fn window_seconds(&self) -> u32 {
            self.rate_limit().map(|r| r.window_seconds).unwrap_or(0)
        }

        async fn increase_pct(&self) -> u8 {
            name_market::ppm_to_pct(self.rate_limit().map(|r| r.increase_ppm).unwrap_or(0))
        }

        async fn decrease_pct(&self) -> u8 {
            name_market::ppm_to_pct(self.rate_limit().map(|r| r.decrease_ppm).unwrap_or(0))
        }

        /// Current ask price (DiffAdjust difficulty), as a Decimal in the system token.
        async fn price(&self) -> Decimal {
            let mut price_raw = DiffAdjust::call().get_diff(self.row.nft_id);
            if price_raw == 0 {
                price_raw = self.rate_limit().map(|r| r.floor_difficulty).unwrap_or(0);
            }
            Decimal::new(Quantity::from(price_raw), Self::sys_precision())
        }
    }

    #[derive(Deserialize, SimpleObject)]
    #[graphql(complex)]
    struct AccountEvent {
        owner: AccountNumber,
        account: AccountNumber,
        #[serde(deserialize_with = "deserialize_number_from_string")]
        #[graphql(skip)]
        action: u8,
    }

    #[ComplexObject]
    impl AccountEvent {
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

    fn auth_err(user: AccountNumber) -> async_graphql::Result<()> {
        Err(async_graphql::Error::new(format!(
            "permission denied: '{}' must authorize your app to make this query.",
            user
        )))
    }

    fn serve_sys() -> services::transact::ServiceMethod {
        services::transact::ServiceMethod {
            service: crate::Wrapper::SERVICE,
            method: MethodNumber::from(crate::action_structs::serveSys::ACTION_NAME),
        }
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

        fn check_user_auth(&self, user: AccountNumber) -> async_graphql::Result<()> {
            let authorizers = self.user.map(|u| vec![u]).unwrap_or_default();
            if self.user == Some(user) || is_auth(user, Some(serve_sys()), authorizers) {
                Ok(())
            } else {
                auth_err(user)
            }
        }
    }

    #[Object]
    impl Query {
        /// Current prices for each configured and enabled market (sparse list)
        /// If no system token configured, returns empty list
        async fn current_prices(&self) -> Vec<Auction> {
            if TokensWrapper::call().getSysToken().is_none() {
                return vec![];
            }
            let mut rows: Vec<Auction> = AuctionsTable::read()
                .get_index_pk()
                .iter()
                .filter(|auction| auction.enabled)
                .map(Auction::from)
                .collect();
            rows.sort_by_key(|r| r.row.length);
            rows
        }

        /// All configured name markets (sparse list): status plus pricing parameters.
        async fn market_params(&self) -> Vec<Auction> {
            if TokensWrapper::call().getSysToken().is_none() {
                return vec![];
            }
            AuctionsTable::read()
                .get_index_pk()
                .iter()
                .map(Auction::from)
                .collect()
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

        /// Events: account **name** history for `owner`
        async fn name_events(
            &self,
            owner: AccountNumber,
            first: Option<i32>,
            last: Option<i32>,
            before: Option<String>,
            after: Option<String>,
        ) -> async_graphql::Result<EventConnection<AccountEvent>> {
            self.check_user_auth(owner.clone())?;

            EventQuery::new(format!(
                "history.{}.nameMktEvent",
                NameMarketService::SERVICE
            ))
            .condition(format!("owner = '{}'", owner))
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
        assert_eq!(
            get_sender(),
            services::http_server::SERVICE,
            "permission denied: serveSys only callable by 'http-server'",
        );

        None.or_else(|| serve_graphql(&request, Query { user }))
            .or_else(|| serve_graphiql(&request))
    }
}
