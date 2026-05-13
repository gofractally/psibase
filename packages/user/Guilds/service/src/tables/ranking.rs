use psibase::services::fractals::weighted_normalization::HasScore;
use psibase::services::tokens::{Decimal, Precision};
use psibase::{check, AccountNumber, Table};

use crate::{
    constants::MAX_RANKED_GUILDS,
    tables::tables::{Ranking, RankingTable},
};

impl Ranking {
    fn new(fractal: AccountNumber, index: u8, guild: AccountNumber) -> Self {
        Self {
            fractal,
            index,
            guild,
        }
    }

    fn save(&self) {
        RankingTable::read_write()
            .put(&self)
            .expect("failed to save");
    }

    pub fn get_ordered_rankings(fractal: AccountNumber) -> Vec<Self> {
        RankingTable::read()
            .get_index_pk()
            .range(&(fractal, 0)..&(fractal, u8::MAX))
            .collect()
    }

    pub fn contains(fractal: AccountNumber, guild: AccountNumber) -> bool {
        Self::get_ordered_rankings(fractal)
            .iter()
            .any(|r| r.guild == guild)
    }

    fn total(fractal: AccountNumber) -> usize {
        RankingTable::read()
            .get_index_pk()
            .range(&(fractal, 0)..&(fractal, u8::MAX))
            .count()
    }

    pub fn set_ranked_guilds(fractal: AccountNumber, new_ranked_guilds: Vec<AccountNumber>) {
        let ranked_guilds_length = new_ranked_guilds.len();

        check(
            ranked_guilds_length <= MAX_RANKED_GUILDS as usize,
            "too many ranked guilds",
        );

        let existing_rankings = Self::get_ordered_rankings(fractal);

        for (index, ranked_guild) in new_ranked_guilds.into_iter().enumerate() {
            if let Some(existing) = existing_rankings.get(index) {
                if existing.guild != ranked_guild {
                    Self::new(fractal, index as u8, ranked_guild).save();
                }
            } else {
                Self::new(fractal, index as u8, ranked_guild).save();
            }
        }

        for existing in existing_rankings.into_iter().skip(ranked_guilds_length) {
            RankingTable::read_write().remove(&existing);
        }
    }
}

impl HasScore for Ranking {
    /// Top-ranked guild (lowest index) gets the highest score.
    fn get_score(&self) -> Decimal {
        let score = (Self::total(self.fractal) - self.index as usize) as u64;
        Decimal::new(score.into(), Precision::new(0).unwrap())
    }
}
