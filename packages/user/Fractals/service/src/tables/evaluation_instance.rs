use evaluations::service::{Evaluation, EvaluationTable, User, UserTable};
use psibase::{check_some, get_service, AccountNumber, Table};

use crate::tables::tables::{Guild, GuildMember, GuildMemberTable, GuildTable, GID};
use crate::{
    helpers::parse_rank_to_accounts,
    tables::tables::{EvaluationInstance, EvaluationInstanceTable},
};
use async_graphql::ComplexObject;

impl EvaluationInstance {
    pub fn get(guild: GID) -> Option<Self> {
        EvaluationInstanceTable::read().get_index_pk().get(&guild)
    }

    pub fn get_assert(guild: GID) -> Self {
        check_some(Self::get(guild), "failed to find guild")
    }

    fn new(guild: GID, interval: u32, evaluation_id: u32) -> Self {
        Self {
            guild,
            evaluation_id,
            interval,
        }
    }

    fn add(guild: GID, interval: u32, evaluation_id: u32) -> Self {
        let instance = Self::new(guild, interval, evaluation_id);
        instance.save();
        instance
    }

    pub fn get_by_evaluation_id(eval_id: u32) -> Self {
        let table = EvaluationInstanceTable::read();

        check_some(
            table.get_index_by_evaluation().get(&eval_id),
            "failed finding by eval id",
        )
    }

    fn internal(&self) -> Option<Evaluation> {
        EvaluationTable::with_service(evaluations::SERVICE)
            .get_index_pk()
            .get(&(get_service(), self.evaluation_id))
    }

    pub fn users(&self, group_number: Option<u32>) -> Option<Vec<User>> {
        let fractals_service = get_service();
        let evaluation_id = self.evaluation_id;

        let res = match group_number {
            Some(group_number) => UserTable::with_service(evaluations::SERVICE)
                .get_index_by_group()
                .range(
                    (
                        fractals_service,
                        evaluation_id,
                        Some(group_number),
                        AccountNumber::new(0),
                    )
                        ..=(
                            fractals_service,
                            evaluation_id,
                            Some(group_number),
                            AccountNumber::new(u64::MAX),
                        ),
                )
                .collect(),
            None => UserTable::with_service(evaluations::SERVICE)
                .get_index_pk()
                .range(
                    (fractals_service, evaluation_id, AccountNumber::new(0))
                        ..=(
                            fractals_service,
                            evaluation_id,
                            AccountNumber::new(u64::MAX),
                        ),
                )
                .collect(),
        };

        Some(res)
    }

    fn create_evaluation(
        guild: GID,
        registration: u32,
        deliberation: u32,
        submission: u32,
        finish_by: u32,
        interval_seconds: u32,
    ) {
        let evaluation_id: u32 = psibase::services::evaluations::Wrapper::call().create(
            registration,
            deliberation,
            submission,
            finish_by,
            // TODO: Change back to 4,5,6;
            vec![2, 3, 4, 5, 6],
            6,
            true,
        );

        Self::add(guild, interval_seconds, evaluation_id);

        let guild_instance = Guild::get_assert(guild);

        crate::Wrapper::emit().history().scheduled_evaluation(
            guild_instance.fractal,
            guild,
            evaluation_id,
            registration,
            deliberation,
            submission,
            finish_by,
        );
    }

    pub fn schedule_next_evaluation(&mut self) {
        let interval = self.interval;

        let evaluation = check_some(
            self.internal(),
            "expected existing evaluation to set the next one",
        );

        Self::create_evaluation(
            self.guild,
            evaluation.registration_starts + interval,
            evaluation.deliberation_starts + interval,
            evaluation.submission_starts + interval,
            evaluation.finish_by + interval,
            interval,
        );
    }

    pub fn set_evaluation_schedule(
        guild: GID,
        registration: u32,
        deliberation: u32,
        submission: u32,
        finish_by: u32,
        interval_seconds: u32,
    ) {
        Self::get(guild).map(|existing| {
            psibase::services::evaluations::Wrapper::call().delete(existing.evaluation_id, false);
        });

        Self::create_evaluation(
            guild,
            registration,
            deliberation,
            submission,
            finish_by,
            interval_seconds,
        );
    }

    fn save(&self) {
        let table = EvaluationInstanceTable::read_write();
        table.put(&self).expect("failed to save");
    }

    fn guild_members(&self) -> Vec<GuildMember> {
        let table = GuildMemberTable::read();

        table
            .get_index_pk()
            .range(
                (self.guild, AccountNumber::from(0))..=(self.guild, AccountNumber::from(u64::MAX)),
            )
            .collect()
    }

    pub fn set_pending_scores(&self, pending_score: u32) {
        self.guild_members().into_iter().for_each(|mut account| {
            account.set_pending_score(pending_score);
        });
    }

    pub fn award_group_scores(&self, group_number: u32, vanilla_group_result: Vec<u8>) {
        let group_members = self.users(Some(group_number)).unwrap();

        let fractal_group_result = parse_rank_to_accounts(
            vanilla_group_result,
            group_members.into_iter().map(|user| user.user).collect(),
        );

        for (index, account) in fractal_group_result.into_iter().enumerate() {
            let level = (6 as usize) - index;
            GuildMember::get_assert(self.guild, account).set_pending_score(level as u32);
        }
    }

    pub fn save_pending_scores(&self) {
        self.guild_members().into_iter().for_each(|mut account| {
            account.save_pending_score();
        });
    }
}

#[ComplexObject]
impl EvaluationInstance {
    pub async fn guild_instance(&self) -> Guild {
        GuildTable::new()
            .get_index_pk()
            .get(&self.evaluation_id)
            .unwrap()
    }
}
