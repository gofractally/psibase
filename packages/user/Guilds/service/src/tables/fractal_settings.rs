use psibase::services::fractals::distribute::aggregate_member_weights;
use psibase::services::fractals::weighted_normalization::{
    curves::{get_curve, Curve},
    weighted_normalization,
};
use psibase::{AccountNumber, Table};

use crate::tables::tables::{FractalSettings, FractalSettingsTable, Guild, Ranking};

impl FractalSettings {
    fn new(fractal: AccountNumber, dist_strat: Curve) -> Self {
        Self {
            fractal,
            guild_weight_curve: dist_strat.into(),
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
            .unwrap_or_else(|| Self::new(fractal, Curve::Fibonacci))
    }

    pub fn set_guild_weight_curve(&mut self, guild_weight_curve: Curve) {
        self.guild_weight_curve = guild_weight_curve.into();
        self.save();
    }

    pub fn scores(&self) -> Vec<(AccountNumber, u32)> {
        let ranked_guilds = Ranking::get_ordered_rankings(self.fractal);
        let guild_weights = weighted_normalization(
            ranked_guilds.iter(),
            get_curve(self.guild_weight_curve.into()),
        );

        let groups = ranked_guilds
            .iter()
            .zip(guild_weights)
            .map(|(r, gw)| (r.guild, gw, Guild::get_assert(r.guild).scores()));

        aggregate_member_weights(groups, |_| true)
            .into_iter()
            .collect()
    }
}
