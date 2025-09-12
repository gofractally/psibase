use async_graphql::ComplexObject;
use psibase::{check, check_some, AccountNumber, Table};

use crate::tables::evaluation_instance::EvalType;
use crate::tables::tables::{
    Fractal, FractalTable, Member, MemberTable, Score, Tribute, TributeTable,
};

use psibase::services::token_stream::{self, Stream};
use psibase::services::tokens::{Quantity, Wrapper as Tokens};
use psibase::services::transact::Wrapper as TransactSvc;

use crate::tables::tables::{MemberStatus, StatusU8};

#[ComplexObject]
impl Member {
    pub async fn fractal_details(&self) -> Fractal {
        FractalTable::with_service(crate::Wrapper::SERVICE)
            .get_index_pk()
            .get(&self.fractal)
            .unwrap()
    }
}

impl Member {
    fn new(fractal: AccountNumber, account: AccountNumber, status: MemberStatus) -> Self {
        let now = TransactSvc::call().currentBlock().time.seconds();
        Self {
            account,
            fractal,
            created_at: now,
            member_status: status as StatusU8,
            reward_stream_id: 0,
            referrer: None,
        }
    }

    pub fn add(fractal: AccountNumber, account: AccountNumber, status: MemberStatus) -> Self {
        let new_instance = Self::new(fractal, account, status);
        new_instance.save();

        new_instance.initialize_score(EvalType::Repuation);
        new_instance.initialize_score(EvalType::Favor);

        new_instance
    }

    fn initialize_score(&self, eval_type: EvalType) {
        Score::add(self.fractal, eval_type, self.account);
    }

    pub fn get(fractal: AccountNumber, account: AccountNumber) -> Option<Member> {
        let table = MemberTable::new();
        table.get_index_pk().get(&(fractal, account))
    }

    pub fn get_assert(fractal: AccountNumber, account: AccountNumber) -> Self {
        check_some(Self::get(fractal, account), "member does not exist")
    }

    fn get_or_create_stream(&mut self) -> Stream {
        let fractal = Fractal::get_assert(self.fractal);
        if self.reward_stream_id != 0 {
            if let Some(stream) = token_stream::Wrapper::call().get_stream(self.reward_stream_id) {
                if stream.half_life_seconds == fractal.half_life_seconds {
                    return stream;
                }
            }
        }

        let new_stream_id =
            token_stream::Wrapper::call().create(fractal.half_life_seconds, fractal.token_id);

        self.reward_stream_id = new_stream_id;
        self.save();

        token_stream::Wrapper::call()
            .get_stream(new_stream_id)
            .unwrap()
    }

    pub fn award_stream(&mut self, amount: Quantity) {
        let stream = self.get_or_create_stream();

        Tokens::call().credit(
            Fractal::get_assert(self.fractal).token_id,
            token_stream::SERVICE,
            amount,
            "Award stream".to_string().try_into().unwrap(),
        );
        token_stream::Wrapper::call().deposit(stream.nft_id, amount);
    }

    fn tributes(&self) -> Vec<Tribute> {
        TributeTable::new()
            .get_index_by_fractal_membership()
            .range((self.fractal, self.account, 0)..=(self.fractal, self.account, u32::MAX))
            .collect()
    }

    pub fn claim(&mut self) {
        let stream = check_some(
            token_stream::Wrapper::call().get_stream(self.reward_stream_id),
            "stream does not exist",
        );
        let mut amount = token_stream::Wrapper::call().claim(stream.nft_id);
        check(amount.value > 0, "nothing to claim");
        Tokens::call().debit(
            stream.token_id,
            token_stream::SERVICE,
            amount,
            "Reward claim".to_string().try_into().unwrap(),
        );

        if let Some(fine) = self.fine() {
            let amount_to_pay = Quantity::new(amount.value * fine.rate_ppm as u64 / 1000000);
            amount = amount - amount_to_pay;
        }
        Tokens::call().credit(
            stream.token_id,
            self.account,
            amount,
            "Reward claim".to_string().try_into().unwrap(),
        )
    }

    fn save(&self) {
        MemberTable::new().put(&self).expect("failed to save");
    }
}
