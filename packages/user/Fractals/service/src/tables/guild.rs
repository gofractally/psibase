use async_graphql::ComplexObject;
use psibase::services::auth_dyn::Wrapper as AuthDyn;

use psibase::services::auth_dyn::interfaces::{
    DynamicAuthPolicy::{self, Multi, Single},
    MultiAuth, SingleAuth, WeightedAuthorizer,
};
use psibase::{check, check_none, check_some, AccountNumber, Memo, Table};

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

        AuthDyn::call().newAccount(council_role);
        AuthDyn::call().newAccount(rep_role);
        AuthDyn::call().newAccount(guild);

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

    pub fn get_by_council_role(council: AccountNumber) -> Option<Self> {
        GuildTable::read().get_index_by_council().get(&council)
    }

    pub fn get_by_rep_role(rep: AccountNumber) -> Option<Self> {
        GuildTable::read().get_index_by_rep().get(&rep)
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

    pub fn council_members(&self) -> Option<Vec<GuildMember>> {
        let council: Vec<GuildMember> = GuildMemberTable::read()
            .get_index_by_score()
            .range(
                (self.account, 0, AccountNumber::new(0))
                    ..=(self.account, u32::MAX, AccountNumber::new(u64::MAX)),
            )
            .rev()
            .take(6)
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
        Single(SingleAuth {
            authorizer: self.rep.map_or(self.council_role, |_| self.rep_role),
        })
    }

    pub fn rep_role_auth(&self) -> DynamicAuthPolicy {
        // In the event that the role account shouldn't be used because the guild is in council mode
        // Should this throw? Or should this return a policy that he couldnt use anyway?
        self.rep.map_or(
            Multi(MultiAuth {
                threshold: 1,
                authorizers: vec![],
            }),
            |rep| Single(SingleAuth { authorizer: rep }),
        )
    }

    pub fn council_role_auth(&self) -> DynamicAuthPolicy {
        let council = self.council_members().map_or(
            MultiAuth {
                authorizers: vec![],
                threshold: 1,
            },
            |guild_members| MultiAuth {
                threshold: (guild_members.len() as u8 * 2 + 2) / 3,
                authorizers: guild_members
                    .into_iter()
                    .map(|auth| WeightedAuthorizer {
                        account: auth.member,
                        weight: 1,
                    })
                    .collect(),
            },
        );

        Multi(council)
    }

    pub fn set_representative(&mut self, new_representative: AccountNumber) {
        FractalMember::get_assert(self.fractal, new_representative);

        self.rep = Some(new_representative);
        self.save();
    }

    pub fn remove_representative(&mut self) {
        check_some(
            self.council_members(),
            "cannot remove representative without council in place",
        );
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
