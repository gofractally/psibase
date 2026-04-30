use psibase::{check, check_none, check_some, AccountNumber, Memo, Table};

use crate::constants::{
    DEFAULT_MEMBER_DISTRIBUTION_INTERVAL, FRACTAL_STREAM_HALF_LIFE, MEMBER_STREAM_HALF_LIFE,
};
use crate::tables::tables::{Fractal, Levy, RewardStream, RewardStreamTable};

use psibase::services::tokens::{Quantity, TID};
use psibase::services::transact::Wrapper as TransactSvc;

use psibase::services::token_stream::Wrapper as TokenStream;
use psibase::services::tokens::Wrapper as Tokens;

impl RewardStream {
    fn new(fractal: AccountNumber, owner: AccountNumber, token_id: TID, half_life: u32) -> Self {
        let now = TransactSvc::call().currentBlock().time.seconds();

        Self {
            owner,
            stream_id: TokenStream::call().create(half_life, token_id),
            last_distributed: now,
            fractal,
        }
    }

    fn new_fractal(fractal: AccountNumber, token_id: TID) -> Self {
        Self::new(fractal, fractal, token_id, FRACTAL_STREAM_HALF_LIFE)
    }

    fn new_member(fractal: AccountNumber, owner: AccountNumber, token_id: TID) -> Self {
        Self::new(fractal, owner, token_id, MEMBER_STREAM_HALF_LIFE)
    }

    pub fn add_member(fractal: AccountNumber, owner: AccountNumber, token_id: TID) -> Self {
        check_none(Self::get(fractal, owner), "stream already exists");
        let new_instance = Self::new_member(fractal, owner, token_id);

        new_instance.save();
        new_instance
    }

    pub fn add_fractal(fractal: AccountNumber, token_id: TID) -> Self {
        check_none(Self::get(fractal, fractal), "stream already exists");
        let new_instance = Self::new_fractal(fractal, token_id);

        new_instance.save();
        new_instance
    }

    pub fn claim(&mut self) -> (TID, Quantity) {
        let (token_id, claimed_before_levy_payments) = self.withdraw();
        check(
            claimed_before_levy_payments.value > 0,
            "nothing to withdraw",
        );

        let claimed_after_levy_payments = Levy::levies_of_member(self.fractal, self.owner)
            .into_iter()
            .fold(
                claimed_before_levy_payments,
                |remaining_amount, mut levy| {
                    let levy_paid = levy.apply_levy(claimed_before_levy_payments);
                    remaining_amount - levy_paid
                },
            );

        (token_id, claimed_after_levy_payments)
    }

    fn withdraw(&mut self) -> (TID, Quantity) {
        self.check_can_distribute();

        let claimable = TokenStream::call().claim(self.stream_id);
        let token_id = self.token_id();

        if claimable.value > 0 {
            Tokens::call().debit(
                token_id,
                TokenStream::SERVICE,
                claimable,
                "Reward claim".into(),
            );
        }

        (token_id, claimable)
    }

    pub fn deposit(&self, amount: Quantity, memo: Memo) {
        check(amount.value > 0, "deposit must be greater than 0");
        Tokens::call().credit(self.token_id(), TokenStream::SERVICE, amount, memo);
        TokenStream::call().deposit(self.stream_id, amount);
    }

    pub fn get(fractal: AccountNumber, owner: AccountNumber) -> Option<Self> {
        RewardStreamTable::read()
            .get_index_pk()
            .get(&(fractal, owner))
    }

    pub fn get_assert(fractal: AccountNumber, owner: AccountNumber) -> Self {
        check_some(Self::get(fractal, owner), "reward stream does not exist")
    }

    fn token_id(&self) -> TID {
        TokenStream::call()
            .get_stream(self.stream_id)
            .unwrap()
            .token_id
    }

    fn save(&self) {
        RewardStreamTable::read_write()
            .put(&self)
            .expect("failed to save");
    }

    fn check_can_distribute(&mut self) {
        let now = TransactSvc::call().currentBlock().time.seconds();

        let distribution_interval = if self.fractal == self.owner {
            Fractal::get_assert(self.fractal).dist_interval_secs
        } else {
            DEFAULT_MEMBER_DISTRIBUTION_INTERVAL
        } as i64;
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
}
