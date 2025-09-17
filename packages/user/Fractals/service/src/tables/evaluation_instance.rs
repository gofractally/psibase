use evaluations::service::{Evaluation, EvaluationTable, User, UserTable};
use psibase::abort_message;
use psibase::{check_some, get_service, AccountNumber, Table};

use crate::{
    helpers::parse_rank_to_accounts,
    tables::tables::{EvaluationInstance, EvaluationInstanceTable, Score, ScoreTable},
};

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

impl EvaluationInstance {
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

    fn new(fractal: AccountNumber, eval_type: EvalType, interval: u32, evaluation_id: u32) -> Self {
        Self {
            eval_type: eval_type.into(),
            evaluation_id,
            fractal,
            interval,
        }
    }

    fn add(fractal: AccountNumber, eval_type: EvalType, interval: u32, evaluation_id: u32) -> Self {
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
            // TODO: Change back to 4,5,6;
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
            psibase::services::evaluations::Wrapper::call().delete(existing.evaluation_id, false);
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
