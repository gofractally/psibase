#[psibase::service]
#[allow(non_snake_case)]
mod service {
    use async_graphql::{connection::Connection, *};
    // HEY! When interacting with antoher service, don't add dep to local crate: communicate through `psibase` crate
    // use diff_adjust::tables::RateLimitTable;
    use prem_accounts::tables::{AuctionsTable, PurchasedAccountsTable};
    use psibase::services::diff_adjust::Wrapper as DiffAdjust;
    use psibase::*;
    use serde::Deserialize;
    use serde_aux::field_attributes::deserialize_number_from_string;

    #[derive(Deserialize, SimpleObject)]
    #[graphql(complex)]
    struct PremiumAccountEvent {
        owner: AccountNumber,
        account: AccountNumber,
        #[serde(deserialize_with = "deserialize_number_from_string")]
        #[graphql(skip)]
        action: u8,
    }

    #[derive(SimpleObject)]
    struct MarketStatus {
        /// Account name length (market identifier)
        length: u8,
        /// Whether this market is currently enabled
        enabled: bool,
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
        /// Get prices for account name lengths 1-9
        /// Returns array where index 0 = price for length-1 names, index 8 = price for length-9 names
        async fn getPrices(&self) -> Vec<u64> {
            let auctions_table = AuctionsTable::read();
            let mut prices = Vec::new();

            // TODO: return auction tuples (<length>, <price>)
            for length in 1..=9 {
                if let Some(auction) = auctions_table.get_index_pk().get(&length) {
                    // Get the rate limit and calculate current difficulty
                    prices.push(DiffAdjust::call().get_diff(auction.nft_id));
                }
            }

            prices
        }

        /// Returns a list of account names (strings) bought but not yet claimed by the authenticated user
        async fn getBoughtNames(&self, user: AccountNumber) -> async_graphql::Result<Vec<String>> {
            self.check_user_auth(user)?;

            let purchased_table = PurchasedAccountsTable::read();
            let mut names = Vec::new();

            // TODO: This would be more efficient with a secondary index on owner
            for record in purchased_table.get_index_pk().iter() {
                if record.owner == user {
                    names.push(record.account.to_string());
                }
            }

            Ok(names)
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

        /// Returns all premium name markets and whether each is enabled.
        async fn marketsStatus(&self) -> Vec<MarketStatus> {
            let auctions_table = AuctionsTable::read();
            let mut markets = Vec::new();

            for auction in auctions_table.get_index_pk().iter() {
                markets.push(MarketStatus {
                    length: auction.length,
                    enabled: auction.enabled.unwrap_or(true),
                });
            }

            markets
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
