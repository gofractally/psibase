use async_graphql::ComplexObject;
use psibase::services::accounts;
use psibase::{check, check_none, check_some, AccountNumber, Action, Memo, Table};

use crate::tables::tables::{
    EvaluationInstance, Fractal, FractalMember, Guild, GuildMember, GuildMemberTable, GuildTable,
};

use psibase::fracpack::Pack;
use psibase::services::transact;

impl Guild {
    fn new(
        fractal: AccountNumber,
        guild: AccountNumber,
        council: AccountNumber,
        rep: AccountNumber,
        display_name: Memo,
    ) -> Self {
        Self {
            account: guild,
            fractal,
            council,
            bio: "".to_string().try_into().unwrap(),
            display_name,
            rep: Some(rep),
            description: "".to_string(),
        }
    }

    fn configure_new_guild_account(account: AccountNumber) {
        // try make this auth-guild

        accounts::Wrapper::call().newAccount(account, AccountNumber::from("auth-any"), true);

        let set_auth_serv = Action {
            sender: account,
            service: accounts::SERVICE,
            method: accounts::action_structs::setAuthServ::ACTION_NAME.into(),
            rawData: accounts::action_structs::setAuthServ {
                authService: "auth-guild".into(),
            }
            .packed()
            .into(),
        };

        transact::Wrapper::call().runAs(set_auth_serv, vec![]);
    }

    pub fn add(
        fractal: AccountNumber,
        guild: AccountNumber,
        council: AccountNumber,
        rep: AccountNumber,
        display_name: Memo,
    ) -> Self {
        check_none(Self::get(guild), "guild already exists");

        FractalMember::get_assert(fractal, rep).check_has_visa_or_citizenship();

        let new_guild_instance = Self::new(fractal, guild, council, rep, display_name);
        new_guild_instance.save();

        GuildMember::add(new_guild_instance.account, rep);

        Self::configure_new_guild_account(guild);

        new_guild_instance
    }

    pub fn set_representative(&mut self, new_representative: AccountNumber) {
        FractalMember::get_assert(self.fractal, new_representative);

        self.rep.inspect(|current_rep| {
            check(
                current_rep != &new_representative,
                "new representative is already the current representative",
            );
        });

        self.rep = Some(new_representative);
        self.save();
    }

    pub fn remove_representative(&mut self) {
        check_some(self.rep, "guild has no representative to remove");
        self.rep = None;
        self.save();
    }

    pub fn get(account: AccountNumber) -> Option<Self> {
        GuildTable::read().get_index_pk().get(&account)
    }

    pub fn get_assert(account: AccountNumber) -> Self {
        check_some(Self::get(account), "guild does not exist")
    }

    pub fn get_by_council(council: AccountNumber) -> Option<Self> {
        GuildTable::read().get_index_by_council().get(&council)
    }

    pub fn get_assert_by_council(council: AccountNumber) -> Self {
        check_some(
            Self::get_by_council(council),
            "guild does not exist for council",
        )
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

    pub fn council_mems(&self) -> Vec<GuildMember> {
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

    pub async fn council_members(&self) -> Vec<AccountNumber> {
        self.council_mems()
            .into_iter()
            .map(|member| member.member)
            .collect()
    }

    pub async fn rep(&self) -> Option<GuildMember> {
        self.representative()
    }
}
