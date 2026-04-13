use psibase::{check, check_none, check_some, AccountNumber, Memo, Table};

use crate::constants::{
    DEFAULT_FRACTAL_DISTRIBUTION_INTERVAL, FRACTAL_STREAM_HALF_LIFE,
    MAX_FRACTAL_DISTRIBUTION_INTERVAL_SECONDS, MIN_FRACTAL_DISTRIBUTION_INTERVAL_SECONDS,
};
use crate::helpers::Stream;
use crate::tables::tables::{RewardStream, RewardStreamTable};

use psibase::services::tokens::{Quantity, TID};
use psibase::services::transact::Wrapper as TransactSvc;

use psibase::services::token_stream::Wrapper as TokenStream;

impl RewardStream {
    fn new(fractal: AccountNumber, token_id: TID) -> Self {
        let now = TransactSvc::call().currentBlock().time.seconds();

        Self {
            stream_id: TokenStream::call().create(FRACTAL_STREAM_HALF_LIFE, token_id),
            dist_interval_secs: DEFAULT_FRACTAL_DISTRIBUTION_INTERVAL,
            last_distributed: now,
            fractal,
        }
    }

    pub fn add(fractal: AccountNumber, token_id: TID) -> Self {
        check_none(Self::get(fractal), "stream already exists");
        let new_instance = Self::new(fractal, token_id);

        new_instance.save();
        new_instance
    }

    pub fn get(fractal: AccountNumber) -> Option<Self> {
        RewardStreamTable::read().get_index_pk().get(&fractal)
    }

    pub fn get_assert(fractal: AccountNumber) -> Self {
        check_some(Self::get(fractal), "reward stream does not exist")
    }

    fn save(&self) {
        RewardStreamTable::read_write()
            .put(&self)
            .expect("failed to save");
    }

    fn stream(&self) -> Stream {
        Stream::new(self.stream_id)
    }

    pub fn deposit(&self, amount: Quantity, memo: Memo) {
        self.stream().deposit(amount, memo);
    }

    pub fn withdraw(&mut self) -> Quantity {
        self.check_can_distribute();
        self.stream().withdraw()
    }

    fn check_can_distribute(&mut self) {
        let now = TransactSvc::call().currentBlock().time.seconds();

        let distribution_interval = self.dist_interval_secs as i64;
        let seconds_elapsed = now.seconds - self.last_distributed.seconds;
        let whole_intervals_elapsed = seconds_elapsed / distribution_interval;

        check(
            whole_intervals_elapsed > 0,
            "must wait for interval period before token distribution",
        );
        let whole_interval_seconds = whole_intervals_elapsed * distribution_interval;
        self.last_distributed = (self.last_distributed.seconds + whole_interval_seconds).into();
        self.save();
    }

    pub fn set_distribution_interval(&mut self, seconds: u32) {
        check(
            seconds >= MIN_FRACTAL_DISTRIBUTION_INTERVAL_SECONDS,
            "distribution interval too short",
        );
        check(
            seconds <= MAX_FRACTAL_DISTRIBUTION_INTERVAL_SECONDS,
            "distribution interval too long",
        );
        self.dist_interval_secs = seconds;
        self.save();
    }
}
