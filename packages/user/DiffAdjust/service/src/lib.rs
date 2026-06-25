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

        fn check_targets(target_min: u32, target_max: u32) {
            check(
                target_min <= target_max,
                "target_min must not exceed target_max",
            );
        }

        fn check_window_seconds(seconds: u32) {
            check(seconds > 0, "window seconds must be above 0");
        }

        /// Decrease rate is capped at 100% per window; increase remains unclamped.
        fn clamp_decrease_ppm(decrease_ppm: u32) -> u32 {
            decrease_ppm.min(ONE_MILLION)
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
                Self::clamp_decrease_ppm(decrease_ppm),
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

        /// Caller must ensure the value is finite and positive.
        fn f64_to_u64_saturating(value: f64) -> u64 {
            if value >= u64::MAX as f64 {
                u64::MAX
            } else {
                value as u64
            }
        }

        /// Decay compound math may underflow or yield NaN; treat those as zero (floor applied by caller).
        fn decay_f64_to_u64(value: f64) -> u64 {
            if !value.is_finite() || value <= 0.0 {
                0
            } else {
                Self::f64_to_u64_saturating(value)
            }
        }

        /// Increase compound math may overflow to inf or NaN; saturate rather than collapse to zero.
        fn increase_f64_to_u64(value: f64) -> u64 {
            if !value.is_finite() {
                u64::MAX
            } else {
                Self::f64_to_u64_saturating(value)
            }
        }

        fn apply_increase(difficulty: u64, factor: f64, times: u32) -> u64 {
            if times == 0 || difficulty == u64::MAX || factor <= 1.0 {
                return difficulty;
            }
            // ensure no cast safety of `times` from u32 to i32
            let powered = if times > i32::MAX as u32 {
                f64::INFINITY
            } else {
                factor.powi(times as i32)
            };
            // Large exponents can overflow to inf or NaN on wasm; increases saturate, never collapse to zero.
            if !powered.is_finite() || powered >= u64::MAX as f64 {
                return u64::MAX;
            }
            Self::increase_f64_to_u64(difficulty as f64 * powered)
        }

        fn apply_decrease(mut difficulty: u64, factor: f64, times: u32, floor: u64) -> u64 {
            if times == 0 {
                return difficulty;
            }
            let factor = factor.max(0.0);
            if factor == 0.0 {
                return floor;
            }
            if factor == 1.0 {
                return difficulty;
            }
            // Per-window truncate + floor so batching N windows matches N single-window steps.
            for _ in 0..times {
                difficulty = Self::decay_f64_to_u64(difficulty as f64 * factor).max(floor);
            }
            difficulty
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
                    let factor = 1.0 - self.ratio_decrease();
                    self.active_difficulty = Self::apply_decrease(
                        self.active_difficulty,
                        factor,
                        windows_elapsed,
                        self.floor_difficulty,
                    );
                }
            }
            self.active_difficulty
        }

        fn check_difficulty_increase(&mut self, clamp_increase: bool) -> u64 {
            if self.counter > self.target_max {
                let factor = 1.0 + self.ratio_increase();
                // Number of difficulty adjustments for `counter` events in the window:
                //   - target_max == 0: every event is a adjustment (adjustments = counter)
                //   - target_max == N: floor((counter - 1) / N). The first adjustment requires
                //     N + 1 events; afterward every additional N events adds one adjustment.
                // The remainder is carried in `counter` so the cumulative adjustments over a window
                //   always equal floor((events - 1) / N), independent of how the events were batched across increments.
                let (mut adjustments, remaining_counter) = if self.target_max == 0 {
                    (self.counter, 0)
                } else {
                    let adjustments = (self.counter - 1) / self.target_max;
                    let remaining = (self.counter - 1) % self.target_max + 1;
                    (adjustments, remaining)
                };
                if clamp_increase {
                    adjustments = adjustments.min(1);
                }
                self.active_difficulty =
                    Self::apply_increase(self.active_difficulty, factor, adjustments);
                self.counter = if clamp_increase { 0 } else { remaining_counter };
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
            self.counter = self.counter.saturating_add(increment_amount);
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
            self.increase_ppm = increase_ppm;
            self.decrease_ppm = Self::clamp_decrease_ppm(decrease_ppm);
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

#[psibase::service(name = "diff-adj", tables = "tables")]
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
    /// The number of difficulty adjustments applied for `events` accumulated in the window is
    ///   `floor((events - 1) / target_max)` (or `events` when `target_max == 0`). So the
    ///   first adjustment happens on the `(target_max + 1)`-th event, and every additional
    ///   `target_max` events applies one more adjustment; a single large increment may apply
    ///   multiple adjustments at once.
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
