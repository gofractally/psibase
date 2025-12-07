use std::collections::HashSet;

use psibase::{abort_message, check, check_none, check_some, AccountNumber, Memo, Table};

use crate::constants::{
    FRACTAL_STREAM_HALF_LIFE, MAX_FRACTAL_DISTRIBUTION_INTERVAL_SECONDS, MAX_GUILD_RANKING,
    MIN_FRACTAL_DISTRIBUTION_INTERVAL_SECONDS, ONE_WEEK,
};
use crate::helpers::{continuous_fibonacci, distribute_by_weight};
use crate::tables::tables::{
    ConsensusReward, ConsensusRewardTable, Fractal, FractalMember, Guild, GuildMember,
};

use psibase::services::tokens::{Quantity, Wrapper as Tokens, TID};
use psibase::services::transact::Wrapper as TransactSvc;

use psibase::services::token_stream::Wrapper as TokenStream;

impl ConsensusReward {
    fn new(fractal: AccountNumber, token_id: TID) -> Self {
        let now = TransactSvc::call().currentBlock().time.seconds();

        Self {
            fractal,
            ranked_guilds: vec![],
            stream_id: TokenStream::call().create(FRACTAL_STREAM_HALF_LIFE, token_id),
            dist_interval_secs: ONE_WEEK,
            last_distributed: now,
        }
    }

    fn deposit_stream(&self, amount: Quantity, memo: Memo) {
        Tokens::call().credit(
            self.fractal_detail().token_id,
            TokenStream::SERVICE,
            amount,
            memo,
        );
        TokenStream::call().deposit(self.stream_id, amount);
    }

    fn claim_stream(&self) -> Quantity {
        let claimable = TokenStream::call().claim(self.stream_id);
        check(claimable.value != 0, "nothing to claim");

        Tokens::call().debit(
            self.fractal_detail().token_id,
            TokenStream::SERVICE,
            claimable,
            "Reward claim".into(),
        );
        claimable
    }

    pub fn add(fractal: AccountNumber, token_id: TID, allocation: Quantity) -> Self {
        check(allocation.value > 0, "allocation must be greater than 0");
        check_none(
            Self::get(fractal),
            "fractal consensus reward already exists",
        );

        let new_instance = Self::new(fractal, token_id);

        new_instance.deposit_stream(allocation, "Fractal Consensus allocation".into());

        new_instance.save();
        new_instance
    }

    fn fractal_detail(&self) -> Fractal {
        Fractal::get_assert(self.fractal)
    }

    fn check_can_distribute(&mut self) {
        let now = TransactSvc::call().currentBlock().time.seconds();

        let distribution_interval = self.dist_interval_secs as i64;
        let seconds_elapsed = now.seconds - self.last_distributed.seconds;
        let whole_intervals_elapsed = seconds_elapsed / distribution_interval;

        if whole_intervals_elapsed == 0 {
            abort_message("must wait for interval period before token distribution");
        } else {
            let whole_interval_seconds = whole_intervals_elapsed * distribution_interval;
            self.last_distributed = (self.last_distributed.seconds + whole_interval_seconds).into();
        }
        self.save();
    }

    pub fn set_distribution_interval(&mut self, seconds: u32) {
        check(
            seconds >= MIN_FRACTAL_DISTRIBUTION_INTERVAL_SECONDS,
            "distribution must be greater or equal to a day",
        );
        check(
            seconds <= MAX_FRACTAL_DISTRIBUTION_INTERVAL_SECONDS,
            "distribution must be less than or equal to 8 weeks",
        );
        self.dist_interval_secs = seconds;
        self.save();
    }

    pub fn distribute_tokens(&mut self) {
        self.check_can_distribute();

        let claimed = self.claim_stream();

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
            self.deposit_stream(total_dust.into(), "Dust return".into());
        }
    }

    pub fn set_ranked_guilds(&mut self, guilds: Vec<AccountNumber>) {
        check(
            guilds.len() <= MAX_GUILD_RANKING as usize,
            &format!("only up to {} guilds can be ranked", MAX_GUILD_RANKING),
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

    pub fn get(fractal: AccountNumber) -> Option<Self> {
        ConsensusRewardTable::read().get_index_pk().get(&fractal)
    }

    pub fn get_assert(fractal: AccountNumber) -> Self {
        check_some(Self::get(fractal), "fractal token does not exist")
    }

    fn save(&self) {
        ConsensusRewardTable::read_write()
            .put(&self)
            .expect("failed to save");
    }
}
