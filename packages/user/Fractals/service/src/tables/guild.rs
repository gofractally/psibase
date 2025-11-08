use async_graphql::ComplexObject;
use psibase::services::accounts::Wrapper as Accounts;
use psibase::services::auth_delegate::Wrapper as AuthDelegate;
use psibase::services::auth_dyn::Wrapper as AuthDyn;

use psibase::{check_none, check_some, get_sender, AccountNumber, Memo, Table, ToServiceSchema};

use crate::tables::tables::{
    EvaluationInstance, Fractal, FractalMember, Guild, GuildMember, GuildMemberTable, GuildTable,
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
        }
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

        // TODO: replace with auth-guild when available

        AuthDyn::call().createAccount(council_role);
        AuthDyn::call().createAccount(rep_role);

        AuthDyn::call().createAccount(guild);
        // Accounts::call().newAccount(fractal_account, "auth-any".into(), true);

        // First it goes to whales
        // isAuthSys - uses get_policy which returns the representative role
        // finds that Jake is in authorizers but not multi-auth authorizors.
        // Loops through the multi-auth, which is the rep_role account
        // Loops up the rep_role account, get_policy which returns jakes account

        check_some(
            FractalMember::get(fractal, rep),
            "rep must be a member of the fractal",
        );

        let new_guild_instance =
            Self::new(fractal, guild, rep, display_name, council_role, rep_role);
        new_guild_instance.save();

        GuildMember::add(new_guild_instance.account, rep);
        new_guild_instance
    }

    pub fn get(account: AccountNumber) -> Option<Self> {
        GuildTable::read().get_index_pk().get(&account)
    }

    pub fn get_assert(account: AccountNumber) -> Self {
        check_some(Self::get(account), "guild does not exist")
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

    pub fn council_members(&self) -> Vec<GuildMember> {
        GuildMemberTable::read()
            .get_index_by_score()
            .range(
                (self.account, 0, AccountNumber::new(0))
                    ..=(self.account, u32::MAX, AccountNumber::new(u64::MAX)),
            )
            .rev()
            .take(6)
            .filter(|member| member.score != 0)
            .collect()
    }

    pub fn representative(&self) -> Option<GuildMember> {
        self.rep
            .map(|rep| GuildMember::get_assert(self.account, rep))
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

    pub async fn council(&self) -> Vec<AccountNumber> {
        self.council_members()
            .into_iter()
            .map(|member| member.member)
            .collect()
    }

    pub async fn rep(&self) -> Option<GuildMember> {
        self.representative()
    }
}
