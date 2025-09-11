use crate::{
    services::{
        nft::NID,
        tokens::{Quantity, TID},
    },
    TimePointSec,
};
use fracpack::{Pack, ToSchema, Unpack};
use serde::{Deserialize, Serialize};

#[derive(Debug, Copy, Clone, Pack, Unpack, ToSchema, Serialize, Deserialize)]
#[fracpack(fracpack_mod = "fracpack")]
pub struct Stream {
    pub nft_id: NID,
    pub token_id: TID,
    pub half_life_seconds: u32,
    pub total_deposited: Quantity,
    pub total_claimed: Quantity,
    pub last_deposit_timestamp: TimePointSec,
    pub claimable_at_last_deposit: Quantity,
}

#[crate::service(name = "token-stream", dispatch = false, psibase_mod = "crate")]
#[allow(non_snake_case, unused_variables)]
pub mod Service {
    use crate::{
        services::{token_stream::Stream, tokens::Quantity},
        AccountNumber,
    };

    /// Lookup stream information
    ///
    /// # Arguments
    /// * `nft_id` - ID of the stream AKA Redeemer NFT ID.
    ///
    /// # Returns
    /// Option of stream information, will be None if no longer exists.
    #[action]
    fn get_stream(nft_id: u32) -> Option<Stream> {
        unimplemented!()
    }

    /// Creates a token stream.
    ///
    /// # Arguments
    /// * `half_life_seconds` - Time (in seconds) until half of the total unvested balance is withdrawable
    /// * `token_id` - Token ID to be deposited into the stream.
    ///
    /// # Returns
    /// The ID of the redeemer NFT which is also the unique ID of the stream.    
    #[action]
    fn create(half_life_seconds: u32, token_id: u32) -> u32 {
        unimplemented!()
    }

    /// Deposit into a token stream.
    ///
    /// * Requires pre-existing shared balance of the token assigned to the strema, whole balance will be billed.
    ///
    /// # Arguments
    /// * `nft_id` - ID of the stream AKA Redeemer NFT ID.
    /// * `amount` - Amount to deposit.
    #[action]
    fn deposit(nft_id: u32, amount: Quantity) {
        unimplemented!()
    }

    /// Claim from a token stream.
    ///
    /// * Requires holding the redeemer NFT of the stream.
    ///
    /// # Arguments
    /// * `nft_id` - ID of the stream AKA Redeemer NFT ID.
    #[action]
    fn claim(nft_id: u32) {
        unimplemented!()
    }

    /// Delete a stream.
    ///
    /// * Requires stream to be empty.
    ///
    /// # Arguments
    /// * `nft_id` - ID of the stream AKA Redeemer NFT ID.
    #[action]
    fn delete(nft_id: u32) {
        unimplemented!()
    }

    #[event(history)]
    pub fn created(nft_id: u32, half_life_seconds: u32, token_id: u32, creator: AccountNumber) {}

    #[event(history)]
    pub fn updated(nft_id: u32, actor: AccountNumber, tx_type: String, amount: String) {}
}

#[test]
fn verify_schema() {
    crate::assert_schema_matches_package::<Wrapper>();
}
