use std::collections::HashSet;

use psibase::{abort_message, check, check_none, check_some, AccountNumber, Memo, Table};

use crate::helpers::{distribute_by_weight, continuous_fibonacci};
use crate::tables::tables::{
    ConsensusReward, ConsensusRewardTable, Fractal, FractalMember, Guild, GuildMember,
};
use crate::{ONE_WEEK, ONE_YEAR};

use psibase::services::tokens::{Quantity, Wrapper as Tokens, TID};
use psibase::services::transact::Wrapper as TransactSvc;

use psibase::services::token_stream::Wrapper as TokenStream;

impl ConsensusReward {
    fn new(fractal: AccountNumber, token_id: TID) -> Self {
        let now = TransactSvc::call().currentBlock().time.seconds();

        Self {
            fractal,
            ranked_guilds: vec![],
            stream_id: TokenStream::call().create(ONE_YEAR * 25, token_id),
            dist_interval_secs: ONE_WEEK,
            last_distributed: now,
        }
    }

    fn deposit_stream(&self, amount: Quantity, memo: Memo) {
        Tokens::call().credit(self.fractal().token_id, TokenStream::SERVICE, amount, memo);
        TokenStream::call().deposit(self.stream_id, amount);
    }

    fn claim_stream(&self) -> Quantity {
        let claimable = TokenStream::call().claim(self.stream_id);
        check(claimable.value != 0, "nothing to claim");

        Tokens::call().debit(
            self.fractal().token_id,
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

    fn fractal(&self) -> Fractal {
        Fractal::get_assert(self.fractal)
    }

    fn check_can_distribute(&mut self) {
        let now = TransactSvc::call().currentBlock().time.seconds();

        let distribution_interval = self.dist_interval_secs as i64;
        check(
            distribution_interval > 0,
            "distribution interval must be greator than 0",
        );
        check(
            now.seconds > self.last_distributed.seconds,
            "cannot distribute in the past",
        );
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

    pub fn distribute_tokens(&mut self) {
        self.check_can_distribute();

        let claimed = self.claim_stream();
        let fractal_token_id = self.fractal().token_id;

        let ranked_guilds = self.ranked_guilds.clone();
        let ranked_guilds_length = ranked_guilds.len() as u64;

        let mut total_dust = 0u64;

        let (ranked_guilds, guild_dust) = distribute_by_weight(
            ranked_guilds,
            |index, _| continuous_fibonacci(ranked_guilds_length as u32 - index as u32),
            claimed.value,
        );
        total_dust += guild_dust;

        for (guild, guild_distribution) in ranked_guilds {
            let (rewarded_members, member_dust) = distribute_by_weight(
                GuildMember::memberships_of_guild(guild),
                |_, member| continuous_fibonacci(member.score as u32),
                guild_distribution,
            );

            total_dust += member_dust;

            for (membership, reward) in rewarded_members {
                FractalMember::get_assert(self.fractal, membership.member).deposit_stream(
                    fractal_token_id,
                    reward.into(),
                    "Guild member reward".into(),
                );
            }
        }

        if total_dust > 0 {
            self.deposit_stream(total_dust.into(), "Dust return".into());
        }
    }

    pub fn set_ranked_guilds(&mut self, guilds: Vec<AccountNumber>) {
        let mut seen = HashSet::new();
        for guild in guilds.clone() {
            if !seen.insert(guild) {
                abort_message("duplicate ranked guild detected");
            }
            check(
                Guild::get_assert(guild).fractal == self.fractal,
                "cannot rank foreign guilds",
            );
        }
        check(guilds.len() <= 12, "only up to 12 guilds can be ranked");
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
