#[psibase::service_tables]
pub mod tables {
    use std::u64;

    use async_graphql::SimpleObject;
    use psibase::services::transact::Wrapper as TransactSvc;
    use psibase::{
        abort_message, check_some, get_service, AccountNumber, Fracpack, Pack, Table, TimePointSec,
        ToKey, ToSchema,
    };

    use evaluations::service::{Evaluation, EvaluationTable, User, UserTable};

    use serde::{Deserialize, Serialize};

    use crate::helpers::parse_rank_to_accounts;
    use crate::scoring::calculate_ema;
    use crate::Wrapper;

    #[table(name = "FractalTable", index = 0)]
    #[derive(Default, Fracpack, ToSchema, SimpleObject, Serialize, Deserialize, Debug)]
    pub struct Fractal {
        pub account: AccountNumber,
        pub created_at: TimePointSec,
        pub name: String,
        pub mission: String,

        pub reward_wait_period: u32,
    }

    impl Fractal {
        #[primary_key]
        fn pk(&self) -> AccountNumber {
            self.account
        }

        fn new(account: AccountNumber, name: String, mission: String) -> Self {
            let now = TransactSvc::call().currentBlock().time.seconds();

            Self {
                account,
                created_at: now,
                mission,
                name,
                reward_wait_period: 86400 * 7 * 1,
            }
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

        pub fn save(&self) {
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
    }

    #[derive(PartialEq)]
    pub enum MemberStatus {
        Visa = 1,
        Citizen = 2,
        Exiled = 3,
    }

    pub type StatusU32 = u32;

    impl From<StatusU32> for MemberStatus {
        fn from(status: StatusU32) -> Self {
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
    pub struct Member {
        pub fractal: AccountNumber,
        pub account: AccountNumber,
        pub created_at: psibase::TimePointSec,
        pub member_status: StatusU32,

        pub reward_balance: u64,
        pub reward_start_time: psibase::TimePointSec,
        pub reward_wait: u32,
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
                member_status: status as StatusU32,
                reward_balance: 0,
                reward_start_time: now,
                reward_wait: 0,
            }
        }

        fn deposit(&mut self, amount: u64) {
            psibase::check(amount > 0, "amount must be greater than 0");

            let current_time = TransactSvc::call().currentBlock().time.seconds();

            let elapsed = if current_time.seconds >= self.reward_start_time.seconds {
                (current_time.seconds - self.reward_start_time.seconds) as u64
            } else {
                0
            };

            let original_balance = self.reward_balance;
            let new_balance = original_balance.saturating_add(amount);

            let reward_wait_period = Fractal::get_assert(self.fractal).reward_wait_period;

            let remaining_waiting =
                reward_wait_period as u64 - elapsed.min(reward_wait_period as u64);

            let weight_original = if new_balance == 0 {
                0.0
            } else {
                original_balance as f64 / new_balance as f64
            };
            let weight_new = if new_balance == 0 {
                0.0
            } else {
                amount as f64 / new_balance as f64
            };

            let new_period = if original_balance == 0 {
                reward_wait_period as f64
            } else {
                (weight_original * remaining_waiting as f64)
                    + (weight_new * reward_wait_period as f64)
            };

            self.reward_wait = new_period.ceil().min(u32::MAX as f64) as u32;
            self.reward_balance = new_balance;
            self.save();
        }

        fn withdrawable_amount(&self) -> u64 {
            let current_time = TransactSvc::call().currentBlock().time.seconds();
            if current_time.seconds < self.reward_start_time.seconds {
                return 0;
            }

            let elasped = if current_time.seconds >= self.reward_start_time.seconds {
                (current_time.seconds - self.reward_start_time.seconds) as u32
            } else {
                0
            };

            if elasped >= self.reward_wait {
                self.reward_balance
            } else {
                let percent_waited = (elasped as f64) / (self.reward_wait as f64);
                let withdrawable_amount = percent_waited * (self.reward_balance as f64).floor();
                withdrawable_amount as u64
            }
        }

        fn withdraw(mut self) {
            let current_time = TransactSvc::call().currentBlock().time.seconds();

            let withdrawable = self.withdrawable_amount();
            if withdrawable == 0 {
                abort_message("nothing to withdraw");
            }

            self.reward_balance = self.reward_balance.saturating_sub(withdrawable);
            self.reward_start_time = current_time;

            let reward_wait_period = Fractal::get_assert(self.fractal).reward_wait_period;

            self.reward_wait = if self.reward_balance == 0 {
                reward_wait_period
            } else {
                let original_balance = self.reward_balance + withdrawable;
                let new_period = if original_balance == 0 {
                    reward_wait_period as f64
                } else {
                    (self.reward_wait as f64 * self.reward_balance as f64) / original_balance as f64
                };
                new_period.ceil() as u32
            };

            self.save();
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

        pub fn save(&self) {
            let table = MemberTable::new();
            table.put(&self).expect("failed to save");
        }
    }

    #[derive(PartialEq, Clone)]
    pub enum EvalType {
        Repuation = 1,
        Favor = 2,
    }

    pub type EvalTypeU32 = u32;

    impl From<EvalTypeU32> for EvalType {
        fn from(eval_type: EvalTypeU32) -> Self {
            match eval_type {
                1 => EvalType::Repuation,
                2 => EvalType::Favor,
                _ => abort_message("invalid evaluation type"),
            }
        }
    }

    impl From<EvalType> for u32 {
        fn from(eval_type: EvalType) -> u32 {
            eval_type as u32
        }
    }

    #[table(name = "EvaluationInstanceTable", index = 2)]
    #[derive(Default, Fracpack, ToSchema, SimpleObject, Serialize, Deserialize, Debug)]
    pub struct EvaluationInstance {
        pub fractal: AccountNumber,
        pub eval_type: EvalTypeU32,
        pub interval: u32,
        pub evaluation_id: Option<u32>,
    }

    impl EvaluationInstance {
        #[primary_key]
        fn pk(&self) -> (AccountNumber, EvalTypeU32) {
            (self.fractal, self.eval_type)
        }

        #[secondary_key(1)]
        pub fn by_evaluation(&self) -> (Option<u32>, EvalTypeU32, AccountNumber) {
            (self.evaluation_id, self.eval_type, self.fractal)
        }

        pub fn get(fractal: AccountNumber, eval_type: EvalType) -> Option<Self> {
            let table = EvaluationInstanceTable::new();
            table.get_index_pk().get(&(fractal, eval_type.into()))
        }

        pub fn get_assert(fractal: AccountNumber, eval_type: EvalType) -> Self {
            check_some(
                Self::get(fractal, eval_type),
                "failed to find evaluation instance",
            )
        }

        fn new(fractal: AccountNumber, eval_type: EvalType, interval: u32) -> Self {
            Self {
                eval_type: eval_type.into(),
                evaluation_id: None,
                fractal,
                interval,
            }
        }

        pub fn add(fractal: AccountNumber, eval_type: EvalType, interval: u32) -> Self {
            Self::new(fractal, eval_type, interval)
        }

        pub fn get_or_create(fractal: AccountNumber, eval_type: EvalType, interval: u32) -> Self {
            Self::get(fractal, eval_type.clone().into())
                .unwrap_or_else(|| Self::add(fractal, eval_type, interval))
        }

        pub fn get_by_evaluation_id(eval_id: u32) -> Self {
            // TODO: Fix this

            let table = EvaluationInstanceTable::new();
            let vec: Vec<EvaluationInstance> = table
                .get_index_by_evaluation()
                .range(
                    (Some(eval_id), 0, AccountNumber::new(0))
                        ..=(Some(eval_id), u32::MAX, AccountNumber::new(u64::MAX)),
                )
                .collect();

            check_some(
                vec.into_iter()
                    .find(|evaluation| evaluation.evaluation_id.is_some_and(|id| eval_id == id)),
                "failed finding evaluation by id",
            )
        }

        fn internal(&self) -> Option<Evaluation> {
            EvaluationTable::with_service(evaluations::SERVICE)
                .get_index_pk()
                .get(&(
                    get_service(),
                    psibase::check_some(self.evaluation_id, "no secheduled eval"),
                ))
        }

        pub fn users(&self, group_number: Option<u32>) -> Option<Vec<User>> {
            let fractals_service = get_service();
            let evaluation_id = check_some(self.evaluation_id, "no scheduled evaluation");

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
            &mut self,
            registration: u32,
            deliberation: u32,
            submission: u32,
            finish_by: u32,
            interval_seconds: u32,
        ) {
            let eval_id: u32 = psibase::services::evaluations::Wrapper::call().create(
                registration,
                deliberation,
                submission,
                finish_by,
                // TODO: Change back to 4,5,6;
                vec![2, 3, 4, 5, 6],
                6,
                true,
            );

            self.evaluation_id = Some(eval_id);
            self.interval = interval_seconds;
            self.save();

            crate::Wrapper::emit().history().scheduled_evaluation(
                self.fractal,
                eval_id,
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

            let old_evaluation_id = self.evaluation_id.unwrap().clone();

            self.create_evaluation(
                evaluation.registration_starts + interval,
                evaluation.deliberation_starts + interval,
                evaluation.submission_starts + interval,
                evaluation.finish_by + interval,
                interval,
            );

            psibase::services::evaluations::Wrapper::call().close(get_service(), old_evaluation_id);
        }

        pub fn set_evaluation_schedule(
            &mut self,
            registration: u32,
            deliberation: u32,
            submission: u32,
            finish_by: u32,
            interval_seconds: u32,
            force_delete: bool,
        ) {
            if self.evaluation_id.is_some() {
                psibase::services::evaluations::Wrapper::call()
                    .delete(self.evaluation_id.unwrap(), force_delete);
            };

            self.create_evaluation(
                registration,
                deliberation,
                submission,
                finish_by,
                interval_seconds,
            );
        }

        pub fn save(&self) {
            let table = EvaluationInstanceTable::new();
            table.put(&self).expect("failed to save");
        }

        fn scores(&self) -> Vec<Score> {
            let table = ScoreTable::new();

            table
                .get_index_pk()
                .range(
                    (self.fractal, self.eval_type, AccountNumber::from(0))
                        ..=(self.fractal, self.eval_type, AccountNumber::from(u64::MAX)),
                )
                .collect()
        }

        pub fn set_pending_scores(&self, pending_score: f32) {
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
                Score::get(self.fractal, self.eval_type.into(), account)
                    .set_pending_score(level as f32);
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
        pub eval_type: EvalTypeU32,
        pub value: f32,
        pub pending: Option<f32>,
    }

    impl Score {
        #[primary_key]
        fn pk(&self) -> (AccountNumber, EvalTypeU32, AccountNumber) {
            (self.fractal, self.eval_type, self.account)
        }

        pub fn get(fractal: AccountNumber, eval_type: EvalType, account: AccountNumber) -> Self {
            let table = ScoreTable::new();
            check_some(
                table
                    .get_index_pk()
                    .get(&(fractal, eval_type.into(), account)),
                "failed to find score",
            )
        }

        pub fn new(fractal: AccountNumber, eval_type: EvalType, account: AccountNumber) -> Self {
            Self {
                account,
                eval_type: eval_type.into(),
                fractal,
                value: 0.0,
                pending: None,
            }
        }

        pub fn add(fractal: AccountNumber, eval_type: EvalType, account: AccountNumber) -> Self {
            let new_instance = Self::new(fractal, eval_type, account);
            new_instance.save();
            new_instance
        }

        pub fn set_pending_score(&mut self, incoming_score: f32) {
            self.pending = Some(incoming_score);
            self.save();
        }

        pub fn save_pending_score(&mut self) {
            if self.pending.is_some() {
                self.value = calculate_ema(self.pending.unwrap(), self.value, 0.2);
                self.save();
            }
        }

        pub fn save(&self) {
            let table = ScoreTable::new();
            table.put(&self).expect("failed to save score");
        }
    }
}
