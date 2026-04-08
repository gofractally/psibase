use psibase::{check, check_none, AccountNumber, Table};

use crate::tables::tables::{Occupation, OccupationTable};

impl Occupation {
    fn new(fractal: AccountNumber, index: u8, occupation: AccountNumber) -> Self {
        Self {
            fractal,
            index,
            occupation,
        }
    }

    pub fn add(fractal: AccountNumber, index: u8, occupation: AccountNumber) -> Self {
        check_none(
            Self::get(fractal, index),
            "occupation already exists for this fractal and index",
        );

        let new_instance = Self::new(fractal, index, occupation);
        new_instance.save();
        new_instance
    }

    fn get(fractal: AccountNumber, index: u8) -> Option<Self> {
        OccupationTable::read()
            .get_index_pk()
            .get(&(fractal, index))
    }

    fn save(&self) {
        OccupationTable::read_write()
            .put(&self)
            .expect("failed to save");
    }

    pub fn get_ordered(fractal: AccountNumber) -> Vec<Self> {
        let mut occupations: Vec<_> = OccupationTable::read()
            .get_index_pk()
            .range(&(fractal, 0)..&(fractal, u8::MAX))
            .collect();

        occupations.sort_by_key(|occ| occ.index);

        occupations
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
