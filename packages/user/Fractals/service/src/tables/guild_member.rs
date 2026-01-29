use async_graphql::ComplexObject;
use psibase::{check, check_none, check_some, AccountNumber, Table};

use crate::constants::{EMA_ALPHA_DENOMINATOR, GUILD_EVALUATION_GROUP_SIZE, SCORE_SCALE};
use crate::helpers::RollingBits16;
use crate::scoring::{calculate_ema_u32, Fraction};
use crate::tables::tables::{Guild, GuildAttest, GuildAttestTable, GuildMember, GuildMemberTable};
use psibase::services::transact::Wrapper as TransactSvc;

impl GuildMember {
    fn new(guild: AccountNumber, member: AccountNumber) -> Self {
        let now = TransactSvc::call().currentBlock().time.seconds();

        Self {
            guild,
            member,
            pending_level: None,
            score: 0,
            created_at: now,
            is_candidate: false,
            candidacy_eligible_from: now,
            attendance: RollingBits16::new().value(),
        }
    }

    pub fn add(guild: AccountNumber, member: AccountNumber) -> Self {
        check_none(Self::get(guild, member), "guild member already exists");
        let new_instance = Self::new(guild, member);
        new_instance.save();
        new_instance
    }

    pub fn get(guild: AccountNumber, member: AccountNumber) -> Option<Self> {
        GuildMemberTable::read()
            .get_index_pk()
            .get(&(guild, member))
    }

    pub fn get_from(
        table: &GuildMemberTable,
        guild: AccountNumber,
        member: AccountNumber,
    ) -> Option<Self> {
        table.get_index_pk().get(&(guild, member))
    }

    pub fn get_assert(guild: AccountNumber, member: AccountNumber) -> Self {
        check_some(Self::get(guild, member), "guild member does not exist")
    }

    pub fn kick(&self) {
        self.remove();
    }

    pub fn memberships_of_member(member: AccountNumber) -> Vec<Self> {
        GuildMemberTable::read()
            .get_index_by_member()
            .range((member, AccountNumber::new(0))..=(member, AccountNumber::new(u64::MAX)))
            .collect()
    }

    pub fn memberships_of_guild(guild: AccountNumber) -> Vec<Self> {
        GuildMemberTable::read()
            .get_index_pk()
            .range((guild, AccountNumber::from(0))..=(guild, AccountNumber::from(u64::MAX)))
            .collect()
    }

    pub fn remove_all_by_member(member: AccountNumber) {
        let table = GuildMemberTable::read_write();
        for membership in Self::memberships_of_member(member) {
            table.remove(&membership);
        }
    }

    fn set_pending_level(&mut self, pending_level: Option<u8>) {
        self.pending_level = pending_level;
    }

    // 1. Called for every guild member at the start of a duration
    // Setting a pending score to 0 regardless of evaluation attendance introduces decay
    pub fn open_pending_level(&mut self) {
        self.set_pending_level(Some(0));
    }

    // 2. Optionally called either when the GuildMember has achieved a level in a successful group evaluation
    // Or is called when rank_ordering is not enabled,
    pub fn update_pending_level(&mut self, pending_level: u8) {
        self.set_pending_level(Some(pending_level));
    }

    // 3. Called when finishing an evaluation and taking the pending level to create the new score.
    pub fn apply_pending_level_to_score(&mut self, attended: bool) {
        // Mark the members attendance by adding a bit to their bitset. 
        self.attendance = RollingBits16::from(self.attendance).push(attended).value();
        let pending_level = self.pending_level.take().unwrap();

        self.score = calculate_ema_u32(
            pending_level as u32 * SCORE_SCALE,
            self.score,
            Fraction::new(1, EMA_ALPHA_DENOMINATOR),
        );
    }

    pub fn set_candidacy(&mut self, active: bool) {
        check(self.is_candidate != active, "candidacy state unchanged");
        let now = TransactSvc::call().currentBlock().time.seconds();
        if active {
            check(
                now >= self.candidacy_eligible_from,
                "candidacy not eligible yet",
            );
        } else {
            let guild = Guild::get_assert(self.guild);
            self.candidacy_eligible_from = (now.seconds + guild.candidacy_cooldown as i64).into();
        }
        self.is_candidate = active;
        self.save();
    }

    fn remove(&self) {
        let table = GuildAttestTable::read_write();
        let members = GuildAttest::attestations_by_guild_member(self.guild, self.member);

        for attest in members {
            table.remove(&attest);
        }

        GuildMemberTable::read_write().remove(&self);
    }

    pub fn save_to(&self, table: &GuildMemberTable) {
        table.put(&self).expect("failed to save");
    }

    fn save(&self) {
        self.save_to(&GuildMemberTable::read_write());
    }
}

#[ComplexObject]
impl GuildMember {
    pub async fn guild(&self) -> Guild {
        Guild::get_assert(self.guild)
    }

    pub async fn score(&self) -> f32 {
        self.score as f32 / SCORE_SCALE as f32 / GUILD_EVALUATION_GROUP_SIZE as f32 * 100.0
    }
}
