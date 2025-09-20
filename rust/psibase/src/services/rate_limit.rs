#[crate::service(name = "rate-limit", dispatch = false, psibase_mod = "crate")]
#[allow(non_snake_case, unused_variables)]
pub mod Service {
    use crate::services::tokens::Quantity;

    /// Creates a new rate limit instance
    ///
    /// # Arguments
    /// * `initial_price` - Sets initial price
    /// * `window_seconds` - Seconds duration before decay occurs
    /// * `target` - Difficulty target
    /// * `floor_price` - Minimum price.
    /// * `percent_change` - Percent to increment / decrement, 5 = 5%
    #[action]
    fn create(window_seconds: u32, target: u32, floor_price: Quantity, percent_change: u8) -> u32 {
        unimplemented!()
    }

    /// Get RateLimit price
    ///
    /// # Arguments
    /// * `nft_id` - RateLimit / NFT ID
    ///
    /// # Returns
    /// Price of RateLimit
    #[action]
    fn get_price(nft_id: u32) -> Quantity {
        unimplemented!()
    }

    /// Increment RateLimit instance, potentially increasing difficulty
    ///
    /// * Requires holding administration NFT.
    ///
    /// # Arguments
    /// * `nft_id` - RateLimit / NFT ID
    #[action]
    fn increment(nft_id: u32) -> Quantity {
        unimplemented!()
    }

    /// Delete RateLimit instance
    ///
    /// * Requires holding administration NFT.
    ///
    /// # Arguments
    /// * `nft_id` - RateLimit / NFT ID
    #[action]
    fn delete(nft_id: u32) {
        unimplemented!()
    }
}

#[test]
fn verify_schema() {
    crate::assert_schema_matches_package::<Wrapper>();
}
