use std::u64;

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
        let mut rankings: Vec<_> = RankingTable::read()
            .get_index_pk()
            .range(
                &(fractal, 0, AccountNumber::new(0))
                    ..&(fractal, u8::MAX, AccountNumber::new(u64::MAX)),
            )
            .collect();

        rankings.sort_by_key(|occ| occ.index);

        rankings
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
