#[crate::service(name = "diff-adjust", dispatch = false, psibase_mod = "crate")]
#[allow(non_snake_case, unused_variables)]
pub mod Service {

    /// Creates a new Rate limit
    ///
    /// # Arguments
    /// * `initial_difficulty` - Sets initial difficulty
    /// * `window_seconds` - Seconds duration before decay occurs
    /// * `target` - Rate limit target
    /// * `floor_difficulty` - Minimum price
    /// * `percent_change` - Percent to increment / decrement, 5 = 5%
    #[action]
    fn create(
        initial_difficulty: u64,
        window_seconds: u32,
        target: u32,
        floor_difficulty: u64,
        percent_change: u8,
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

    /// Update target
    ///
    /// * Requires holding administration NFT.
    ///
    /// # Arguments
    /// * `nft_id` - RateLimit / NFT ID
    /// * `target` - Target difficulty
    #[action]
    fn up_target(nft_id: u32, target: u32) {
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
    fn up_window(nft_id: u32, seconds: u32) {
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
    fn up_floor(nft_id: u32, difficulty: u64) {
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
