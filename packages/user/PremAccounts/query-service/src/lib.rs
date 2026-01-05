#[psibase::service]
#[allow(non_snake_case)]
mod service {
    use async_graphql::*;
    use diff_adjust::tables::RateLimitTable;
    use prem_accounts::tables::{AuctionsTable, PurchasedAccountsTable};
    use psibase::*;

    struct Query {
        user: Option<AccountNumber>,
    }

    impl Query {
        fn check_user_auth(&self, user: AccountNumber) -> async_graphql::Result<()> {
            if self.user != Some(user) {
                return Err(async_graphql::Error::new(format!(
                    "permission denied: '{}' must authorize your app to make this query.",
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

            for length in 1..=9 {
                if let Some(auction) = auctions_table.get_index_pk().get(&length) {
                    // Get the rate limit and calculate current difficulty
                    if let Some(mut rate_limit) =
                        RateLimitTable::read().get_index_pk().get(&auction.nft_id)
                    {
                        // Update difficulty if needed (this calculates the current difficulty)
                        let current_difficulty = rate_limit.check_difficulty_decrease();
                        prices.push(current_difficulty);
                    } else {
                        prices.push(0);
                    }
                } else {
                    prices.push(0);
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
