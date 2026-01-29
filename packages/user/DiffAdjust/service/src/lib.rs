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
        pub increase_ppm: u32,
        pub decrease_ppm: u32,
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
            increase_ppm: u32,
            decrease_ppm: u32,
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
                increase_ppm,
                decrease_ppm,
                consumer,
            }
        }

        fn check_ppm_change(ppm: u32) {
            check(
                ppm > 0 && ppm < ONE_MILLION,
                "ppm must be between 0 - 1,000,000",
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
            increase_ppm: u32,
            decrease_ppm: u32,
        ) -> Self {
            let nft_id = Nft::call().mint();
            let sender = get_sender();
            Nft::call().credit(nft_id, sender, "RateLimit administration NFT".into());

            let last_updated =
                TransactSvc::call().currentBlock().time.seconds() + psibase::Seconds::new(1); // See comment in check_difficulty_increase

            Self::check_targets(target_min, target_max);
            Self::check_ppm_change(increase_ppm);
            Self::check_ppm_change(decrease_ppm);
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
                increase_ppm,
                decrease_ppm,
            );
            new_instance.save();

            new_instance
        }

        fn ratio_increase(&self) -> f64 {
            self.increase_ppm as f64 / ONE_MILLION as f64
        }

        fn ratio_decrease(&self) -> f64 {
            self.decrease_ppm as f64 / ONE_MILLION as f64
        }

        pub fn check_difficulty_decrease(&mut self) -> u64 {
            let now = TransactSvc::call().currentBlock().time.seconds();
            let seconds_elapsed = (now.seconds - self.last_update.seconds).max(0) as u32;
            let windows_elapsed = seconds_elapsed / self.window_seconds;
            if windows_elapsed > 0 {
                let below_target = self.counter < self.target_min;
                let seconds_remainder = seconds_elapsed % self.window_seconds;
                self.counter = 0;
                self.last_update = TimePointSec::from(now.seconds - seconds_remainder as i64);
                if below_target {
                    let mut new_difficulty = self.active_difficulty;
                    let factor = 1.0 - self.ratio_decrease();
                    for _ in 0..windows_elapsed {
                        let temp = new_difficulty as f64 * factor;
                        new_difficulty = (temp as u64).max(self.floor_difficulty);
                    }
                    self.active_difficulty = new_difficulty;
                }
            }
            self.active_difficulty
        }

        fn check_difficulty_increase(&mut self, clamp_increase: bool) -> u64 {
            if self.counter > self.target_max {
                let factor = 1.0 + self.ratio_increase();
                let mut times_over_target = self.counter / self.target_max;
                if clamp_increase {
                    times_over_target = times_over_target.min(1);
                }
                let mut difficulty = self.active_difficulty as f64;
                for _ in 0..times_over_target {
                    difficulty = difficulty * factor;
                }
                self.active_difficulty = difficulty.min(u64::MAX as f64) as u64;
                self.counter = 0;
                // The update is happening "mid block", so we round up to the next second. In other words,
                // updates happens at the "end" of the block. Without this, a one-second block window would
                // cause a decrease every block, because an increase zeroes out the counter, so each block
                // would consider a window to have elapsed.
                self.last_update =
                    TransactSvc::call().currentBlock().time.seconds() + psibase::Seconds::new(1);
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
            self.check_difficulty_increase(false);
            self.save();
            difficulty
        }

        pub fn set_window(&mut self, seconds: u32) {
            self.check_sender_has_nft();
            self.check_difficulty_decrease();
            Self::check_window_seconds(seconds);

            self.window_seconds = seconds;
            self.save();
        }

        pub fn set_targets(&mut self, target_min: u32, target_max: u32) {
            self.check_sender_has_nft();
            Self::check_targets(target_min, target_max);
            self.check_difficulty_decrease();
            self.target_min = target_min;
            self.target_max = target_max;
            self.check_difficulty_increase(true);
            self.save();
        }

        pub fn set_ppm(&mut self, increase_ppm: u32, decrease_ppm: u32) {
            self.check_sender_has_nft();
            self.check_difficulty_decrease();
            Self::check_ppm_change(increase_ppm);
            Self::check_ppm_change(decrease_ppm);
            self.increase_ppm = increase_ppm;
            self.decrease_ppm = decrease_ppm;
            self.save();
        }

        pub fn set_floor(&mut self, floor_difficulty: u64) {
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
    /// * `floor_difficulty` - Minimum difficulty
    /// * `increase_ppm` - PPM to increase when over target, e.g. 50000 ppm = 5%
    /// * `decrease_ppm` - PPM to decrease when under target, e.g. 50000 ppm = 5%
    ///
    /// Returns the ID of the NFT that can be used for administration of the rate limit.
    #[action]
    fn create(
        initial_difficulty: u64,
        window_seconds: u32,
        target_min: u32,
        target_max: u32,
        floor_difficulty: u64,
        increase_ppm: u32,
        decrease_ppm: u32,
    ) -> u32 {
        RateLimit::add(
            initial_difficulty,
            window_seconds,
            target_min,
            target_max,
            floor_difficulty,
            increase_ppm,
            decrease_ppm,
        )
        .nft_id
    }

    /// Get RateLimit difficulty
    ///
    /// # Arguments
    /// * `nft_id` - RateLimit / NFT ID
    ///
    /// # Returns
    /// Difficulty of RateLimit
    #[action]
    fn get_diff(nft_id: u32) -> u64 {
        RateLimit::get_assert(nft_id).check_difficulty_decrease()
    }

    /// Increment RateLimit instance, potentially increasing the difficulty.
    ///
    /// The difficulty may increase multiple times if the counter exceeds `target_max`
    ///   by more than one multiple of `target_max`.
    ///
    /// Returns the difficulty before any difficulty adjustment due to the increment.
    ///
    /// * Requires sender to be consumer account.
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
        RateLimit::get_assert(nft_id).set_targets(target_min, target_max);
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
        RateLimit::get_assert(nft_id).set_window(seconds);
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
        RateLimit::get_assert(nft_id).set_floor(difficulty);
    }

    /// Update ppm change
    ///
    /// * Requires holding administration NFT.
    ///
    /// # Arguments
    /// * `nft_id` - RateLimit / NFT ID
    /// * `increase_ppm` - PPM to increase when over target, e.g. 50000 ppm = 5%
    /// * `decrease_ppm` - PPM to decrease when under target, e.g. 50000 ppm = 5%
    #[action]
    fn set_ppm(nft_id: u32, increase_ppm: u32, decrease_ppm: u32) {
        RateLimit::get_assert(nft_id).set_ppm(increase_ppm, decrease_ppm);
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

    /// Get targets
    ///
    /// Gets the minimum and maximum targets for the specified DiffAdjust
    ///
    /// Returns (target_min, target_max)
    #[action]
    fn get_targets(nft_id: u32) -> (u32, u32) {
        let r = RateLimit::get_assert(nft_id);
        (r.target_min, r.target_max)
    }
}

#[cfg(test)]
mod tests;
