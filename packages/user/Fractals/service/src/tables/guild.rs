use async_graphql::ComplexObject;
use psibase::services::auth_dyn::policy::DynamicAuthPolicy;
use psibase::services::auth_dyn::Wrapper as AuthDyn;
use psibase::{check, check_none, check_some, get_sender, AccountNumber, Flags, Memo, Table};

use crate::constants::{
    COUNCIL_SEATS, DEFAULT_CANDIDACY_COOLDOWN, DEFAULT_RANK_ORDERING_THRESHOLD,
    MAX_CANDIDACY_COOLDOWN, MIN_RANK_ORDERING_THRESHOLD,
};
use crate::helpers::{two_thirds_plus_one, RollingBits16};
use crate::tables::tables::{
    EvaluationInstance, Fractal, FractalMember, Guild, GuildFlags, GuildMember, GuildMemberTable,
    GuildTable,
};

impl Guild {
    fn new(
        fractal: AccountNumber,
        guild: AccountNumber,
        rep: AccountNumber,
        display_name: Memo,
        council_role: AccountNumber,
        rep_role: AccountNumber,
    ) -> Self {
        Self {
            account: guild,
            fractal,
            bio: "".to_string().try_into().unwrap(),
            display_name,
            rep: Some(rep),
            description: "".to_string(),
            council_role,
            rep_role,
            rank_ordering_threshold: DEFAULT_RANK_ORDERING_THRESHOLD,
            settings: 0,
            candidacy_cooldown: DEFAULT_CANDIDACY_COOLDOWN,
        }
    }

    fn get_setting(&self, flag: GuildFlags) -> bool {
        Flags::new(self.settings).get(flag)
    }

    fn set_setting(&mut self, flag: GuildFlags, enable: bool) {
        self.settings = Flags::new(self.settings).set(flag, enable).value();
        self.save();
    }

    pub fn is_rank_ordering(&self) -> bool {
        self.get_setting(GuildFlags::RANK_ORDERING)
    }

    pub fn enable_rank_ordering(&mut self) {
        if self.rep.is_some() {
            self.remove_representative();
        }
        self.set_setting(GuildFlags::RANK_ORDERING, true);
    }

    pub fn add(
        fractal: AccountNumber,
        guild: AccountNumber,
        rep: AccountNumber,
        display_name: Memo,
        council_role: AccountNumber,
        rep_role: AccountNumber,
    ) -> Self {
        check_none(Self::get(guild), "guild already exists");

        check_some(
            FractalMember::get(fractal, rep),
            "rep must be a member of the fractal",
        );

        let new_guild_instance =
            Self::new(fractal, guild, rep, display_name, council_role, rep_role);
        new_guild_instance.save();

        GuildMember::add(new_guild_instance.account, rep);

        AuthDyn::call().newAccount(council_role);
        AuthDyn::call().newAccount(rep_role);
        AuthDyn::call().newAccount(guild);

        new_guild_instance
    }

    pub fn set_candidacy_cooldown(&mut self, cooldown_seconds: u32) {
        check(
            cooldown_seconds <= MAX_CANDIDACY_COOLDOWN,
            "cooldown seconds breaches max limit",
        );
        self.candidacy_cooldown = cooldown_seconds;
        self.save();
    }

    pub fn set_rank_ordering_threshold(&mut self, rank_ordering_threshold: u8) {
        check(
            rank_ordering_threshold >= MIN_RANK_ORDERING_THRESHOLD,
            "minimum scorers is too low",
        );
        self.rank_ordering_threshold = rank_ordering_threshold;
        self.save();
    }

    pub fn get(account: AccountNumber) -> Option<Self> {
        GuildTable::read().get_index_pk().get(&account)
    }

    pub fn get_assert(account: AccountNumber) -> Self {
        check_some(Self::get(account), "guild does not exist")
    }

    pub fn by_sender() -> Self {
        Self::get_assert(get_sender())
    }

    pub fn guilds_of_fractal(fractal: AccountNumber) -> Vec<Self> {
        GuildTable::read()
            .get_index_by_fractal()
            .range((fractal, AccountNumber::new(0))..=(fractal, AccountNumber::new(u64::MAX)))
            .collect()
    }

    pub fn get_by_council_role(council: AccountNumber) -> Option<Self> {
        GuildTable::read().get_index_by_council().get(&council)
    }

    pub fn get_by_rep_role(rep: AccountNumber) -> Option<Self> {
        GuildTable::read().get_index_by_rep().get(&rep)
    }

    pub fn evaluation(&self) -> Option<EvaluationInstance> {
        EvaluationInstance::get(self.account)
    }

    pub fn set_schedule(
        &self,
        registration: u32,
        deliberation: u32,
        submission: u32,
        finish_by: u32,
        interval_seconds: u32,
    ) {
        EvaluationInstance::set_evaluation_schedule(
            self.account,
            registration,
            deliberation,
            submission,
            finish_by,
            interval_seconds,
        )
    }

    pub fn active_member_count(&self) -> usize {
        GuildMemberTable::read()
            .get_index_pk()
            .range(
                (self.account, AccountNumber::from(0))
                    ..=(self.account, AccountNumber::from(u64::MAX)),
            )
            .filter(|account| RollingBits16::from(account.attendance).count_recent_ones(4) > 1)
            .count()
    }

    pub fn council_members(&self) -> Option<Vec<GuildMember>> {
        let council: Vec<GuildMember> = GuildMemberTable::read()
            .get_index_by_score()
            .range(
                (self.account, true, 0, AccountNumber::new(0))
                    ..=(self.account, true, u32::MAX, AccountNumber::new(u64::MAX)),
            )
            .rev()
            .take(COUNCIL_SEATS as usize)
            .filter(|member| member.score != 0)
            .collect();

        if council.len() > 0 {
            return Some(council);
        } else {
            return None;
        }
    }

    pub fn representative(&self) -> Option<GuildMember> {
        self.rep
            .map(|rep| GuildMember::get_assert(self.account, rep))
    }

    pub fn guild_auth(&self) -> DynamicAuthPolicy {
        DynamicAuthPolicy::from_sole_authorizer(
            self.rep.map_or(self.council_role, |_| self.rep_role),
        )
    }

    pub fn rep_role_auth(&self) -> DynamicAuthPolicy {
        self.rep.map_or(DynamicAuthPolicy::impossible(), |rep| {
            DynamicAuthPolicy::from_sole_authorizer(rep)
        })
    }

    pub fn council_role_auth(&self) -> DynamicAuthPolicy {
        self.council_members()
            .map_or(DynamicAuthPolicy::impossible(), |council_members| {
                DynamicAuthPolicy::from_weighted_authorizers(
                    council_members
                        .iter()
                        .map(|auth| (auth.member, 1))
                        .collect(),
                    two_thirds_plus_one(council_members.len() as u8),
                )
            })
    }

    pub fn set_representative(&mut self, new_representative: AccountNumber) {
        FractalMember::get_assert(self.fractal, new_representative);

        self.rep = Some(new_representative);
        self.save();
    }

    pub fn remove_representative(&mut self) {
        self.rep = None;
        self.save();
    }

    pub fn set_display_name(&mut self, display_name: Memo) {
        self.display_name = display_name;
        self.save();
    }

    pub fn set_bio(&mut self, bio: Memo) {
        self.bio = bio;
        self.save();
    }

    pub fn set_description(&mut self, description: String) {
        self.description = description;
        self.save();
    }

    fn save(&self) {
        GuildTable::read_write().put(&self).expect("failed to save");
    }
}

#[ComplexObject]
impl Guild {
    pub async fn eval_instance(&self) -> Option<EvaluationInstance> {
        EvaluationInstance::get(self.account)
    }

    pub async fn fractal(&self) -> Fractal {
        Fractal::get_assert(self.fractal)
    }

    pub async fn council(&self) -> Option<Vec<AccountNumber>> {
        self.council_members()
            .map(|members| members.into_iter().map(|member| member.member).collect())
    }

    pub async fn rep(&self) -> Option<GuildMember> {
        self.representative()
    }
}
