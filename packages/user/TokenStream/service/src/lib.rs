#[psibase::service_tables]
pub mod tables {
    use async_graphql::{ComplexObject, SimpleObject};
    use psibase::services::tokens::{Decimal, Precision, Quantity, TID};
    use psibase::{check, check_some, AccountNumber, Fracpack, Table, TimePointSec, ToSchema};
    use serde::{Deserialize, Serialize};

    use psibase::services::nft::{Wrapper as Nfts, NID};
    use psibase::services::transact::Wrapper as TransactSvc;

    #[table(name = "StreamTable", index = 0)]
    #[derive(Default, Fracpack, ToSchema, SimpleObject, Serialize, Deserialize, Debug)]
    #[graphql(complex)]
    pub struct Stream {
        #[primary_key]
        pub nft_id: NID,
        pub token_id: TID,
        pub half_life_seconds: u32, // Half life decay rate seconds
        #[graphql(skip)]
        pub total_deposited: Quantity, // Cumulative deposited amount
        #[graphql(skip)]
        pub total_claimed: Quantity, // Cumulative claimed amount
        pub last_deposit_timestamp: TimePointSec, // Timestamp of the last deposit or initialization
        #[graphql(skip)]
        pub claimable_at_last_deposit: Quantity, // Claimable amount preserved from previous vesting
    }

    #[ComplexObject]
    impl Stream {
        pub async fn deposited(&self) -> Decimal {
            Decimal::new(self.total_deposited, self.precision())
        }

        pub async fn claimed(&self) -> Decimal {
            Decimal::new(self.total_claimed, self.precision())
        }

        pub async fn vested(&self) -> Decimal {
            Decimal::new(self.total_vested(), self.precision())
        }

        pub async fn claimable(&self) -> Decimal {
            Decimal::new(self.balance_claimable(), self.precision())
        }

        pub async fn unclaimed(&self) -> Decimal {
            Decimal::new(self.unclaimed_total(), self.precision())
        }
    }

    impl Stream {
        fn new(half_life_seconds: u32, token_id: u32) -> Self {
            check(half_life_seconds > 0, "half life must be over 0");
            let now = TransactSvc::call().currentBlock().time.seconds();

            Self {
                nft_id: Nfts::call().mint(),
                token_id,
                half_life_seconds,
                total_deposited: 0.into(),
                total_claimed: 0.into(),
                last_deposit_timestamp: now,
                claimable_at_last_deposit: 0.into(),
            }
        }

        fn precision(&self) -> Precision {
            psibase::services::tokens::Wrapper::call()
                .getToken(self.token_id)
                .precision
        }

        pub fn add(decay_rate_per_million: u32, token_id: u32) -> Self {
            let instance = Self::new(decay_rate_per_million, token_id);
            instance.save();
            instance
        }

        pub fn get(nft_id: u32) -> Option<Self> {
            StreamTable::new().get_index_pk().get(&nft_id)
        }

        pub fn get_assert(nft_id: u32) -> Self {
            check_some(Self::get(nft_id), "Stream does not exist")
        }

        pub fn check_is_owner(&self, account: AccountNumber) {
            check(
                psibase::services::nft::Wrapper::call()
                    .getNft(self.nft_id)
                    .owner
                    == account,
                format!("{} must be holder of NFT ID: {}", account, self.nft_id).as_str(),
            );
        }

        fn decay_rate(&self) -> f64 {
            std::f64::consts::LN_2 / self.half_life_seconds as f64
        }

        /// Total available to be claimed now (vested - already claimed)
        fn balance_claimable(&self) -> Quantity {
            self.total_vested()
                .value
                .saturating_sub(self.total_claimed.value)
                .into()
        }

        /// Deposit `amount` into the bucket.
        pub fn deposit(&mut self, amount: Quantity) {
            self.total_deposited = (self.total_deposited.value - self.total_claimed.value).into();
            self.total_claimed = 0.into();
            self.claimable_at_last_deposit = self.total_vested();
            self.total_deposited = (self.total_deposited.value + amount.value).into();
            self.last_deposit_timestamp = TransactSvc::call().currentBlock().time.seconds();

            self.save();
        }

        /// Claim everything currently claimable; returns the claimed amount.
        pub fn claim(&mut self) -> Quantity {
            let claimable = self
                .total_vested()
                .value
                .saturating_sub(self.total_claimed.value);
            self.total_claimed = self.total_claimed.value.saturating_add(claimable).into();
            self.save();
            claimable.into()
        }

        /// Total unclaimed (vested + vesting).
        fn unclaimed_total(&self) -> Quantity {
            self.total_deposited
                .value
                .saturating_sub(self.total_claimed.value)
                .into()
        }

        fn total_vested(&self) -> Quantity {
            if self.total_deposited.value == 0 {
                return self.claimable_at_last_deposit;
            }
            let now = TransactSvc::call().currentBlock().time.seconds().seconds;
            let delta_seconds = (now - self.last_deposit_timestamp.seconds) as f64;
            let factor = (-self.decay_rate() * delta_seconds).exp();
            let new_principal = self
                .total_deposited
                .value
                .saturating_sub(self.claimable_at_last_deposit.value);
            let still_vesting = ((new_principal as f64) * factor).floor() as u64;
            self.claimable_at_last_deposit
                .value
                .saturating_add(new_principal.saturating_sub(still_vesting))
                .into()
        }

        fn save(&self) {
            StreamTable::new().put(&self).unwrap();
        }

        pub fn delete(&self) {
            check(
                self.total_claimed == self.total_deposited,
                "cannot delete until entire balance is claimed",
            );
            StreamTable::new().remove(&self);
        }
    }
}

#[psibase::service(name = "token-stream", tables = "tables")]
pub mod service {
    use psibase::services::tokens::{Decimal, Memo, Quantity};

    use psibase::services::nft::Wrapper as Nft;
    use psibase::services::tokens::Wrapper as Tokens;
    use psibase::{get_sender, AccountNumber};

    use crate::tables::Stream;

    /// Lookup stream information
    ///
    /// # Arguments
    /// * `nft_id` - ID of the stream AKA Redeemer NFT ID.
    ///
    /// # Returns
    /// Option of stream information, will be None if no longer exists.
    #[action]
    fn get_stream(nft_id: u32) -> Option<Stream> {
        Stream::get(nft_id)
    }

    /// Creates a token stream.
    ///
    /// # Arguments
    /// * `half_life_seconds` - Half life of the vesting rate in seconds
    /// * `token_id` - Token ID to be deposited into the stream.
    ///
    /// # Returns
    /// The ID of the redeemer NFT which is also the unique ID of the stream.    
    #[action]
    fn create(half_life_seconds: u32, token_id: u32) -> u32 {
        psibase::services::tokens::Wrapper::call().getToken(token_id);
        let stream = Stream::add(half_life_seconds, token_id);
        let sender = get_sender();
        Nft::call().credit(stream.nft_id, sender, "Redeemer NFT of stream".to_string());

        Wrapper::emit()
            .history()
            .created(stream.nft_id, half_life_seconds, token_id, sender);

        stream.nft_id
    }

    /// Deposit into a token stream.
    ///
    /// * Requires pre-existing shared balance of the token assigned to the stream, whole balance will be billed.
    ///
    /// # Arguments
    /// * `nft_id` - ID of the stream AKA Redeemer NFT ID.
    /// * `amount` - Amount to deposit.
    #[action]
    fn deposit(nft_id: u32, amount: Quantity) {
        let mut stream = Stream::get_assert(nft_id);
        let sender = get_sender();

        stream.deposit(amount);

        Tokens::call().debit(
            stream.token_id,
            sender,
            amount,
            Memo::try_from(format!("Deposit into stream {}", nft_id)).unwrap(),
        );

        Wrapper::emit().history().updated(
            nft_id,
            sender,
            "deposited".to_string(),
            Decimal::new(amount, Tokens::call().getToken(stream.token_id).precision).to_string(),
        );
    }

    /// Claim from a token stream.
    ///
    /// * Requires holding the redeemer NFT of the stream.
    ///
    /// # Arguments
    /// * `nft_id` - ID of the stream AKA Redeemer NFT ID.
    #[action]
    fn claim(nft_id: u32) {
        let mut stream = Stream::get_assert(nft_id);
        let claimed_amount = stream.claim();

        let sender = get_sender();
        stream.check_is_owner(sender);

        Tokens::call().credit(
            stream.token_id,
            sender,
            claimed_amount,
            Memo::try_from(format!("Claim from stream {}", nft_id)).unwrap(),
        );

        Wrapper::emit().history().updated(
            nft_id,
            sender,
            "claimed".to_string(),
            Decimal::new(
                claimed_amount,
                Tokens::call().getToken(stream.token_id).precision,
            )
            .to_string(),
        );
    }

    /// Delete a stream.
    ///
    /// * Requires stream to be empty.
    ///
    /// # Arguments
    /// * `nft_id` - ID of the stream AKA Redeemer NFT ID.
    #[action]
    fn delete(nft_id: u32) {
        let stream = Stream::get_assert(nft_id);
        stream.check_is_owner(get_sender());
        stream.delete();
    }

    #[event(history)]
    pub fn created(nft_id: u32, half_life_seconds: u32, token_id: u32, creator: AccountNumber) {}

    #[event(history)]
    pub fn updated(nft_id: u32, actor: AccountNumber, tx_type: String, amount: String) {}
}

#[cfg(test)]
mod tests;
