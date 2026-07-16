#[psibase::service(name = "namemarket+1")]
#[allow(non_snake_case)]
mod service {
    use async_graphql::{connection::Connection, *};
    use name_market::tables::{Auction, AuctionsTable, PurchasedAccount, PurchasedAccountsTable};
    use name_market::Wrapper as NameMarketService;
    use psibase::services::tokens::Wrapper as TokensWrapper;
    use psibase::*;
    use serde::Deserialize;
    use serde_aux::field_attributes::deserialize_number_from_string;

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
                .collect();
            rows.sort_by_key(|r| r.length);
            rows
        }

        /// All configured name markets (sparse list): status plus pricing parameters.
        async fn market_params(&self) -> Vec<Auction> {
            if TokensWrapper::call().getSysToken().is_none() {
                return vec![];
            }
            AuctionsTable::read().get_index_pk().iter().collect()
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
        check(
            get_sender() == services::http_server::SERVICE,
            "permission denied: serveSys only callable by 'http-server'",
        );

        None.or_else(|| serve_graphql(&request, Query { user }))
            .or_else(|| serve_graphiql(&request))
    }
}
