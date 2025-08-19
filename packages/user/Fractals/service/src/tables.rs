#[psibase::service_tables]
pub mod tables {
    use std::str::FromStr;
    use std::u64;

    use async_graphql::{ComplexObject, SimpleObject};
    use psibase::services::tokens::Memo;
    use psibase::services::transact::Wrapper as TransactSvc;
    use psibase::{
        abort_message, check_some, get_service, services, AccountNumber, Fracpack, Table,
        TimePointSec, ToSchema,
    };

    use evaluations::service::{Evaluation, EvaluationTable, User, UserTable};

    use serde::{Deserialize, Serialize};

    use crate::helpers::parse_rank_to_accounts;
    use crate::scoring::{calculate_ema_u32, Fraction};

    #[table(name = "FractalTable", index = 0)]
    #[derive(Default, Fracpack, ToSchema, SimpleObject, Serialize, Deserialize, Debug)]
    #[graphql(complex)]
    pub struct Fractal {
        pub account: AccountNumber,
        pub created_at: TimePointSec,
        pub name: String,
        pub mission: String,
        pub token_id: u32,
        pub decay_rate_ppm: u64,
    }

    impl Fractal {
        #[primary_key]
        fn pk(&self) -> AccountNumber {
            self.account
        }

        fn new(account: AccountNumber, name: String, mission: String) -> Self {
            let now = TransactSvc::call().currentBlock().time.seconds();
            let max_supply = services::tokens::Decimal::from_str("21000000.0000").unwrap();
            let mut fractal = Self {
                account,
                created_at: now,
                mission,
                name,
                decay_rate_ppm: 0,
                token_id: services::tokens::Wrapper::call()
                    .create(max_supply.precision(), max_supply.quantity()),
            };
            fractal.set_half_life(30 * 86_400); // Default 30-day half-life
            fractal
        }

        pub fn add(account: AccountNumber, name: String, mission: String) {
            Self::new(account, name, mission).save();
        }

        pub fn get(fractal: AccountNumber) -> Option<Self> {
            let table = FractalTable::new();
            table.get_index_pk().get(&(fractal))
        }

        pub fn get_assert(fractal: AccountNumber) -> Self {
            check_some(Self::get(fractal), "fractal does not exist")
        }

        fn save(&self) {
            let table = FractalTable::new();
            table.put(&self).expect("failed to save");
        }

        pub fn members(&self) -> Vec<Member> {
            let table = MemberTable::new();
            table
                .get_index_pk()
                .range(
                    (self.account, AccountNumber::new(0))
                        ..=(self.account, AccountNumber::new(u64::MAX)),
                )
                .collect()
        }

        pub fn set_half_life(&mut self, seconds: u64) {
            let buckets: Vec<Bucket> = BucketTable::new()
                .get_index_pk()
                .range(
                    (self.account, AccountNumber::new(0))
                        ..=(self.account, AccountNumber::new(u64::MAX)),
                )
                .collect();

            buckets.into_iter().for_each(|mut bucket| {
                bucket.settle();
            });
            let denominator = seconds as u128;
            if denominator >= Bucket::PPT {
                abort_message("half-life too large");
            }
            self.decay_rate_ppm = (Bucket::PPT / denominator) as u64;
            self.save();
        }

        pub fn set_schedule(
            &self,
            eval_type: EvalType,
            registration: u32,
            deliberation: u32,
            submission: u32,
            finish_by: u32,
            interval_seconds: u32,
        ) {
            EvaluationInstance::set_evaluation_schedule(
                self.account,
                eval_type,
                registration,
                deliberation,
                submission,
                finish_by,
                interval_seconds,
            )
        }
    }

    #[ComplexObject]
    impl Fractal {
        pub async fn council(&self) -> Vec<AccountNumber> {
            vec![psibase::services::auth_delegate::Wrapper::call().getOwner(self.account)]
        }
    }

    #[derive(PartialEq)]
    pub enum MemberStatus {
        Visa = 1,
        Citizen = 2,
        Exiled = 3,
    }

    pub type StatusU8 = u8;

    impl From<StatusU8> for MemberStatus {
        fn from(status: StatusU8) -> Self {
            match status {
                1 => MemberStatus::Visa,
                2 => MemberStatus::Citizen,
                3 => MemberStatus::Exiled,
                _ => abort_message("invalid member status"),
            }
        }
    }

    #[table(name = "MemberTable", index = 1)]
    #[derive(Default, Fracpack, ToSchema, SimpleObject, Serialize, Deserialize, Debug)]
    #[graphql(complex)]
    pub struct Member {
        pub fractal: AccountNumber,
        pub account: AccountNumber,
        pub created_at: psibase::TimePointSec,
        pub member_status: StatusU8,
    }

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
        #[primary_key]
        fn pk(&self) -> (AccountNumber, AccountNumber) {
            (self.fractal, self.account)
        }

        #[secondary_key(1)]
        fn by_member(&self) -> (AccountNumber, AccountNumber) {
            (self.account, self.fractal)
        }

        fn new(fractal: AccountNumber, account: AccountNumber, status: MemberStatus) -> Self {
            let now = TransactSvc::call().currentBlock().time.seconds();
            Self {
                account,
                fractal,
                created_at: now,
                member_status: status as StatusU8,
            }
        }

        pub fn add(fractal: AccountNumber, account: AccountNumber, status: MemberStatus) -> Self {
            let new_instance = Self::new(fractal, account, status);
            new_instance.save();

            new_instance.initialize_score(EvalType::Repuation);
            new_instance.initialize_score(EvalType::Favor);

            new_instance
        }

        pub fn initialize_score(&self, eval_type: EvalType) {
            Score::add(self.fractal, eval_type, self.account);
        }

        pub fn get(fractal: AccountNumber, account: AccountNumber) -> Option<Member> {
            let table = MemberTable::new();
            table.get_index_pk().get(&(fractal, account))
        }

        pub fn get_assert(fractal: AccountNumber, account: AccountNumber) -> Self {
            check_some(Self::get(fractal, account), "member does not exist")
        }

        fn save(&self) {
            let table = MemberTable::new();
            table.put(&self).expect("failed to save");
        }
    }

    #[derive(PartialEq, Clone)]
    pub enum EvalType {
        Repuation = 1,
        Favor = 2,
    }

    pub type EvalTypeU8 = u8;

    impl From<EvalTypeU8> for EvalType {
        fn from(eval_type: EvalTypeU8) -> Self {
            match eval_type {
                1 => EvalType::Repuation,
                2 => EvalType::Favor,
                _ => abort_message("invalid evaluation type"),
            }
        }
    }

    impl From<EvalType> for u8 {
        fn from(eval_type: EvalType) -> u8 {
            eval_type as u8
        }
    }

    #[table(name = "EvaluationInstanceTable", index = 2)]
    #[derive(Default, Fracpack, ToSchema, SimpleObject, Serialize, Deserialize, Debug)]
    pub struct EvaluationInstance {
        pub fractal: AccountNumber,
        pub eval_type: EvalTypeU8,
        pub interval: u32,
        pub evaluation_id: u32,
    }

    impl EvaluationInstance {
        #[primary_key]
        fn pk(&self) -> (AccountNumber, EvalTypeU8) {
            (self.fractal, self.eval_type)
        }

        #[secondary_key(1)]
        pub fn by_evaluation(&self) -> u32 {
            self.evaluation_id
        }

        fn get(fractal: AccountNumber, eval_type: EvalType) -> Option<Self> {
            let table = EvaluationInstanceTable::new();
            table.get_index_pk().get(&(fractal, eval_type.into()))
        }

        pub fn get_assert(fractal: AccountNumber, eval_type: EvalType) -> Self {
            check_some(
                Self::get(fractal, eval_type),
                "failed to find evaluation instance",
            )
        }

        fn new(
            fractal: AccountNumber,
            eval_type: EvalType,
            interval: u32,
            evaluation_id: u32,
        ) -> Self {
            Self {
                eval_type: eval_type.into(),
                evaluation_id,
                fractal,
                interval,
            }
        }

        fn add(
            fractal: AccountNumber,
            eval_type: EvalType,
            interval: u32,
            evaluation_id: u32,
        ) -> Self {
            let instance = Self::new(fractal, eval_type, interval, evaluation_id);
            instance.save();
            instance
        }

        pub fn get_by_evaluation_id(eval_id: u32) -> Self {
            let table = EvaluationInstanceTable::new();

            check_some(
                table.get_index_by_evaluation().get(&eval_id),
                "failed finding by eval id",
            )
        }

        fn internal(&self) -> Option<Evaluation> {
            EvaluationTable::with_service(evaluations::SERVICE)
                .get_index_pk()
                .get(&(get_service(), self.evaluation_id))
        }

        pub fn users(&self, group_number: Option<u32>) -> Option<Vec<User>> {
            let fractals_service = get_service();
            let evaluation_id = self.evaluation_id;

            let res = match group_number {
                Some(group_number) => UserTable::with_service(evaluations::SERVICE)
                    .get_index_by_group()
                    .range(
                        (
                            fractals_service,
                            evaluation_id,
                            Some(group_number),
                            AccountNumber::new(0),
                        )
                            ..=(
                                fractals_service,
                                evaluation_id,
                                Some(group_number),
                                AccountNumber::new(u64::MAX),
                            ),
                    )
                    .collect(),
                None => UserTable::with_service(evaluations::SERVICE)
                    .get_index_pk()
                    .range(
                        (fractals_service, evaluation_id, AccountNumber::new(0))
                            ..=(
                                fractals_service,
                                evaluation_id,
                                AccountNumber::new(u64::MAX),
                            ),
                    )
                    .collect(),
            };

            Some(res)
        }

        fn create_evaluation(
            fractal: AccountNumber,
            eval_type: EvalType,
            registration: u32,
            deliberation: u32,
            submission: u32,
            finish_by: u32,
            interval_seconds: u32,
        ) {
            let evaluation_id: u32 = psibase::services::evaluations::Wrapper::call().create(
                registration,
                deliberation,
                submission,
                finish_by,
                vec![2, 3, 4, 5, 6],
                6,
                true,
            );

            Self::add(fractal, eval_type, interval_seconds, evaluation_id);

            crate::Wrapper::emit().history().scheduled_evaluation(
                fractal,
                evaluation_id,
                registration,
                deliberation,
                submission,
                finish_by,
            );
        }

        pub fn schedule_next_evaluation(&mut self) {
            let interval = self.interval;

            let evaluation = check_some(
                self.internal(),
                "expected existing evaluation to set the next one",
            );

            Self::create_evaluation(
                self.fractal,
                self.eval_type.into(),
                evaluation.registration_starts + interval,
                evaluation.deliberation_starts + interval,
                evaluation.submission_starts + interval,
                evaluation.finish_by + interval,
                interval,
            );
        }

        pub fn set_evaluation_schedule(
            fractal: AccountNumber,
            eval_type: EvalType,
            registration: u32,
            deliberation: u32,
            submission: u32,
            finish_by: u32,
            interval_seconds: u32,
        ) {
            Self::get(fractal, eval_type.clone()).map(|existing| {
                psibase::services::evaluations::Wrapper::call()
                    .delete(existing.evaluation_id, false);
            });

            Self::create_evaluation(
                fractal,
                eval_type,
                registration,
                deliberation,
                submission,
                finish_by,
                interval_seconds,
            );
        }

        fn save(&self) {
            let table = EvaluationInstanceTable::new();
            table.put(&self).expect("failed to save");
        }

        fn scores(&self) -> Vec<Score> {
            let table = ScoreTable::new();

            table
                .get_index_pk()
                .range(
                    (self.fractal, AccountNumber::from(0), self.eval_type)
                        ..=(self.fractal, AccountNumber::from(u64::MAX), self.eval_type),
                )
                .collect()
        }

        pub fn set_pending_scores(&self, pending_score: u32) {
            self.scores().into_iter().for_each(|mut account| {
                account.set_pending_score(pending_score);
            });
        }

        pub fn award_group_scores(&self, group_number: u32, vanilla_group_result: Vec<u8>) {
            let group_members = self.users(Some(group_number)).unwrap();

            let fractal_group_result = parse_rank_to_accounts(
                vanilla_group_result,
                group_members.into_iter().map(|user| user.user).collect(),
            );

            for (index, account) in fractal_group_result.into_iter().enumerate() {
                let level = (6 as usize) - index;
                Score::get_assert(self.fractal, self.eval_type.into(), account)
                    .set_pending_score(level as u32);
            }
        }

        pub fn save_pending_scores(&self) {
            self.scores().into_iter().for_each(|mut account| {
                account.save_pending_score();
            });
        }
    }

    #[table(name = "ScoreTable", index = 3)]
    #[derive(Default, Fracpack, ToSchema, SimpleObject, Serialize, Deserialize, Debug)]
    pub struct Score {
        pub fractal: AccountNumber,
        pub account: AccountNumber,
        pub eval_type: EvalTypeU8,
        pub value: u32,
        pub pending: Option<u32>,
    }

    impl Score {
        #[primary_key]
        fn pk(&self) -> (AccountNumber, AccountNumber, EvalTypeU8) {
            (self.fractal, self.account, self.eval_type)
        }

        pub fn get_assert(
            fractal: AccountNumber,
            eval_type: EvalType,
            account: AccountNumber,
        ) -> Self {
            let table = ScoreTable::new();
            check_some(
                table
                    .get_index_pk()
                    .get(&(fractal, account, eval_type.into())),
                "failed to find score",
            )
        }

        fn new(fractal: AccountNumber, eval_type: EvalType, account: AccountNumber) -> Self {
            Self {
                account,
                eval_type: eval_type.into(),
                fractal,
                value: 0,
                pending: None,
            }
        }

        pub fn add(fractal: AccountNumber, eval_type: EvalType, account: AccountNumber) -> Self {
            let new_instance = Self::new(fractal, eval_type, account);
            new_instance.save();
            new_instance
        }

        pub fn set_pending_score(&mut self, incoming_score: u32) {
            self.pending = Some(incoming_score * 10000);
            self.save();
        }

        pub fn save_pending_score(&mut self) {
            self.pending.take().map(|pending_score| {
                self.value = calculate_ema_u32(pending_score, self.value, Fraction::new(1, 6));
                self.save();
            });
        }

        fn save(&self) {
            let table = ScoreTable::new();
            table.put(&self).expect("failed to save score");
        }
    }

    #[table(name = "BucketTable", index = 4)]
    #[derive(Default, Fracpack, ToSchema, SimpleObject, Serialize, Deserialize, Debug)]
    pub struct Bucket {
        pub fractal: AccountNumber,
        pub account: AccountNumber,
        pub total_deposited: u64,
        pub total_claimed: u64,
        pub last_update_principal: u64,
        pub last_update_timestamp: TimePointSec,
    }

    impl Bucket {
        const PPT: u128 = 1_000_000_000_000; // Parts per trillion

        #[primary_key]
        fn pk(&self) -> (AccountNumber, AccountNumber) {
            (self.fractal, self.account)
        }

        pub fn get(fractal: AccountNumber, account: AccountNumber) -> Option<Self> {
            let table = BucketTable::new();
            table.get_index_pk().get(&(fractal, account))
        }

        pub fn get_or_new(fractal: AccountNumber, account: AccountNumber) -> Self {
            Self::get(fractal, account).unwrap_or(Self {
                fractal,
                account,
                total_claimed: 0,
                total_deposited: 0,
                last_update_principal: 0,
                last_update_timestamp: TimePointSec::from(0),
            })
        }

        pub fn get_assert(fractal: AccountNumber, account: AccountNumber) -> Self {
            check_some(Self::get(fractal, account), "bucket does not exist")
        }

        fn decay_rate_ppm(&self) -> u128 {
            Fractal::get_assert(self.fractal).decay_rate_ppm as u128
        }

        fn balance_still_vesting(&self) -> u64 {
            if self.last_update_principal == 0 {
                return 0;
            }
            let now = TransactSvc::call().currentBlock().time.seconds();
            let delta = now
                .seconds
                .saturating_sub(self.last_update_timestamp.seconds) as u64;
            let lambda_t = self.decay_rate_ppm() * (delta as u128);
            let denominator = Self::PPT.saturating_add(lambda_t);
            ((self.last_update_principal as u128) * Self::PPT / denominator) as u64
        }

        fn total_vested(&self) -> u64 {
            self.total_deposited
                .saturating_sub(self.balance_still_vesting())
        }

        fn balance_claimable(&self) -> u64 {
            self.total_vested().saturating_sub(self.total_claimed)
        }

        pub fn deposit(&mut self, amount: u64) {
            let principal_now = self.settle();
            self.last_update_principal = principal_now.saturating_add(amount);
            self.total_deposited = self.total_deposited.saturating_add(amount);
        }

        fn settle(&mut self) -> u64 {
            let time_now = TransactSvc::call().currentBlock().time.seconds();
            let principal_now = self.balance_still_vesting();
            self.last_update_principal = principal_now;
            self.last_update_timestamp = time_now;
            principal_now
        }

        pub fn claim(&mut self) {
            let principal_now = self.settle();
            let amount = self
                .total_deposited
                .saturating_sub(self.total_claimed)
                .saturating_sub(principal_now);
            self.total_claimed = self.total_claimed.saturating_add(amount);
            psibase::services::tokens::Wrapper::call().credit(
                Fractal::get_assert(self.fractal).token_id,
                self.account,
                amount.into(),
                Memo::try_from("Fractal reward".to_string()).unwrap(),
            )
        }
    }

    #[ComplexObject]
    impl Bucket {
        pub async fn balance_claimable_amount(&self) -> u64 {
            self.balance_claimable()
        }

        pub async fn total_vested_amount(&self) -> u64 {
            self.total_vested()
        }

        pub async fn balance_still_vesting_amount(&self) -> u64 {
            self.balance_still_vesting()
        }
    }
}
