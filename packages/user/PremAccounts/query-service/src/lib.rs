#[psibase::service]
#[allow(non_snake_case)]
mod service {
    use async_graphql::*;
    use prem_accounts::tables::AuctionsTable;
    use diff_adjust::tables::RateLimitTable;
    use psibase::*;

    struct Query;

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
                    // Similar to DiffAdjust query service pattern
                    if let Some(mut rate_limit) = RateLimitTable::read()
                        .get_index_pk()
                        .get(&auction.nft_id)
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
