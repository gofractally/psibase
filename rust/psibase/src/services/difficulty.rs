#[crate::service(name = "difficulty", dispatch = false, psibase_mod = "crate")]
#[allow(non_snake_case, unused_variables)]
pub mod Service {
    use crate::{services::tokens::Quantity, AccountNumber};

    /// Creates a new difficulty instance
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

    /// Get difficulty price
    ///
    /// # Arguments
    /// * `nft_id` - Difficulty / NFT ID
    ///
    /// # Returns
    /// Price of difficulty
    #[action]
    fn get_price(nft_id: u32) -> Quantity {
        unimplemented!()
    }

    /// Increment difficulty instance, potentially increasing difficulty
    ///
    /// * Requires holding administration NFT.
    ///
    /// # Arguments
    /// * `nft_id` - Difficulty / NFT ID
    #[action]
    fn increment(nft_id: u32) -> Quantity {
        unimplemented!()
    }

    /// Increment difficulty instance, potentially increasing difficulty
    ///
    /// * Requires holding administration NFT.
    ///
    /// # Arguments
    /// * `nft_id` - Difficulty / NFT ID
    /// * `amount` - Amount to increment the counter by
    #[action]
    fn delete(nft_id: u32) {
        unimplemented!()
    }

    #[event(history)]
    pub fn created(nft_id: u32, actor: AccountNumber) {}
}

#[test]
fn verify_schema() {
    crate::assert_schema_matches_package::<Wrapper>();
}
