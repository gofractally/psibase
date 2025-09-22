use psibase::{check_some, AccountNumber, Table};

use crate::scoring::{calculate_ema_u32, Fraction};
use crate::tables::evaluation_instance::EvalType;
use crate::tables::tables::{Score, ScoreTable};

impl Score {
    pub fn get_assert(fractal: AccountNumber, eval_type: EvalType, account: AccountNumber) -> Self {
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
