use std::collections::{HashMap, HashSet};

use evaluations::service::{Evaluation, EvaluationTable, User, UserTable};
use psibase::{check_some, get_service, AccountNumber, Table};

use crate::constants::GUILD_EVALUATION_GROUP_SIZE;
use crate::helpers::assign_decreasing_levels;
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
        let equal_levels_for_all_attendees = !guild.is_rank_ordering();
        self.close_pending_levels(equal_levels_for_all_attendees.then_some(1));
        if guild.active_member_count() >= guild.rank_ordering_threshold as usize {
            guild.enable_rank_ordering();
        }
    }

    fn internal(&self) -> Option<Evaluation> {
        EvaluationTable::with_service(evaluations::SERVICE)
            .get_index_pk()
            .get(&(get_service(), self.evaluation_id))
    }

    pub fn users(&self, group_number: Option<u32>) -> Vec<User> {
        let fractals_service = get_service();
        let evaluation_id = self.evaluation_id;

        let table = UserTable::with_service(evaluations::SERVICE);
        match group_number {
            Some(group_number) => table
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
            None => table
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
        }
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

    pub fn open_pending_levels(&self) {
        let table = GuildMemberTable::read_write();
        table
            .get_index_pk()
            .range(
                (self.guild, AccountNumber::from(0))..=(self.guild, AccountNumber::from(u64::MAX)),
            )
            .for_each(|mut account| {
                account.open_pending_level();
                account.save_to(&table);
            });
    }

    pub fn close_pending_levels(&self, forced_pending_level: Option<u8>) {
        let guild_member_table = GuildMemberTable::read_write();

        let evaluation_participants: HashSet<AccountNumber> = self
            .users(None)
            .into_iter()
            .map(|account| account.user)
            .collect();

        guild_member_table
            .get_index_pk()
            .range(
                (self.guild, AccountNumber::from(0))..=(self.guild, AccountNumber::from(u64::MAX)),
            )
            .filter(|account| {
                let was_member_at_evaluation_start = account.pending_level.is_some();
                was_member_at_evaluation_start
            })
            .for_each(|mut guild_member| {
                let attended_evaluation = evaluation_participants.contains(&guild_member.member);

                if attended_evaluation && forced_pending_level.is_some() {
                    guild_member.update_pending_level(forced_pending_level.unwrap());
                }

                guild_member.apply_pending_level_to_score(attended_evaluation);
                guild_member.save_to(&guild_member_table);
            });
    }

    pub fn award_group_scores(&self, group_number: u32, vanilla_group_result: Vec<u8>) {
        let guild_member_table = GuildMemberTable::read_write();

        let group_members: Vec<_> = self
            .users(Some(group_number))
            .into_iter()
            .map(|user| user.user)
            .collect();

        let fractal_group_result =
            parse_rank_to_accounts(vanilla_group_result, group_members.clone());

        let level_by_account: HashMap<AccountNumber, u8> = assign_decreasing_levels(
            fractal_group_result,
            Some(GUILD_EVALUATION_GROUP_SIZE.into()),
        )
        .into_iter()
        .map(|(level, member)| (member, level as u8))
        .collect();

        for account in group_members {
            // Don't assume the evaluation group member is still a GuildMember,
            // maybe he was kicked in the mean time.
            if let Some(mut guild_member) =
                GuildMember::get_from(&guild_member_table, self.guild, account)
            {
                let level_achieved = level_by_account.get(&account).copied();
                if let Some(new_level) = level_achieved {
                    guild_member.update_pending_level(new_level);
                }
                guild_member.save_to(&guild_member_table);
            }
        }
    }
}

#[ComplexObject]
impl EvaluationInstance {
    pub async fn guild_instance(&self) -> Guild {
        GuildTable::read().get_index_pk().get(&self.guild).unwrap()
    }
}
