use psibase::{
    check,
    services::tokens::{Decimal, Precision},
    AccountNumber, Table,
};

use psibase::services::fractals::weighted_normalization::HasScore;
use crate::tables::tables::{Occupation, OccupationTable};

impl Occupation {
    fn new(fractal: AccountNumber, index: u8, occupation: AccountNumber) -> Self {
        Self {
            fractal,
            index,
            occupation,
        }
    }

    fn save(&self) {
        OccupationTable::read_write()
            .put(&self)
            .expect("failed to save");
    }

    pub fn get_ordered(fractal: AccountNumber) -> Vec<Self> {
        OccupationTable::read()
            .get_index_pk()
            .range(&(fractal, 0)..&(fractal, u8::MAX))
            .collect()
    }

    fn total(fractal: AccountNumber) -> usize {
        OccupationTable::read()
            .get_index_pk()
            .range(&(fractal, 0)..&(fractal, u8::MAX))
            .count()
    }

    pub fn set_ordered_occupations(fractal: AccountNumber, new_occupations: Vec<AccountNumber>) {
        let occupations_length = new_occupations.len();

        check(
            occupations_length <= u8::MAX as usize,
            "too many occupations",
        );

        let existing_occupations = Self::get_ordered(fractal);

        for (index, occupation) in new_occupations.into_iter().enumerate() {
            if let Some(existing) = existing_occupations.get(index) {
                if existing.occupation != occupation {
                    Self::new(fractal, index as u8, occupation).save();
                }
            } else {
                Self::new(fractal, index as u8, occupation).save();
            }
        }

        for existing in existing_occupations.into_iter().skip(occupations_length) {
            OccupationTable::read_write().remove(&existing);
        }
    }
}

impl HasScore for Occupation {
    /// Top-ranked occupation (lowest index) gets the highest score.
    fn get_score(&self) -> Decimal {
        let score = (Self::total(self.fractal) - self.index as usize) as u64;
        Decimal::new(score.into(), Precision::new(0).unwrap())
    }
}
