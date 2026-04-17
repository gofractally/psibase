pub mod constants;
pub mod helpers;
pub mod tables;
#[psibase::service(name = "guilds", tables = "tables::tables")]
pub mod service {
    use crate::{
        helpers::RollingBits16,
        tables::tables::{
            EvaluationInstance, Guild, GuildMember, InitRow, InitTable, Ranking, RoleMap,
        },
    };
    use psibase::{
        services::{
            auth_dyn::{self, policy::DynamicAuthPolicy},
            transact::ServiceMethod,
        },
        *,
    };

    #[action]
    fn init() {
        let table = InitTable::new();
        table.put(&InitRow {}).unwrap();
    }

    #[pre_action(exclude(init))]
    fn check_init() {
        let table = InitTable::read();
        check(
            table.get_index_pk().get(&()).is_some(),
            "service not inited",
        );
    }

    /// Creates a guild within a fractal.
    ///
    /// # Arguments
    /// * `fractal` - Fractal to serve as juridiction of guild.
    /// * `guild_account` - The account number for the new guild.
    /// * `display_name` - The display name of the guild.
    /// * `council_role` - Council role account.
    /// * `rep_role` - Representative role account.
    #[action]
    fn create_guild(
        fractal: AccountNumber,
        guild_account: AccountNumber,
        display_name: Memo,
        council_role: AccountNumber,
        rep_role: AccountNumber,
    ) {
        let sender = get_sender();

        let sender_is_fractal_member = ::fractals::tables::tables::FractalMemberTable::read()
            .get_index_pk()
            .get(&(fractal, sender))
            .is_some();

        check(sender_is_fractal_member, "must be a fractal member");

        Guild::add(
            fractal,
            guild_account,
            sender,
            display_name,
            council_role,
            rep_role,
        );
    }

    #[action]
    fn get_scores(fractal: AccountNumber) -> Vec<(AccountNumber, u32)> {
        GuildMember::memberships_of_guild(fractal)
            .into_iter()
            .map(|membership| (membership.member, membership.score))
            .collect()
    }

    #[action]
    fn is_active(fractal: AccountNumber, member: AccountNumber) -> bool {
        GuildMember::get(fractal, member)
            .is_some_and(|member| RollingBits16::from(member.attendance).count_recent_ones(4) >= 2)
    }

    #[action]
    fn is_role_ok(fractal: AccountNumber, role_id: u8) -> bool {
        RoleMap::get(fractal, role_id).is_some()
    }

    /// Set guild display name
    ///
    /// # Arguments
    /// * `display_name` - New display name of the guild.
    #[action]
    fn set_g_disp(display_name: Memo) {
        Guild::by_sender().set_display_name(display_name);
    }

    /// Set role mapping
    ///
    /// # Arguments
    /// * `role_id` - Role ID.
    /// * `guild` - Guild account to map to
    #[action]
    fn set_role_map(role_id: u8, guild: AccountNumber) {
        RoleMap::set(get_sender(), role_id, guild);
    }

    /// Set guild bio
    ///
    /// # Arguments
    /// * `bio` - New bio of the guild.
    #[action]
    fn set_g_bio(bio: Memo) {
        Guild::by_sender().set_bio(bio);
    }

    /// Set guild description
    ///
    /// # Arguments
    /// * `description` - New description of the guild.
    #[action]
    fn set_g_desc(description: String) {
        Guild::by_sender().set_description(description);
    }

    /// Set ranked guilds
    ///
    /// # Arguments
    /// * `ranked_guilds` - Ordered guilds to be ranked, affects scores.
    #[action]
    fn set_rguilds(ranked_guilds: Vec<AccountNumber>) {
        Ranking::set_ranked_guilds(get_sender(), ranked_guilds);
    }

    /// Set ranked guilds
    ///
    /// # Arguments
    /// * `ranked_guilds` - Ordered guilds to be ranked, affects scores.
    #[action]
    fn set_thres(rank_ordering_threshold: u8) {
        Guild::by_sender().set_rank_ordering_threshold(rank_ordering_threshold);
    }

    /// Kick member from guild
    ///
    /// # Arguments
    /// * `member` - Guild member to be kicked.
    #[action]
    fn guild_kick(member: AccountNumber) {
        GuildMember::get_assert(get_sender(), member).kick();
    }

    /// Sets the schedule for an evaluation type within a fractal.
    ///
    /// # Arguments
    /// * `registration` - Unix seconds timestamp for the start of the registration phase.
    /// * `deliberation` - Unix seconds timestamp for the start of the deliberation phase.
    /// * `submission` - Unix seconds timestamp for the start of the submission phase.
    /// * `finish_by` - Unix seconds timestamp for the start of the evaluation completion phase.
    /// * `interval_seconds` - Interval in seconds for recurring evaluations.
    #[action]
    fn set_schedule(
        registration: u32,
        deliberation: u32,
        submission: u32,
        finish_by: u32,
        interval_seconds: u32,
    ) {
        Guild::by_sender().set_schedule(
            registration,
            deliberation,
            submission,
            finish_by,
            interval_seconds,
        );
    }

    /// Called when a user registers for an evaluation in a fractal.
    ///
    /// # Arguments
    /// * `evaluation_id` - The ID of the evaluation.
    /// * `account` - The account number of the registering user.
    #[action]
    fn on_ev_reg(evaluation_id: u32, account: AccountNumber) {
        check_is_eval();
        let evaluation = EvaluationInstance::get_by_evaluation_id(evaluation_id);
        check_some(
            GuildMember::get(evaluation.guild, account),
            "account must be member of guild",
        );
    }

    /// Called when a user unregisters from an evaluation in a fractal.
    ///
    /// # Arguments
    /// * `evaluation_id` - The ID of the evaluation.
    /// * `account` - The account number of the unregistering user.
    #[action]
    fn on_ev_unreg(_evaluation_id: u32, _account: AccountNumber) {}

    fn check_is_eval() {
        check(
            get_sender() == psibase::services::evaluations::SERVICE,
            "sender must be evaluations",
        );
    }

    /// Called when a user submits an attestation for decrypted proposals in a fractal evaluation.
    ///
    /// # Arguments
    /// * `evaluation_id` - The ID of the evaluation.
    /// * `group_number` - The group number within the evaluation.
    /// * `user` - The account number of the user submitting the attestation.
    /// * `attestation` - The attestation data.
    #[action]
    fn on_attest(
        evaluation_id: u32,
        group_number: u32,
        _user: AccountNumber,
        attestation: Vec<u8>,
    ) {
        check_is_eval();
        let acceptable_numbers = EvaluationInstance::get_by_evaluation_id(evaluation_id)
            .users(Some(group_number))
            .len();
        let is_valid_attestation = attestation
            .iter()
            .all(|num| *num as usize <= acceptable_numbers);
        check(is_valid_attestation, "invalid attestation");
    }

    /// Called when a group finalizes its result in a fractal evaluation.
    ///
    /// # Arguments
    /// * `evaluation_id` - The ID of the evaluation.
    /// * `group_number` - The group number within the evaluation.
    /// * `group_result` - The result data of the group.
    #[action]
    fn on_grp_fin(evaluation_id: u32, group_number: u32, group_result: Vec<u8>) {
        check_is_eval();
        EvaluationInstance::get_by_evaluation_id(evaluation_id)
            .award_group_scores(group_number, group_result);
    }

    /// Get auth policy used by fractals service.
    ///
    /// # Arguments
    /// * `fractal` - Account being checked.
    /// * `role_id` - Role ID
    #[action]
    fn role_policy(fractal: AccountNumber, role_id: u8) -> auth_dyn::policy::DynamicAuthPolicy {
        let role = check_some(
            RoleMap::get(fractal, role_id),
            "no role map set by fractal for role_id",
        );
        Guild::get_assert(role.guild).auth_policy()
    }

    fn account_policy(account: AccountNumber) -> Option<auth_dyn::policy::DynamicAuthPolicy> {
        Guild::get(account)
            .map(|guild| guild.auth_policy())
            .or(Guild::get_by_council_role(account).map(|guild| guild.council_role_auth()))
            .or(Guild::get_by_rep_role(account).map(|guild| guild.rep_role_auth()))
    }

    /// Get policy action used by AuthDyn service.
    ///
    /// # Arguments
    /// * `account` - Account being checked.
    /// * `method` - Optional method being checked.
    #[action]
    fn get_policy(
        account: AccountNumber,
        method: Option<ServiceMethod>,
    ) -> auth_dyn::policy::DynamicAuthPolicy {
        use psibase::services::accounts as Accounts;
        use psibase::services::setcode as SetCode;
        use psibase::services::staged_tx as StagedTx;

        let policy = check_some(account_policy(account), "account not supported");

        if method.is_some_and(|method| {
            let banned_service_methods: Vec<ServiceMethod> = vec![
                ServiceMethod::new(
                    Accounts::SERVICE,
                    Accounts::action_structs::setAuthServ::ACTION_NAME.into(),
                ),
                ServiceMethod::new(
                    SetCode::SERVICE,
                    SetCode::action_structs::setCode::ACTION_NAME.into(),
                ),
                ServiceMethod::new(
                    SetCode::SERVICE,
                    SetCode::action_structs::setCodeStaged::ACTION_NAME.into(),
                ),
                ServiceMethod::new(
                    StagedTx::SERVICE,
                    StagedTx::action_structs::propose::ACTION_NAME.into(),
                ),
                ServiceMethod::new(
                    StagedTx::SERVICE,
                    StagedTx::action_structs::accept::ACTION_NAME.into(),
                ),
            ];

            banned_service_methods
                .iter()
                .any(|sm| sm.method == method.method && sm.service == method.service)
        }) {
            DynamicAuthPolicy::impossible()
        } else {
            policy
        }
    }

    #[action]
    pub fn has_policy(account: AccountNumber) -> bool {
        Guild::get(account).is_some()
    }

    #[event(history)]
    pub fn evaluation_finished(guild: AccountNumber, evaluation_id: u32) {}

    #[event(history)]
    pub fn scheduled_evaluation(
        fractal: AccountNumber,
        guild: AccountNumber,
        evaluation_id: u32,
        registration: u32,
        deliberation: u32,
        submission: u32,
        finish_by: u32,
    ) {
    }
}

#[cfg(test)]
mod tests;
