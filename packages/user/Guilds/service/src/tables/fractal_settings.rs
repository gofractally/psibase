use std::collections::HashMap;

use crate::tables::tables::{FractalSettings, FractalSettingsTable, GuildMember, Ranking};
use psibase::{weighted_normalization, AccountNumber, Algorithm, Table};

impl FractalSettings {
    fn new(fractal: AccountNumber, dist_strat: Algorithm) -> Self {
        Self {
            fractal,
            dist_strat: dist_strat.into(),
        }
    }

    fn save(&self) {
        FractalSettingsTable::read_write()
            .put(&self)
            .expect("failed to save");
    }

    pub fn get_or_default(fractal: AccountNumber) -> Self {
        FractalSettingsTable::read()
            .get_index_pk()
            .get(&fractal)
            .unwrap_or_else(|| Self::new(fractal, Algorithm::Fibonacci))
    }

    pub fn set_dist_strategy(&mut self, dist_strat: Algorithm) {
        self.dist_strat = dist_strat.into();
        self.save();
    }

    pub fn scores(&self) -> Vec<(AccountNumber, u32)> {
        let ranked_guilds = Ranking::get_ordered_rankings(self.fractal);

        if ranked_guilds.is_empty() {
            return vec![];
        }

        let guild_weights = weighted_normalization(
            self.dist_strat.into(),
            ranked_guilds.into_iter().map(|rank| rank.guild).collect(),
        );

        let mut member_scores: HashMap<AccountNumber, u128> = HashMap::new();

        for (guild, guild_weight) in guild_weights {
            if guild_weight == 0 {
                continue;
            }

            let guild_weight = guild_weight as u128;
            let guild_member_scores = GuildMember::memberships_of_guild(guild);

            for guild_member in guild_member_scores {
                if guild_member.score == 0 {
                    continue;
                }
                let contribution = guild_member.score as u128 * guild_weight;
                *member_scores.entry(guild_member.member).or_insert(0) += contribution;
            }
        }

        let max_score = member_scores.values().copied().max().unwrap_or(0);

        if max_score == 0 {
            return vec![];
        }

        member_scores
            .into_iter()
            .map(|(member, total)| {
                let normalized = ((total * u32::MAX as u128) / max_score) as u32;
                (member, normalized)
            })
            .collect()
    }
}
