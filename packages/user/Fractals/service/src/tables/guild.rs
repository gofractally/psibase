use async_graphql::ComplexObject;
use psibase::{check_none, check_some, AccountNumber, Memo, Table};

use crate::tables::tables::{
    Config, EvaluationInstance, Fractal, FractalMember, Guild, GuildMember, GuildTable, GID,
};

impl Guild {
    fn new(
        fractal: AccountNumber,
        rep: AccountNumber,
        display_name: Memo,
        slug: AccountNumber,
    ) -> Self {
        Self {
            id: Config::get_assert().gen_id(),
            fractal,
            bio: "".to_string().try_into().unwrap(),
            display_name,
            rep: Some(rep),
            description: "".to_string(),
            slug,
        }
    }

    pub fn add(
        fractal: AccountNumber,
        rep: AccountNumber,
        display_name: Memo,
        slug: AccountNumber,
    ) -> Self {
        check_none(
            GuildTable::new().get_index_by_slug().get(&(fractal, slug)),
            "slug already in use",
        );
        FractalMember::get_assert(fractal, rep).check_has_visa_or_citizenship();

        let new_instance = Self::new(fractal, rep, display_name, slug);
        new_instance.save();

        GuildMember::add(fractal, new_instance.id, rep);
        new_instance
    }

    pub fn get(id: GID) -> Option<Self> {
        GuildTable::read().get_index_pk().get(&id)
    }

    pub fn get_assert(id: GID) -> Self {
        check_some(Self::get(id), "guild does not exist")
    }

    pub fn get_by_slug(fractal: AccountNumber, guild_slug: AccountNumber) -> Option<Self> {
        GuildTable::read()
            .get_index_by_slug()
            .get(&(fractal, guild_slug))
    }

    pub fn get_assert_by_slug(fractal: AccountNumber, guild_slug: AccountNumber) -> Self {
        check_some(
            Self::get_by_slug(fractal, guild_slug),
            "guild does not exist",
        )
    }

    pub fn evaluation(&self) -> Option<EvaluationInstance> {
        EvaluationInstance::get(self.id)
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
            self.id,
            registration,
            deliberation,
            submission,
            finish_by,
            interval_seconds,
        )
    }

    fn save(&self) {
        GuildTable::read_write().put(&self).expect("failed to save");
    }
}

#[ComplexObject]
impl Guild {
    pub async fn eval_instance(&self) -> Option<EvaluationInstance> {
        EvaluationInstance::get(self.id)
    }

    pub async fn fractal(&self) -> Fractal {
        Fractal::get_assert(self.fractal)
    }
}
