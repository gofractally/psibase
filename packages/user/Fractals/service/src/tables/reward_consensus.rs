use async_graphql::ComplexObject;
use std::collections::HashSet;

use psibase::{abort_message, check, check_none, check_some, AccountNumber, Memo, Table};

use crate::constants::{DEFAULT_RANKED_GUILD_SLOT_COUNT, MAX_RANKED_GUILDS};
use crate::helpers::fib::EXTERNAL_S;
use crate::helpers::{assign_decreasing_levels, continuous_fibonacci, distribute_by_weight};
use crate::tables::tables::{
    Fractal, FractalMember, Guild, GuildMember, RewardConsensus, RewardConsensusTable, RewardStream,
};

use psibase::services::tokens::Quantity;

/// Creates a vector of fixed length, filling with `Some(item)` from the input
/// and padding with `None` if the input is shorter.
///
/// If `items.len() > vector_length`, excess items are **discarded**.
///
/// # Examples
///
/// ```
/// let input = vec!["alice", "bob"];
/// let fixed = to_fixed_vec(input, 5);
/// assert_eq!(
///     fixed,
///     vec![
///         Some("alice"),
///         Some("bob"),
///         None,
///         None,
///         None
///     ]
/// );
/// ```
pub fn to_fixed_vec<T>(items: Vec<T>, vector_length: usize) -> Vec<Option<T>> {
    items
        .into_iter()
        .map(Some)
        .chain(std::iter::repeat_with(|| None)) // No Clone needed!
        .take(vector_length)
        .collect()
}

impl RewardConsensus {
    fn new(fractal: AccountNumber) -> Self {
        let token_id = Fractal::get_assert(fractal).token_id;

        Self {
            fractal,
            reward_stream_id: RewardStream::add(fractal, token_id).stream_id,
            ranked_guilds: vec![],
            ranked_guild_slot_count: DEFAULT_RANKED_GUILD_SLOT_COUNT,
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

    pub fn deposit(&self, amount: Quantity, memo: Memo) {
        self.reward_stream().deposit(amount, memo);
    }

    pub fn distribute_tokens(&mut self) {
        let claimed = self.reward_stream().withdraw();
        // The first few indices of the fibonacci function have higher error than indices later in the curve,
        // so we offset the input to incur reduced error.
        const FIB_SCALE: u32 = EXTERNAL_S as u32;
        const MAX_FIB: u32 = 32;
        const OFFSET: u32 = MAX_FIB - MAX_RANKED_GUILDS as u32;

        let mut tokens_to_recycle = 0_u64;

        let ranked_guild_slots = to_fixed_vec(
            self.ranked_guilds.clone(),
            self.ranked_guild_slot_count as usize,
        );

        let leveled_guild_slots = assign_decreasing_levels(ranked_guild_slots, None);

        let (weighted_guild_slots, guild_dust) = distribute_by_weight(
            leveled_guild_slots,
            |_, (level, _)| continuous_fibonacci((*level as u32 + OFFSET) * FIB_SCALE),
            claimed.value,
        );

        tokens_to_recycle += guild_dust;

        for ((_, guild), slot_distribution) in weighted_guild_slots {
            match guild {
                Some(guild) => {
                    let (member_distributions, member_dust) = distribute_by_weight(
                        GuildMember::memberships_of_guild(guild)
                            .into_iter()
                            .filter(|member| member.score > 0)
                            .collect(),
                        |_, member| continuous_fibonacci(member.score + FIB_SCALE * OFFSET),
                        slot_distribution,
                    );

                    tokens_to_recycle += member_dust;

                    for (membership, reward) in member_distributions {
                        FractalMember::get_assert(self.fractal, membership.member)
                            .deposit_stream(reward.into(), "Guild member reward".into());
                    }
                }
                None => tokens_to_recycle += slot_distribution,
            }
        }

        if tokens_to_recycle > 0 {
            self.deposit(tokens_to_recycle.into(), "Token reward recycle".into());
        }
    }

    pub fn set_ranked_guilds(&mut self, guilds: Vec<AccountNumber>) {
        check(
            guilds.len() <= self.ranked_guild_slot_count as usize,
            "ranked guilds exceeds allocated slots",
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

    pub fn set_ranked_guild_slot_count(&mut self, slots_count: u8) {
        check(slots_count > 0, "slots count must be above 0");
        check(
            slots_count <= MAX_RANKED_GUILDS,
            "slots count breaches max limit",
        );
        self.ranked_guild_slot_count = slots_count;
        self.save();
    }

    pub fn set_distribution_interval(&mut self, seconds: u32) {
        self.reward_stream().set_distribution_interval(seconds);
    }

    fn reward_stream(&self) -> RewardStream {
        RewardStream::get_assert(self.reward_stream_id)
    }
}

#[ComplexObject]
impl RewardConsensus {
    pub async fn stream(&self) -> RewardStream {
        RewardStream::get_assert(self.reward_stream_id)
    }
}
