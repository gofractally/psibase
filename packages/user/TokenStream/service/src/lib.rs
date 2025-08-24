#[psibase::service_tables]
pub mod tables {
    use async_graphql::SimpleObject;
    use psibase::services::tokens::Quantity;
    use psibase::{Fracpack, Table, ToSchema};
    use serde::{Deserialize, Serialize};

    use psibase::services::nft::Wrapper as Nfts;
    use psibase::services::transact::Wrapper as TransactSvc;
    use psibase::TimePointSec;

    #[table(name = "StreamTable", index = 0)]
    #[derive(Default, Fracpack, ToSchema, SimpleObject, Serialize, Deserialize, Debug)]
    pub struct Stream {
        #[primary_key]
        pub nft_id: u32,
        pub decay_rate_per_million: u32, // Decay rate in parts-per-million (1,000,000 ppm = 1.0)
        pub total_deposited: Quantity,   // Cumulative deposited amount
        pub total_claimed: Quantity,     // Cumulative claimed amount
        pub last_deposit_timestamp: TimePointSec, // Timestamp of the last deposit or initialization
        pub claimable_at_last_deposit: Quantity, // Claimable amount preserved from previous vesting
    }

    impl Stream {
        const PPM: f64 = 1_000_000.0; // Parts-per-million scale factor

        pub fn new(decay_rate_per_million: u32) -> Self {
            let now = TransactSvc::call().currentBlock().time.seconds();

            Self {
                nft_id: Nfts::call().mint(),
                decay_rate_per_million,
                total_deposited: 0.into(),
                total_claimed: 0.into(),
                last_deposit_timestamp: now,
                claimable_at_last_deposit: 0.into(),
            }
        }

        fn decay_rate(&self) -> f64 {
            self.decay_rate_per_million as f64 / Self::PPM
        }

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

        /// Total still unclaimed (vested + still vesting).
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
            let now = TransactSvc::call().currentBlock().time.seconds().seconds as f64;

            let delta_seconds = now - self.last_deposit_timestamp.seconds as f64;
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
    use psibase::*;

    #[action]
    fn create() {}

    #[event(history)]
    pub fn updated(old_thing: String, new_thing: String) {}
}

#[cfg(test)]
mod tests;
