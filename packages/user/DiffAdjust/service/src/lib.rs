#[psibase::service_tables]
pub mod tables {
    use psibase::services::nft::Wrapper as Nft;
    use psibase::services::transact::Wrapper as TransactSvc;
    use psibase::{
        check, check_some, get_sender, AccountNumber, Fracpack, Table, TimePointSec, ToSchema,
    };

    use async_graphql::{ComplexObject, SimpleObject};

    use serde::{Deserialize, Serialize};

    #[table(name = "RateLimitTable", index = 0)]
    #[derive(Default, Fracpack, ToSchema, SimpleObject, Serialize, Deserialize, Debug)]
    pub struct RateLimit {
        #[primary_key]
        pub nft_id: u32,
        pub window_seconds: u32,
        pub counter: u32,
        pub target_per_window: u32,
        pub floor_difficulty: u64,
        pub active_difficulty: u64,
        pub last_update: TimePointSec,
        pub percent_change: u32,
        pub consumer: AccountNumber,
    }

    impl RateLimit {
        fn table() -> RateLimitTable {
            RateLimitTable::new()
        }

        pub fn new(
            nft_id: u32,
            consumer: AccountNumber,
            initial_difficulty: u64,
            window_seconds: u32,
            target_per_window: u32,
            floor_difficulty: u64,
            last_update: TimePointSec,
            percent_change: u32,
        ) -> Self {
            Self {
                nft_id,
                active_difficulty: initial_difficulty,
                counter: 0,
                floor_difficulty,
                target_per_window,
                window_seconds,
                last_update,
                percent_change,
                consumer,
            }
        }

        pub fn add(
            initial_difficulty: u64,
            window_seconds: u32,
            target: u32,
            floor_difficulty: u64,
            percent_change: u32,
        ) -> Self {
            let nft_id = Nft::call().mint();
            let sender = get_sender();
            Nft::call().credit(nft_id, sender, "RateLimit administration NFT".to_string());

            let last_updated = TransactSvc::call().currentBlock().time.seconds();

            check(
                percent_change > 0 && percent_change < 1000000,
                "percent must be between 0 - 100%, 500000 = 50%",
            );
            check(window_seconds > 0, "window seconds must be above 0");
            check(target > 0, "target must be above 0");

            let new_instance = Self::new(
                nft_id,
                sender,
                initial_difficulty,
                window_seconds,
                target,
                floor_difficulty,
                last_updated,
                percent_change,
            );
            new_instance.save();

            new_instance
        }

        pub fn check_difficulty_decrease(&mut self) -> u64 {
            let now = TransactSvc::call().currentBlock().time.seconds();
            let seconds_elapsed = (now.seconds - self.last_update.seconds) as u32;
            let windows_elapsed = seconds_elapsed / self.window_seconds;
            if windows_elapsed > 0 {
                let below_target = self.counter < self.target_per_window;
                let seconds_remainder = seconds_elapsed % self.window_seconds;
                self.counter = 0;
                self.last_update = TimePointSec::from(now.seconds - seconds_remainder as i64);
                if below_target {
                    let mut new_difficulty = self.active_difficulty as f64;
                    let factor = 1.0 - (self.percent_change as f64 / 1000000.0);
                    for _ in 0..windows_elapsed {
                        new_difficulty = new_difficulty * factor;
                    }
                    self.active_difficulty = (new_difficulty as u64).max(self.floor_difficulty);
                }
            }
            self.active_difficulty
        }

        fn check_difficulty_increase(&mut self) -> u64 {
            if self.counter > self.target_per_window {
                let percent = 1.0 as f64 + (self.percent_change as f64 / 1000000.0);
                let times_over_target = self.counter / self.target_per_window;
                let mut difficulty = self.active_difficulty as f64;
                for _ in 0..times_over_target {
                    difficulty = difficulty * percent;
                }
                self.active_difficulty = difficulty.min(u64::MAX as f64) as u64;
                self.counter = 0;
                self.last_update = TransactSvc::call().currentBlock().time.seconds();
                self.save();
            }
            self.active_difficulty
        }

        fn check_sender_has_nft(&self) {
            check(
                Nft::call().getNft(self.nft_id).owner == get_sender(),
                "must be owner of rate limiter",
            );
        }

        fn check_sender_is_consumer(&self) {
            check(self.consumer == get_sender(), "must be consumer");
        }

        pub fn increment(&mut self, increment_amount: u32) -> u64 {
            self.check_sender_is_consumer();
            let difficulty = self.check_difficulty_decrease();
            self.counter += increment_amount;
            self.check_difficulty_increase();
            self.save();
            difficulty
        }

        pub fn update_window(&mut self, seconds: u32) {
            self.check_sender_has_nft();
            self.window_seconds = seconds;
            self.save();
        }

        pub fn update_target(&mut self, target: u32) {
            self.check_sender_has_nft();
            self.target_per_window = target;
            self.save();
        }

        pub fn update_floor(&mut self, floor_difficulty: u64) {
            self.check_sender_has_nft();
            self.floor_difficulty = floor_difficulty;
            self.active_difficulty = self.active_difficulty.max(floor_difficulty);
            self.save();
        }

        pub fn delete(&self) {
            self.check_sender_has_nft();
            Self::table().remove(&self);
        }

        fn save(&self) {
            Self::table().put(&self).expect("failed to save");
        }

        pub fn get(nft_id: u32) -> Option<Self> {
            Self::table().get_index_pk().get(&nft_id)
        }

        pub fn get_assert(nft_id: u32) -> Self {
            check_some(Self::get(nft_id), "rate limit of NFT ID does not exist")
        }
    }

    #[ComplexObject]
    impl RateLimit {
        pub async fn admin(&self) -> AccountNumber {
            Nft::call().getNft(self.nft_id).owner
        }
    }
}

#[psibase::service(name = "diff-adjust", tables = "tables")]
pub mod service {
    use crate::tables::RateLimit;

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
        percent_change: u32,
    ) -> u32 {
        RateLimit::add(
            initial_difficulty,
            window_seconds,
            target,
            floor_difficulty,
            percent_change,
        )
        .nft_id
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
        RateLimit::get_assert(nft_id).check_difficulty_decrease()
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
        RateLimit::get_assert(nft_id).increment(amount)
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
        RateLimit::get_assert(nft_id).update_target(target);
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
        RateLimit::get_assert(nft_id).update_window(seconds);
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
        RateLimit::get_assert(nft_id).update_floor(difficulty);
    }

    /// Delete RateLimit instance
    ///
    /// * Requires holding administration NFT.
    ///
    /// # Arguments
    /// * `nft_id` - RateLimit / NFT ID
    #[action]
    fn delete(nft_id: u32) {
        RateLimit::get_assert(nft_id).delete()
    }
}

#[cfg(test)]
mod tests;
