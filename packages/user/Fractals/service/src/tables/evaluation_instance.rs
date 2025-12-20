use evaluations::service::{Evaluation, EvaluationTable, User, UserTable};
use psibase::{check_some, get_service, AccountNumber, Table};

use crate::constants::GUILD_EVALUATION_GROUP_SIZE;
use crate::helpers::{assign_decreasing_levels, RollingBitset};
use crate::tables::tables::{Guild, GuildMember, GuildMemberTable, GuildTable};
use crate::{
    helpers::parse_rank_to_accounts,
    tables::tables::{EvaluationInstance, EvaluationInstanceTable},
};
use async_graphql::ComplexObject;

impl EvaluationInstance {
    pub fn get(guild: AccountNumber) -> Option<Self> {
        EvaluationInstanceTable::read().get_index_pk().get(&guild)
    }

    pub fn get_assert(guild: AccountNumber) -> Self {
        check_some(Self::get(guild), "failed to find guild")
    }

    fn new(guild: AccountNumber, interval: u32, evaluation_id: u32) -> Self {
        Self {
            guild,
            evaluation_id,
            interval,
        }
    }

    fn add(guild: AccountNumber, interval: u32, evaluation_id: u32) -> Self {
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

    pub fn finish_evaluation(&self) {
        let mut guild = Guild::get_assert(self.guild);

        if guild.is_rank_ordering() {
            self.close_pending_scores(None);
        } else {
            self.close_pending_scores(Some(1));
            if guild.active_member_count() >= guild.rank_ordering_threshold as usize {
                guild.enable_rank_ordering();
            }
        }
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
        guild: AccountNumber,
        registration: u32,
        deliberation: u32,
        submission: u32,
        finish_by: u32,
        interval_seconds: u32,
    ) {
        // TODO: Return to constants;
        // let allowed_group_sizes: Vec<u8> = (MIN_GROUP_SIZE..=GUILD_EVALUATION_GROUP_SIZE).collect();
        let allowed_group_sizes: Vec<u8> = vec![2, 3, 4, 5, 6];

        let evaluation_id: u32 = psibase::services::evaluations::Wrapper::call().create(
            registration,
            deliberation,
            submission,
            finish_by,
            allowed_group_sizes,
            GUILD_EVALUATION_GROUP_SIZE,
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
        guild: AccountNumber,
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

    pub fn open_pending_scores(&self) {
        let table = GuildMemberTable::read_write();
        table
            .get_index_pk()
            .range(
                (self.guild, AccountNumber::from(0))..=(self.guild, AccountNumber::from(u64::MAX)),
            )
            .for_each(|mut account| {
                account.pending_score = Some(0);
                account.attendance = RollingBitset::from(account.attendance).mark(true).value();
                table.put(&account).unwrap();
            });
    }

    pub fn close_pending_scores(&self, overwrite_score: Option<u8>) {
        let table = GuildMemberTable::read_write();
        table
            .get_index_pk()
            .range(
                (self.guild, AccountNumber::from(0))..=(self.guild, AccountNumber::from(u64::MAX)),
            )
            .filter(|account| account.pending_score.is_some())
            .for_each(|mut account| {
                if overwrite_score.is_some() {
                    account.pending_score = overwrite_score;
                }
                account.apply_pending_score();
                table.put(&account).unwrap();
            });
    }

    pub fn award_group_scores(&self, group_number: u32, vanilla_group_result: Vec<u8>) {
        let group_members = self.users(Some(group_number)).unwrap();

        let fractal_group_result = parse_rank_to_accounts(
            vanilla_group_result,
            group_members.into_iter().map(|user| user.user).collect(),
        );

        let guild_member_levels = assign_decreasing_levels(
            fractal_group_result,
            Some(GUILD_EVALUATION_GROUP_SIZE.into()),
        );

        for (level, account) in guild_member_levels {
            GuildMember::get_assert(self.guild, account).set_pending_score(Some(level as u8));
        }
    }
}

#[ComplexObject]
impl EvaluationInstance {
    pub async fn guild_instance(&self) -> Guild {
        GuildTable::read().get_index_pk().get(&self.guild).unwrap()
    }
}
