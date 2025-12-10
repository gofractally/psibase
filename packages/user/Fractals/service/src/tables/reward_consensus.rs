use std::collections::HashSet;

use psibase::{abort_message, check, check_none, check_some, AccountNumber, Memo, Table};

use crate::constants::MAX_RANKED_GUILDS;
use crate::helpers::{continuous_fibonacci, distribute_by_weight};
use crate::tables::tables::{
    RewardConsensus, RewardConsensusTable, Fractal, FractalMember, Guild, GuildMember, RewardStream,
};

use psibase::services::tokens::Quantity;

impl RewardConsensus {
    fn new(fractal: AccountNumber) -> Self {
        let token_id = Fractal::get_assert(fractal).token_id;

        Self {
            fractal,
            reward_stream_id: RewardStream::add(fractal, token_id).stream_id,
            ranked_guilds: vec![],
        }
    }

    pub fn get(fractal: AccountNumber) -> Option<Self> {
        RewardConsensusTable::read().get_index_pk().get(&fractal)
    }

    pub fn get_assert(fractal: AccountNumber) -> Self {
        check_some(Self::get(fractal), "consensus reward does not exist")
    }

    fn save(&self) {
        RewardConsensusTable::read_write()
            .put(&self)
            .expect("failed to save");
    }

    pub fn add(fractal: AccountNumber, initial_allocation: Quantity) -> Self {
        check_none(Self::get(fractal), "consensus reward already exists");

        let new_instance = Self::new(fractal);
        new_instance.deposit(initial_allocation, "Fractal Consensus allocation".into());

        new_instance.save();
        new_instance
    }

    fn deposit(&self, amount: Quantity, memo: Memo) {
        self.reward_stream().deposit(amount, memo);
    }

    pub fn distribute_tokens(&mut self) {
        let claimed = self.reward_stream().withdraw();

        let ranked_guilds = self.ranked_guilds.clone();
        let ranked_guilds_length = ranked_guilds.len() as u64;

        let mut total_dust = 0u64;

        let (guild_distributions, guild_dust) = distribute_by_weight(
            ranked_guilds,
            |index, _| continuous_fibonacci(ranked_guilds_length as u32 - index as u32),
            claimed.value,
        );
        total_dust += guild_dust;

        for (guild, guild_distribution) in guild_distributions {
            let (member_distributions, member_dust) = distribute_by_weight(
                GuildMember::memberships_of_guild(guild),
                |_, member| continuous_fibonacci(member.score as u32),
                guild_distribution,
            );

            total_dust += member_dust;

            for (membership, reward) in member_distributions {
                FractalMember::get_assert(self.fractal, membership.member)
                    .deposit_stream(reward.into(), "Guild member reward".into());
            }
        }

        if total_dust > 0 {
            self.deposit(total_dust.into(), "Dust return".into());
        }
    }

    pub fn set_ranked_guilds(&mut self, guilds: Vec<AccountNumber>) {
        check(
            guilds.len() <= MAX_RANKED_GUILDS as usize,
            &format!("only up to {} guilds can be ranked", MAX_RANKED_GUILDS),
        );
        let mut seen = HashSet::new();
        for &guild in &guilds {
            if !seen.insert(guild) {
                abort_message("duplicate ranked guild detected");
            }
            check(
                Guild::get_assert(guild).fractal == self.fractal,
                "cannot rank foreign guilds",
            );
        }
        self.ranked_guilds = guilds;
        self.save();
    }

    pub fn reward_stream(&self) -> RewardStream {
        RewardStream::get_assert(self.reward_stream_id)
    }
}
