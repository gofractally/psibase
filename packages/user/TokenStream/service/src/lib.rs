#[psibase::service_tables]
pub mod tables {
    use async_graphql::SimpleObject;
    use psibase::services::tokens::{Quantity, TID};
    use psibase::{check, check_some, Fracpack, Table, TimePointSec, ToSchema};
    use serde::{Deserialize, Serialize};

    use psibase::services::nft::{Wrapper as Nfts, NID};
    use psibase::services::transact::Wrapper as TransactSvc;

    #[table(name = "StreamTable", index = 0)]
    #[derive(Default, Fracpack, ToSchema, SimpleObject, Serialize, Deserialize, Debug)]
    pub struct Stream {
        #[primary_key]
        pub nft_id: NID,
        pub token_id: TID,
        pub decay_rate_per_million: u32, // Decay rate in parts-per-million (1,000,000 ppm = 1.0)
        pub total_deposited: Quantity,   // Cumulative deposited amount
        pub total_claimed: Quantity,     // Cumulative claimed amount
        pub last_deposit_timestamp: TimePointSec, // Timestamp of the last deposit or initialization
        pub claimable_at_last_deposit: Quantity, // Claimable amount preserved from previous vesting
    }

    impl Stream {
        const PPM: f64 = 1_000_000.0; // Parts-per-million scale factor

        fn new(decay_rate_per_million: u32, token_id: u32) -> Self {
            check(
                decay_rate_per_million > 0 && decay_rate_per_million < Self::PPM as u32,
                "rate must be between 0 and 100%",
            );
            let now = TransactSvc::call().currentBlock().time.seconds();

            Self {
                nft_id: Nfts::call().mint(),
                token_id,
                decay_rate_per_million,
                total_deposited: 0.into(),
                total_claimed: 0.into(),
                last_deposit_timestamp: now,
                claimable_at_last_deposit: 0.into(),
            }
        }

        pub fn add(decay_rate_per_million: u32, token_id: u32) -> Self {
            let mut instance = Self::new(decay_rate_per_million, token_id);
            instance.save();
            instance
        }

        pub fn get(nft_id: u32) -> Option<Self> {
            StreamTable::new().get_index_pk().get(&nft_id)
        }

        pub fn get_assert(nft_id: u32) -> Self {
            check_some(Self::get(nft_id), "Stream does not exist")
        }

        fn decay_rate(&self) -> f64 {
            self.decay_rate_per_million as f64 / Self::PPM
        }

        /// Total available to be claimed now (vested - already claimed)
        pub fn balance_claimable(&self) -> Quantity {
            self.total_vested()
                .value
                .saturating_sub(self.total_claimed.value)
                .into()
        }

        /// Deposit `amount` into the bucket.
        pub fn deposit(&mut self, amount: Quantity) {
            self.claimable_at_last_deposit = self.balance_claimable();
            self.total_deposited = self
                .total_deposited
                .value
                .saturating_add(amount.value)
                .into();
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
        pub fn unclaimed_total(&self) -> Quantity {
            self.total_deposited
                .value
                .saturating_sub(self.total_claimed.value)
                .into()
        }

        pub fn total_vested(&self) -> Quantity {
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
            new_principal
                .saturating_sub(still_vesting)
                .saturating_add(self.claimable_at_last_deposit.value)
                .into()
        }

        pub fn save(&mut self) {
            StreamTable::new().put(&self).unwrap();
        }
    }
}

#[psibase::service(name = "token-stream", tables = "tables")]
pub mod service {
    use psibase::{
        services::tokens::{Memo, Quantity},
        *,
    };

    use psibase::services::nft as Nft;
    use psibase::services::tokens as Tokens;

    use crate::tables::Stream;

    #[action]
    fn get_stream(nft_id: u32) -> Option<Stream> {
        Stream::get(nft_id)
    }

    #[action]
    fn create(decay_rate_per_million: u32, token_id: u32) -> u32 {
        psibase::services::tokens::Wrapper::call().getToken(token_id);
        let stream = Stream::add(decay_rate_per_million, token_id);
        let sender = get_sender();
        Nft::Wrapper::call().credit(stream.nft_id, sender, "Redeemer NFT of stream".to_string());

        Wrapper::emit()
            .history()
            .created(decay_rate_per_million, token_id, sender);

        stream.nft_id
    }

    #[action]
    fn deposit(nft_id: u32, amount: Quantity) {
        let mut stream = Stream::get_assert(nft_id);

        stream.deposit(amount);

        let sender = get_sender();

        Tokens::Wrapper::call_from(Wrapper::SERVICE).debit(
            stream.token_id,
            sender,
            amount,
            Memo::try_from(format!("Deposit into stream {}", nft_id)).unwrap(),
        );

        Wrapper::emit().history().deposited(nft_id, amount, sender);
    }

    #[action]
    fn claim(nft_id: u32) {
        let mut stream = Stream::get_assert(nft_id);
        let claimed_amount = stream.claim();

        let sender = get_sender();
        check(
            Nft::Wrapper::call().getNft(stream.nft_id).owner == sender,
            "sender must be holder of NFT",
        );

        Tokens::Wrapper::call().credit(
            stream.token_id,
            sender,
            claimed_amount,
            Memo::try_from(format!("Claim from stream {}", nft_id)).unwrap(),
        );

        Wrapper::emit()
            .history()
            .claimed(nft_id, sender, claimed_amount);
    }

    #[event(history)]
    pub fn created(decay_rate_per_million: u32, token_id: u32, creator: AccountNumber) {}

    #[event(history)]
    pub fn deposited(nft_id: u32, amount: Quantity, depositor: AccountNumber) {}

    #[event(history)]
    pub fn claimed(nft_id: u32, claimer: AccountNumber, amount: Quantity) {}
}

#[cfg(test)]
mod tests;
