#[psibase::service_tables]
pub mod tables {
    use psibase::services::nft::Wrapper as Nft;
    use psibase::services::transact::Wrapper as TransactSvc;
    use psibase::{
        check, check_some, get_sender, AccountNumber, Fracpack, Table, TimePointSec, ToSchema,
    };

    use async_graphql::{ComplexObject, SimpleObject};

    use serde::{Deserialize, Serialize};

    const ONE_MILLION: u32 = 1_000_000;

    #[table(name = "RateLimitTable", index = 0)]
    #[derive(Default, Fracpack, ToSchema, SimpleObject, Serialize, Deserialize, Debug)]
    pub struct RateLimit {
        #[primary_key]
        pub nft_id: u32,
        pub window_seconds: u32,
        pub counter: u32,
        pub target_min: u32,
        pub target_max: u32,
        pub floor_difficulty: u64,
        pub active_difficulty: u64,
        pub last_update: TimePointSec,
        pub percent_change: u32,
        pub consumer: AccountNumber,
    }

    impl RateLimit {
        fn new(
            nft_id: u32,
            consumer: AccountNumber,
            initial_difficulty: u64,
            window_seconds: u32,
            target_min: u32,
            target_max: u32,
            floor_difficulty: u64,
            last_update: TimePointSec,
            percent_change: u32,
        ) -> Self {
            Self {
                nft_id,
                active_difficulty: initial_difficulty,
                counter: 0,
                floor_difficulty,
                target_min,
                target_max,
                window_seconds,
                last_update,
                percent_change,
                consumer,
            }
        }

        fn check_percent_change(ppm: u32) {
            check(
                ppm > 0 && ppm < ONE_MILLION,
                "percent must be between 0 - 100%, 500000 = 50%",
            );
        }

        fn check_targets(target_min: u32, target_max: u32) {
            check(target_min > 0, "target_min must be above 0");
            check(target_max > 0, "target_max must be above 0");
            check(
                target_min <= target_max,
                "target_min must not exceed target_max",
            );
        }

        fn check_window_seconds(seconds: u32) {
            check(seconds > 0, "window seconds must be above 0");
        }

        pub fn add(
            initial_difficulty: u64,
            window_seconds: u32,
            target_min: u32,
            target_max: u32,
            floor_difficulty: u64,
            percent_change: u32,
        ) -> Self {
            let nft_id = Nft::call().mint();
            let sender = get_sender();
            Nft::call().credit(nft_id, sender, "RateLimit administration NFT".to_string());

            let last_updated = TransactSvc::call().currentBlock().time.seconds();

            Self::check_targets(target_min, target_max);
            Self::check_percent_change(percent_change);
            Self::check_window_seconds(window_seconds);

            let new_instance = Self::new(
                nft_id,
                sender,
                initial_difficulty,
                window_seconds,
                target_min,
                target_max,
                floor_difficulty,
                last_updated,
                percent_change,
            );
            new_instance.save();

            new_instance
        }

        fn percent(&self) -> f64 {
            self.percent_change as f64 / ONE_MILLION as f64
        }

        pub fn check_difficulty_decrease(&mut self) -> u64 {
            let now = TransactSvc::call().currentBlock().time.seconds();
            let seconds_elapsed = (now.seconds - self.last_update.seconds) as u32;
            let windows_elapsed = seconds_elapsed / self.window_seconds;
            if windows_elapsed > 0 {
                let below_target = self.counter < self.target_min;
                let seconds_remainder = seconds_elapsed % self.window_seconds;
                self.counter = 0;
                self.last_update = TimePointSec::from(now.seconds - seconds_remainder as i64);
                if below_target {
                    let mut new_difficulty = self.active_difficulty as f64;
                    let factor = 1.0 - self.percent();
                    for _ in 0..windows_elapsed {
                        new_difficulty = new_difficulty * factor;
                    }
                    self.active_difficulty = (new_difficulty as u64).max(self.floor_difficulty);
                }
            }
            self.active_difficulty
        }

        fn check_difficulty_increase(&mut self) -> u64 {
            if self.counter > self.target_max {
                let percent = 1.0 + self.percent();
                let times_over_target = self.counter / self.target_max;
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
            self.check_difficulty_decrease();
            Self::check_window_seconds(seconds);

            self.window_seconds = seconds;
            self.save();
        }

        pub fn update_targets(&mut self, target_min: u32, target_max: u32) {
            self.check_sender_has_nft();
            Self::check_targets(target_min, target_max);
            self.check_difficulty_decrease();
            self.target_min = target_min;
            self.target_max = target_max;
            self.save();
        }

        pub fn update_percent(&mut self, percent_ppm: u32) {
            self.check_sender_has_nft();
            self.check_difficulty_decrease();
            Self::check_percent_change(percent_ppm);
            self.percent_change = percent_ppm;
            self.save();
        }

        pub fn update_floor(&mut self, floor_difficulty: u64) {
            self.check_sender_has_nft();
            self.check_difficulty_decrease();
            self.floor_difficulty = floor_difficulty;
            self.active_difficulty = self.active_difficulty.max(floor_difficulty);
            self.save();
        }

        pub fn delete(&self) {
            self.check_sender_has_nft();
            RateLimitTable::read_write().remove(&self);
        }

        fn save(&self) {
            RateLimitTable::read_write()
                .put(&self)
                .expect("failed to save");
        }

        pub fn get(nft_id: u32) -> Option<Self> {
            RateLimitTable::read().get_index_pk().get(&nft_id)
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
        RateLimit::add(
            initial_difficulty,
            window_seconds,
            target_min,
            target_max,
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
        RateLimit::get_assert(nft_id).update_targets(target_min, target_max);
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
    fn set_floor(nft_id: u32, difficulty: u64) {
        RateLimit::get_assert(nft_id).update_floor(difficulty);
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
        RateLimit::get_assert(nft_id).update_percent(ppm);
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
