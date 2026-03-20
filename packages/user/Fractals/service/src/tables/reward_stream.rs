use psibase::{check, check_some, AccountNumber, Memo, Table};

use crate::constants::{
    DEFAULT_FRACTAL_DISTRIBUTION_INTERVAL, MAX_FRACTAL_DISTRIBUTION_INTERVAL_SECONDS,
    MIN_FRACTAL_DISTRIBUTION_INTERVAL_SECONDS, REWARD_STREAM_HALF_LIFE,
};
use crate::tables::tables::{RewardStream, RewardStreamTable};

use psibase::services::tokens::{Quantity, Wrapper as Tokens, TID};
use psibase::services::transact::Wrapper as TransactSvc;

use psibase::services::token_stream::Wrapper as TokenStream;

impl RewardStream {
    fn new(owner: AccountNumber, token_id: TID) -> Self {
        let now = TransactSvc::call().currentBlock().time.seconds();

        Self {
            owner,
            token_id,
            stream_id: TokenStream::call().create(REWARD_STREAM_HALF_LIFE, token_id),
            dist_interval_secs: DEFAULT_FRACTAL_DISTRIBUTION_INTERVAL,
            last_distributed: now,
        }
    }

    pub fn add(owner: AccountNumber, token_id: TID) -> Self {
        let new_instance = Self::new(owner, token_id);

        new_instance.save();
        new_instance
    }

    pub fn get(owner: AccountNumber, token_id: TID) -> Option<Self> {
        RewardStreamTable::read()
            .get_index_pk()
            .get(&(owner, token_id))
    }

    pub fn get_by_stream_id(stream_id: u32) -> Option<Self> {
        RewardStreamTable::read()
            .get_index_by_stream_id()
            .get(&stream_id)
    }

    pub fn get_or_add(owner: AccountNumber, token_id: TID) -> Self {
        RewardStreamTable::read()
            .get_index_pk()
            .get(&(owner, token_id))
            .unwrap_or_else(|| Self::add(owner, token_id))
    }

    pub fn get_assert(owner: AccountNumber, token_id: TID) -> Self {
        check_some(Self::get(owner, token_id), "reward stream does not exist")
    }

    fn save(&self) {
        RewardStreamTable::read_write()
            .put(&self)
            .expect("failed to save");
    }

    pub fn deposit(&self, amount: Quantity, memo: Memo) {
        check(amount.value > 0, "deposit must be greater than 0");
        Tokens::call().credit(self.token_id, TokenStream::SERVICE, amount, memo);
        TokenStream::call().deposit(self.stream_id, amount);
    }

    pub fn withdraw(&mut self) -> Quantity {
        self.check_can_distribute()
            .then(|| self.claim_token_stream())
            .unwrap_or(0.into())
    }

    pub fn withdraw_and_credit_owner(&mut self) {
        let withdrawn = self.withdraw();
        if withdrawn.value > 0 {
            psibase::services::tokens::Wrapper::call().credit(
                self.token_id,
                self.owner,
                withdrawn,
                "Exile reward stream".into(),
            )
        }
    }

    fn check_can_distribute(&mut self) -> bool {
        let now = TransactSvc::call().currentBlock().time.seconds();

        let distribution_interval = self.dist_interval_secs as i64;
        let seconds_elapsed = now.seconds - self.last_distributed.seconds;
        let whole_intervals_elapsed = seconds_elapsed / distribution_interval;

        if whole_intervals_elapsed == 0 {
            return false;
        }
        let whole_interval_seconds = whole_intervals_elapsed * distribution_interval;
        self.last_distributed = (self.last_distributed.seconds + whole_interval_seconds).into();
        self.save();
        return true;
    }

    fn claim_token_stream(&self) -> Quantity {
        let claimable = TokenStream::call().claim(self.stream_id);

        Tokens::call().debit(
            self.token_id,
            TokenStream::SERVICE,
            claimable,
            "Reward claim".into(),
        );

        claimable
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
