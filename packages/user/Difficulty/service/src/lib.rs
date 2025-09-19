#[psibase::service_tables]
pub mod tables {
    use psibase::services::difficulty::Wrapper;
    use psibase::services::nft::Wrapper as Nft;
    use psibase::services::tokens::Quantity;
    use psibase::services::transact::Wrapper as TransactSvc;
    use psibase::{check, check_some, get_sender, Fracpack, Table, TimePointSec, ToSchema};

    use async_graphql::SimpleObject;

    use serde::{Deserialize, Serialize};

    #[table(name = "DifficultyTable", index = 0)]
    #[derive(Default, Fracpack, ToSchema, SimpleObject, Serialize, Deserialize, Debug)]
    pub struct Difficulty {
        #[primary_key]
        pub nft_id: u32,
        pub window_seconds: u32,
        pub counter: u32,
        pub target_per_window: u32,
        pub floor_price: Quantity,
        pub active_price: Quantity,
        pub last_update: TimePointSec,
        pub percent_change: u8,
    }

    impl Difficulty {
        fn table() -> DifficultyTable {
            DifficultyTable::new()
        }

        pub fn new(
            nft_id: u32,
            initial_price: Quantity,
            window_seconds: u32,
            target_per_window: u32,
            floor_price: Quantity,
            last_update: TimePointSec,
            percent_change: u8,
        ) -> Self {
            Self {
                nft_id,
                active_price: initial_price,
                counter: 0,
                floor_price: floor_price,
                target_per_window,
                window_seconds,
                last_update,
                percent_change,
            }
        }

        pub fn add(
            initial_price: Quantity,
            window_seconds: u32,
            target: u32,
            floor_price: Quantity,
            percent_change: u8,
        ) -> Self {
            let nft_id = Nft::call().mint();
            let sender = get_sender();
            Nft::call().credit(
                nft_id,
                sender,
                "Difficulty item administration NFT".to_string(),
            );

            let last_updated = TransactSvc::call().currentBlock().time.seconds();

            check(
                percent_change > 0 && percent_change < 100,
                "percent must be between 0 - 100%",
            );

            let new_instance = Self::new(
                nft_id,
                initial_price,
                window_seconds,
                target,
                floor_price,
                last_updated,
                percent_change,
            );
            new_instance.save();

            Wrapper::emit().history().created(nft_id, sender);

            new_instance
        }

        pub fn check_price_decrease(&mut self) -> Quantity {
            let now = TransactSvc::call().currentBlock().time.seconds();
            check(
                now.seconds >= self.last_update.seconds,
                "time must not go backwards",
            );
            let seconds_elapsed = (now.seconds - self.last_update.seconds) as u32;
            let windows_elapsed = seconds_elapsed / self.window_seconds;
            if windows_elapsed > 0 {
                let below_target = self.counter < self.target_per_window;
                let seconds_remainder = seconds_elapsed % self.window_seconds;
                self.counter = 0;
                self.last_update = TimePointSec::from(now.seconds - seconds_remainder as i64);
                if below_target {
                    let mut new_price = self.active_price.value;
                    let factor = 100u64 - self.percent_change as u64;
                    for _ in 0..windows_elapsed {
                        new_price = (new_price * factor / 100u64).max(self.floor_price.value);
                    }
                    self.active_price = new_price.into();
                }
            }
            self.active_price
        }

        fn check_price_increase(&mut self) -> Quantity {
            if self.counter > self.target_per_window {
                let percent = 100u64 + self.percent_change as u64;
                check(
                    self.active_price.value <= u64::MAX / percent,
                    "price increase would overflow u64",
                );
                self.active_price = ((self.active_price.value * percent) / 100u64).into();
                self.counter = 0;
                self.last_update = TransactSvc::call().currentBlock().time.seconds();
                self.save();
            }
            self.active_price
        }

        fn check_sender_is_owner(&self) {
            check(
                Nft::call().getNft(self.nft_id).owner == get_sender(),
                "must be owner of difficulty",
            );
        }

        pub fn increment(&mut self) -> Quantity {
            self.check_sender_is_owner();
            let price = self.check_price_decrease();
            self.counter += 1;
            self.check_price_increase();
            self.save();
            price
        }

        pub fn delete(&self) {
            self.check_sender_is_owner();
            Self::table().remove(&self);
        }

        fn save(&self) {
            Self::table().put(&self).expect("failed to save");
        }

        pub fn get(nft_id: u32) -> Option<Self> {
            Self::table().get_index_pk().get(&nft_id)
        }

        pub fn get_assert(nft_id: u32) -> Self {
            check_some(Self::get(nft_id), "difficulty of NFT ID does not exist")
        }
    }
}

#[psibase::service(name = "difficulty", tables = "tables")]
pub mod service {
    use psibase::{services::tokens::Quantity, AccountNumber};

    use crate::tables::Difficulty;

    /// Creates a new difficulty instance
    ///
    /// # Arguments
    /// * `initial_price` - Sets initial price
    /// * `window_seconds` - Seconds duration before decay occurs
    /// * `target` - Difficulty target
    /// * `floor_price` - Minimum price.
    /// * `percent_change` - Percent to increment / decrement, 5 = 5%
    #[action]
    fn create(
        initial_price: Quantity,
        window_seconds: u32,
        target: u32,
        floor_price: Quantity,
        percent_change: u8,
    ) -> u32 {
        Difficulty::add(
            initial_price,
            window_seconds,
            target,
            floor_price,
            percent_change,
        )
        .nft_id
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
        Difficulty::get_assert(nft_id).check_price_decrease()
    }

    /// Increment difficulty instance, potentially increasing difficulty
    ///
    /// * Requires holding administration NFT.
    ///
    /// # Arguments
    /// * `nft_id` - Difficulty / NFT ID
    #[action]
    fn increment(nft_id: u32) -> Quantity {
        Difficulty::get_assert(nft_id).increment()
    }

    /// Delete difficulty instance
    ///
    /// * Requires holding administration NFT.
    ///
    /// # Arguments
    /// * `nft_id` - Difficulty / NFT ID
    #[action]
    fn delete(nft_id: u32) {
        Difficulty::get_assert(nft_id).delete()
    }

    #[event(history)]
    pub fn created(nft_id: u32, actor: AccountNumber) {}
}

#[cfg(test)]
mod tests;
