#[psibase::service_tables]
pub mod tables {
    use std::u64;

    use async_graphql::SimpleObject;
    use psibase::services::transact::Wrapper as TransactSvc;
    use psibase::{
        abort_message, check_some, get_service, AccountNumber, Fracpack, Table, TimePointSec,
        ToKey, ToSchema,
    };

    use evaluations::service::{Evaluation, EvaluationTable, User, UserTable};

    use serde::{Deserialize, Serialize};

    use crate::scoring::calculate_ema;

    #[table(name = "FractalTable", index = 0)]
    #[derive(Default, Fracpack, ToSchema, SimpleObject, Serialize, Deserialize, Debug)]
    pub struct Fractal {
        pub account: AccountNumber,
        pub created_at: TimePointSec,
        pub name: String,
        pub mission: String,
        pub scheduled_evaluation: Option<u32>,
        pub evaluation_interval: Option<u32>,
        pub reward_wait_period: u32,
    }

    impl Fractal {
        #[primary_key]
        fn pk(&self) -> AccountNumber {
            self.account
        }

        #[secondary_key(1)]
        pub fn by_pending_evaluation(&self) -> (AccountNumber, Option<u32>) {
            (self.account, self.scheduled_evaluation)
        }

        fn new(account: AccountNumber, name: String, mission: String) -> Self {
            let now = TransactSvc::call().currentBlock().time.seconds();

            Self {
                account,
                created_at: now,
                mission,
                name,
                scheduled_evaluation: None,
                evaluation_interval: None,
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

        pub fn get_by_evaluation_id(evaluation_id: u32) -> Self {
            let table = FractalTable::new();
            let mut vec: Vec<Fractal> = table
                .get_index_by_pending_evaluation()
                .range(
                    (AccountNumber::new(0), Some(evaluation_id))
                        ..=(AccountNumber::new(u64::MAX), Some(evaluation_id)),
                )
                .collect();

            if vec.len() == 1 {
                vec.remove(0)
            } else if vec.len() == 0 {
                abort_message(format!("failed to find fractal by ID {}", evaluation_id).as_str())
            } else {
                // TODO: fix this and remove awkward bandaid...
                let res = vec.into_iter().find(|fractal| {
                    if fractal.scheduled_evaluation.is_some() {
                        return fractal.scheduled_evaluation.unwrap() == evaluation_id;
                    } else {
                        return false;
                    }
                });
                if res.is_some() {
                    return res.unwrap();
                } else {
                    abort_message(
                        format!(
                            "found several evaluations but failed to find one of ID {}",
                            evaluation_id
                        )
                        .as_str(),
                    )
                }
            }
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

        pub fn evaluation_users(&self, group_number: Option<u32>) -> Vec<User> {
            let fractals_service = get_service();
            let evaluation_id = check_some(self.scheduled_evaluation, "no scheduled evaluation");

            match group_number {
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
            }
        }

        pub fn evaluation(&self) -> Option<Evaluation> {
            EvaluationTable::with_service(evaluations::SERVICE)
                .get_index_pk()
                .get(&(
                    get_service(),
                    psibase::check_some(self.scheduled_evaluation, "no secheduled eval"),
                ))
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
                vec![4, 5, 6],
                6,
                true,
            );

            self.scheduled_evaluation = Some(eval_id);
            self.evaluation_interval = Some(interval_seconds);
            self.save();
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
            if self.scheduled_evaluation.is_some() {
                psibase::services::evaluations::Wrapper::call()
                    .delete(self.scheduled_evaluation.unwrap(), force_delete);
            };

            self.create_evaluation(
                registration,
                deliberation,
                submission,
                finish_by,
                interval_seconds,
            );
        }

        pub fn schedule_next_evaluation(&mut self) {
            let interval = self.evaluation_interval.unwrap();
            let evaluation = check_some(
                self.evaluation(),
                "expected existing evaluation to set the next one",
            );

            let old_evaluation_id = self.scheduled_evaluation.unwrap().clone();

            self.create_evaluation(
                evaluation.registration_starts + interval,
                evaluation.deliberation_starts + interval,
                evaluation.submission_starts + interval,
                evaluation.finish_by + interval,
                interval,
            );

            psibase::services::evaluations::Wrapper::call().close(get_service(), old_evaluation_id);
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
        pub reputation: f32,
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

        fn new(fractal: AccountNumber, account: AccountNumber, status: MemberStatus) -> Self {
            let now = TransactSvc::call().currentBlock().time.seconds();
            Self {
                account,
                fractal,
                created_at: now,
                reputation: 0.0,
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
            new_instance
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

        pub fn feed_new_score(&mut self, incoming_score: f32) {
            self.reputation = calculate_ema(incoming_score, self.reputation, 0.2);
            self.save();
        }
    }
}
