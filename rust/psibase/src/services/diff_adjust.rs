#[crate::service(name = "diff-adjust", dispatch = false, psibase_mod = "crate")]
#[allow(non_snake_case, unused_variables)]
pub mod Service {

    /// Creates a new Rate limit
    ///
    /// # Arguments
    /// * `initial_difficulty` - Sets initial difficulty
    /// * `window_seconds` - Seconds duration before decay occurs
    /// * `target_min` - Minimum rate limit target
    /// * `target_max` - Maximum rate limit target
    /// * `floor_difficulty` - Minimum price
    /// * `percent_change` - Percent to increment / decrement, 50000 = 5%
    #[action]
    fn create(
        initial_difficulty: u64,
        window_seconds: u32,
        target_min: u32,
        target_max: u32,
        floor_difficulty: u64,
        percent_change: u32,
    ) -> u32 {
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
    fn get_price(nft_id: u32) -> u64 {
        unimplemented!()
    }

    /// Increment RateLimit instance, potentially increasing RateLimit
    ///
    /// * Requires holding administration NFT.
    ///
    /// # Arguments
    /// * `nft_id` - RateLimit / NFT ID
    /// * `amount` - Amount to increment the counter by
    #[action]
    fn increment(nft_id: u32, amount: u32) -> u64 {
        unimplemented!()
    }

    /// Update targets
    ///
    /// * Requires holding administration NFT.
    ///
    /// # Arguments
    /// * `nft_id` - RateLimit / NFT ID
    /// * `target_min` - Minimum target difficulty
    /// * `target_max` - Maximum target difficulty
    #[action]
    fn set_targets(nft_id: u32, target_min: u32, target_max: u32) {
        unimplemented!()
    }

    /// Update window
    ///
    /// * Requires holding administration NFT.
    ///
    /// # Arguments
    /// * `nft_id` - RateLimit / NFT ID
    /// * `seconds` - Seconds
    #[action]
    fn set_window(nft_id: u32, seconds: u32) {
        unimplemented!()
    }

    /// Update floor difficulty
    ///
    /// * Requires holding administration NFT.
    ///
    /// # Arguments
    /// * `nft_id` - RateLimit / NFT ID
    /// * `difficulty` - Difficulty
    #[action]
    fn set_floor(nft_id: u32, difficulty: u64) {
        unimplemented!()
    }

    /// Update percent change
    ///
    /// * Requires holding administration NFT.
    ///
    /// # Arguments
    /// * `nft_id` - RateLimit / NFT ID
    /// * `percent_ppm` - Percent ppm 50000 = 5%
    #[action]
    fn set_percent(nft_id: u32, ppm: u32) {
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
