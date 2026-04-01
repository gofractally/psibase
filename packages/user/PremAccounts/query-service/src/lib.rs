#[psibase::service]
#[allow(non_snake_case)]
mod service {
    use async_graphql::{connection::Connection, *};
    use diff_adjust::tables::RateLimitTable;
    use prem_accounts::tables::{AuctionsTable, PurchasedAccountsTable};
    use psibase::services::tokens::{Decimal, Quantity, Wrapper as TokensWrapper};
    use psibase::*;
    use serde::Deserialize;
    use serde_aux::field_attributes::deserialize_number_from_string;

    #[derive(SimpleObject)]
    struct MarketStatus {
        length: u8,
        enabled: bool,
    }

    #[derive(SimpleObject)]
    struct MarketPrice {
        length: u8,
        price: Decimal,
    }

    #[derive(SimpleObject)]
    struct BoughtNamesByLength {
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

    struct Query {
        user: Option<AccountNumber>,
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
    }

    #[Object]
    impl Query {
        /// Current prices for each configured premium name-length market (sparse, up to 15 markets).
        /// Returns an empty list when the system token is not configured (avoids GraphQL failure).
        async fn getPrices(&self) -> Vec<MarketPrice> {
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
                    let raw = rate_table
                        .get_index_pk()
                        .get(&auction.nft_id)
                        .map(|mut rate_limit| rate_limit.check_difficulty_decrease())
                        .unwrap_or(0);
                    MarketPrice {
                        length: auction.length,
                        price: Decimal::new(Quantity::from(raw), precision),
                    }
                })
                .collect();
            rows.sort_by_key(|r| r.length);
            rows
        }

        /// Status (enabled/disabled) for each configured premium name-length market (sparse).
        async fn marketsStatus(&self) -> Vec<MarketStatus> {
            let auctions_table = AuctionsTable::read();
            let mut rows: Vec<MarketStatus> = auctions_table
                .get_index_pk()
                .iter()
                .map(|a| MarketStatus {
                    length: a.length,
                    enabled: a.enabled,
                })
                .collect();
            rows.sort_by_key(|r| r.length);
            rows
        }

        /// Bought-but-unclaimed names for the user, grouped by name length (sparse: only lengths with names).
        async fn getBoughtNames(
            &self,
            user: AccountNumber,
        ) -> async_graphql::Result<Vec<BoughtNamesByLength>> {
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
                    BoughtNamesByLength { length, names }
                })
                .collect())
        }

        /// Returns a paginated subset of all historical events (that haven't yet been pruned
        /// from this node) related to premium account buys and claims.
        /// Can be filtered by account length and/or account owner.
        async fn prem_account_events(
            &self,
            owner: AccountNumber,
            first: Option<i32>,
            last: Option<i32>,
            before: Option<String>,
            after: Option<String>,
        ) -> async_graphql::Result<Connection<u64, PremiumAccountEvent>> {
            self.check_user_auth(owner.clone())?;

            EventQuery::new("history.prem-accounts.premAcctEvent")
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
            get_sender() == AccountNumber::from("http-server"),
            "permission denied: prem-accounts::serveSys only callable by 'http-server'",
        );

        None.or_else(|| serve_graphql(&request, Query { user }))
            .or_else(|| serve_graphiql(&request))
    }
}
