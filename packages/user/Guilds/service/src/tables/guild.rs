use async_graphql::ComplexObject;
use psibase::services::auth_any;
use psibase::services::auth_dyn::policy::DynamicAuthPolicy;
use psibase::services::auth_dyn::Wrapper as AuthDyn;

use psibase::services::accounts::Wrapper as Accounts;
use psibase::services::fractals::weighted_normalization::{
    curves::{get_curve, Curve},
    weighted_normalization,
};
use psibase::{
    check, check_none, check_some, get_sender, get_service, AccountNumber, Flags, Memo,
    ServiceWrapper, Subaccount, Table,
};

use crate::constants::{
    COUNCIL_SEATS, DEFAULT_CANDIDACY_COOLDOWN, DEFAULT_RANK_ORDERING_THRESHOLD,
    MAX_CANDIDACY_COOLDOWN, MIN_RANK_ORDERING_THRESHOLD,
};
use crate::helpers::{two_thirds_plus_one, RollingBits16};
use crate::tables::tables::{
    EvaluationInstance, Guild, GuildFlags, GuildMember, GuildMemberTable, GuildTable,
};
use crate::tables::GuildSubaccount;

impl Guild {
    fn new(
        fractal: AccountNumber,
        guild: AccountNumber,
        rep: AccountNumber,
        display_name: Memo,
    ) -> Self {
        Self {
            account: guild,
            fractal,
            bio: "".to_string().try_into().unwrap(),
            display_name,
            rep: Some(rep),
            description: "".to_string(),
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
    ) -> Self {
        check_none(Self::get(guild), "guild already exists");

        let new_guild_instance = Self::new(fractal, guild, rep, display_name);
        new_guild_instance.save();

        GuildMember::add(new_guild_instance.account, rep);

        AuthDyn::call().newAccount(guild);

        let create_sub_account = |subaccount: Subaccount| {
            let new_account = guild.with_subaccount(subaccount);
            Accounts::call_as(guild).newAccount(new_account, auth_any::SERVICE, true);
            AuthDyn::call_as(new_account).set_mgmt(new_account, get_service());
            Accounts::call_as(new_account).setAuthServ(AuthDyn::SERVICE);
        };
        create_sub_account(GuildSubaccount::Council.subaccount());
        create_sub_account(GuildSubaccount::Rep.subaccount());

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

    pub fn by_council_sender() -> Self {
        let (guild, sub_account) = get_sender().split();
        let guild = Self::get_assert(guild);
        check(
            sub_account == GuildSubaccount::Council.subaccount(),
            "sender must be council role account of guild",
        );
        guild
    }

    pub fn by_rep_sender() -> Self {
        let (guild, sub_account) = get_sender().split();
        let guild = Self::get_assert(guild);
        check(
            sub_account == GuildSubaccount::Rep.subaccount(),
            "sender must be representative role account of guild",
        );
        guild
    }

    pub fn guilds_of_fractal(fractal: AccountNumber) -> Vec<Self> {
        GuildTable::read()
            .get_index_by_fractal()
            .range((fractal, AccountNumber::MIN)..=(fractal, AccountNumber::MAX))
            .collect()
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

    pub fn scores(&self) -> Vec<(AccountNumber, u32)> {
        let members: Vec<GuildMember> = GuildMember::memberships_of_guild(self.account)
            .into_iter()
            .filter(|m| m.score > 0)
            .collect();
        let weights = weighted_normalization(members.iter(), get_curve(Curve::Fibonacci));
        members
            .into_iter()
            .zip(weights)
            .map(|(m, w)| (m.member, w))
            .collect()
    }

    fn council_members(&self) -> Option<Vec<GuildMember>> {
        let members: Vec<_> = GuildMemberTable::read()
            .get_index_by_score()
            .range(
                (self.account, true, 0, AccountNumber::MIN)
                    ..=(self.account, true, u32::MAX, AccountNumber::MAX),
            )
            .rev()
            .take(COUNCIL_SEATS as usize)
            .filter(|member| member.score != 0)
            .collect();

        (members.len() > 0).then_some(members)
    }

    fn representative(&self) -> Option<GuildMember> {
        self.rep
            .map(|rep| GuildMember::get_assert(self.account, rep))
    }

    fn authorizing_subaccount(&self) -> Subaccount {
        if self.rep.is_some() {
            GuildSubaccount::Rep.subaccount()
        } else {
            GuildSubaccount::Council.subaccount()
        }
    }

    pub fn auth_policy(&self) -> DynamicAuthPolicy {
        DynamicAuthPolicy::from_sole_authorizer(
            self.account.with_subaccount(self.authorizing_subaccount()),
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
        check_some(
            GuildMember::get(self.account, new_representative),
            "representative must be a guild member",
        ); // Or must it?
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

    pub async fn council(&self) -> Option<Vec<AccountNumber>> {
        self.council_members()
            .map(|members| members.into_iter().map(|member| member.member).collect())
    }

    pub async fn rep(&self) -> Option<GuildMember> {
        self.representative()
    }
}
