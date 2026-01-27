pub mod helpers;
mod scoring;
pub mod tables;

pub mod constants {
    pub const ONE_DAY: u32 = 86400;
    pub const ONE_WEEK: u32 = ONE_DAY * 7;
    const ONE_YEAR: u32 = ONE_WEEK * 52;

    pub mod token_distributions {
        pub const TOKEN_SUPPLY: u64 = 210_000_000_000;

        pub mod consensus_rewards {
            pub const REWARD_DISTRIBUTION: u64 = super::TOKEN_SUPPLY / 4;
            pub const INITIAL_REWARD_DISTRIBUTION: u64 = REWARD_DISTRIBUTION / 100;
            pub const REMAINING_REWARD_DISTRIBUTION: u64 =
                REWARD_DISTRIBUTION - INITIAL_REWARD_DISTRIBUTION;
        }
    }
    pub const TOKEN_PRECISION: u8 = 4;
    pub const FRACTAL_STREAM_HALF_LIFE: u32 = ONE_YEAR * 25;
    pub const MEMBER_STREAM_HALF_LIFE: u32 = ONE_WEEK * 13;
    pub const MIN_FRACTAL_DISTRIBUTION_INTERVAL_SECONDS: u32 = ONE_DAY;
    pub const MAX_FRACTAL_DISTRIBUTION_INTERVAL_SECONDS: u32 = ONE_WEEK * 8;
    pub const COUNCIL_SEATS: u8 = 6;

    pub const MIN_GROUP_SIZE: u8 = 4;
    pub const MAX_GROUP_SIZE: u8 = 10;

    pub const GUILD_EVALUATION_GROUP_SIZE: u8 = 6;

    pub const DEFAULT_RANKED_GUILD_SLOT_COUNT: u8 = 12;
    pub const DEFAULT_FRACTAL_DISTRIBUTION_INTERVAL: u32 = ONE_WEEK;

    pub const DEFAULT_RANK_ORDERING_THRESHOLD: u8 = 8;
    pub const MIN_RANK_ORDERING_THRESHOLD: u8 = 4;

    pub const DEFAULT_TOKEN_INIT_THRESHOLD: u8 = 8;
    pub const MIN_TOKEN_INIT_THRESHOLD: u8 = 4;

    // Simple limitation + also related to fibonacci function limit.
    pub const MAX_RANKED_GUILDS: u8 = 25;

    // Expected scaling for use of the continuous_fibonacci func
    pub const SCORE_SCALE: u32 = 10_000;

    // Determine score sensitivity
    pub const EMA_ALPHA_DENOMINATOR: u32 = 6;

    // Candidacy cool down determines how long a guild member must wait
    // before he can make himself a candidate again.
    pub const DEFAULT_CANDIDACY_COOLDOWN: u32 = ONE_WEEK;
    pub const MAX_CANDIDACY_COOLDOWN: u32 = ONE_YEAR / 4;
}

#[psibase::service(tables = "tables::tables", recursive = true)]
pub mod service {

    use crate::tables::{
        fractal_member::MemberStatus,
        tables::{
            EvaluationInstance, Fractal, FractalMember, Guild, GuildApplication, GuildMember,
            RewardConsensus,
        },
    };

    use psibase::services::{
        auth_dyn::{self, policy::DynamicAuthPolicy},
        transact::ServiceMethod,
    };
    use psibase::*;

    /// Creates a new account and fractal.
    ///
    /// # Arguments
    /// * `fractal_account` - The account number for the new fractal.
    /// * `guild_account` - The account number for the associated guild.
    /// * `name` - The name of the fractal.
    /// * `mission` - The mission statement of the fractal.
    /// * `council_role` - Council role account.
    /// * `rep_role` - Representative role account.
    #[action]
    fn create_fractal(
        fractal_account: AccountNumber,
        guild_account: AccountNumber,
        name: String,
        mission: String,
        council_role: AccountNumber,
        rep_role: AccountNumber,
    ) {
        let sender = get_sender();

        Fractal::add(fractal_account, name, mission, guild_account);

        FractalMember::add(fractal_account, sender, MemberStatus::Citizen);
        Guild::add(
            fractal_account,
            guild_account,
            sender,
            "Genesis".to_string().try_into().unwrap(),
            council_role,
            rep_role,
        );

        Wrapper::emit().history().created_fractal(fractal_account);
    }

    /// Initialise a token for a fractal.
    ///
    /// Called only once per fractal.
    /// Must be called by legislature.  
    ///
    /// # Arguments
    /// * `fractal` - The account number of the fractal.
    #[action]
    fn init_token(fractal: AccountNumber) {
        Fractal::get_assert(fractal).init_token();
    }

    /// Apply to join a guild
    ///
    /// # Arguments
    /// * `guild_account` - The account number for the guild.
    /// * `extra_info` - Relevant information to the application.
    #[action]
    fn apply_guild(guild_account: AccountNumber, extra_info: String) {
        let guild = Guild::get_assert(guild_account);
        let sender = get_sender();
        check_some(
            FractalMember::get(guild.fractal, sender),
            "must be a member of a fractal to apply for its guild",
        );
        GuildApplication::add(guild.account, sender, extra_info);
    }

    /// Set Fractal distribution interval
    ///
    /// # Arguments
    /// * `fractal` - Fractal to update.
    /// * `distribution_interval_secs` - New fractal distribution interval in seconds.
    #[action]
    fn set_dist_int(fractal: AccountNumber, distribution_interval_secs: u32) {
        Fractal::get_assert(fractal).check_sender_is_legislature();

        RewardConsensus::get_assert(fractal).set_distribution_interval(distribution_interval_secs);
    }

    /// Set guild display name
    ///
    /// # Arguments
    /// * `display_name` - New display name of the guild.
    #[action]
    fn set_g_disp(display_name: Memo) {
        Guild::by_sender().set_display_name(display_name);
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

    /// Kick member from guild
    ///
    /// # Arguments
    /// * `member` - Guild member to be kicked.
    #[action]
    fn guild_kick(member: AccountNumber) {
        GuildMember::get_assert(get_sender(), member).kick();
    }

    /// Attest Guild Membership application
    ///
    /// # Arguments
    /// * `guild_account` - The account number for the guild.
    /// * `member` - Member to attest.
    /// * `comment` - Any comment relevant to the application.
    /// * `endorses` - True if in favour of the application.
    #[action]
    fn at_mem_app(
        guild_account: AccountNumber,
        applicant: AccountNumber,
        comment: String,
        endorses: bool,
    ) {
        GuildApplication::get_assert(guild_account, applicant).attest(comment, endorses);
    }

    /// Conclude Guild Membership application
    ///
    /// # Arguments
    /// * `applicant` - Account of the applicant.
    /// * `accepted` - True to accept application, False will deny and delete the application.
    #[action]
    fn con_mem_app(applicant: AccountNumber, accepted: bool) {
        GuildApplication::get_assert(get_sender(), applicant).conclude(accepted);
    }

    /// Starts an evaluation for the specified guild.
    ///
    /// # Arguments
    /// * `guild_account` - The account number for the guild.
    #[action]
    fn start_eval(guild_account: AccountNumber) {
        let evaluation = check_some(
            Guild::get_assert(guild_account).evaluation(),
            "evaluation instance does not exist for guild",
        );
        evaluation.open_pending_levels();

        psibase::services::evaluations::Wrapper::call().start(evaluation.evaluation_id);
    }

    /// Set rank ordering threshold.
    ///
    /// Amount of active participants a guild must have prior to auto-enabling rank ordering.  
    ///
    /// # Arguments
    /// * `threshold` - The minimum amount of active members required.
    #[action]
    fn set_rnk_thrs(threshold: u8) {
        Guild::by_sender().set_rank_ordering_threshold(threshold);
    }

    /// Register candidacy.
    ///
    /// Register your candidacy to serve on a Guild council.  
    ///
    /// # Arguments
    /// * `guild` - Guild candidate is member of
    /// * `active`- True to become a candidate, False to retire
    #[action]
    fn reg_can(guild: AccountNumber, active: bool) {
        GuildMember::get_assert(guild, get_sender()).set_candidacy(active);
    }

    /// Set the candidacy cooldown period.
    ///
    /// This defines how many seconds a guild member must wait after retiring their candidacy
    /// before they are allowed to become a candidate again.
    ///
    /// # Arguments
    /// * `cooldown_seconds` - The cooldown duration in seconds (0 disables the cooldown).
    #[action]
    fn set_can_cool(cooldown_seconds: u32) {
        Guild::by_sender().set_candidacy_cooldown(cooldown_seconds);
    }

    /// Set token threshold.
    ///
    /// Sets the required amount of active members in the legislature guild before the token can be initialised.  
    ///
    /// # Arguments
    /// * `fractal` - Fractal to update.
    /// * `threshold` - The minimum amount of active members required.
    #[action]
    fn set_tkn_thrs(fractal: AccountNumber, threshold: u8) {
        let mut fractal = Fractal::get_assert(fractal);
        fractal.check_sender_is_legislature();
        fractal.set_token_threshold(threshold);
    }

    /// Allows a user to join a fractal and immediately become a visa holder.
    ///
    /// Cannot be called by a fractal.
    ///
    /// # Arguments
    /// * `fractal` - The account number of the fractal to join.
    #[action]
    fn join(fractal: AccountNumber) {
        let sender = get_sender();

        check_none(
            account_policy(sender),
            "managed accounts cannot join a fractal",
        );

        // Give founding members (members joined prior to live token) immediate citizenship
        // otherwise visa.
        let is_live_token = RewardConsensus::get(fractal).is_some();
        let member_status = if is_live_token {
            MemberStatus::Visa
        } else {
            MemberStatus::Citizen
        };

        FractalMember::add(fractal, sender, member_status);

        Wrapper::emit().history().joined_fractal(fractal, sender);
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

    fn check_is_eval() {
        check(
            get_sender() == psibase::services::evaluations::SERVICE,
            "sender must be evaluations",
        );
    }

    /// Called when an evaluation in a fractal is finalized.
    ///
    /// # Arguments
    /// * `evaluation_id` - The ID of the evaluation.
    #[action]
    fn on_eval_fin(evaluation_id: u32) {
        check_is_eval();

        let mut evaluation = EvaluationInstance::get_by_evaluation_id(evaluation_id);
        evaluation.finish_evaluation();

        Wrapper::emit()
            .history()
            .evaluation_finished(evaluation.guild, evaluation.evaluation_id);

        evaluation.schedule_next_evaluation();
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

    /// Creates a guild within a fractal.
    ///
    /// # Arguments
    /// * `fractal` - The account number of the fractal.
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
        check(
            FractalMember::get_assert(fractal, sender).is_citizen(),
            "must be a citizen to create a guild",
        );
        Guild::add(
            fractal,
            guild_account,
            sender,
            display_name,
            council_role,
            rep_role,
        );
    }

    /// Exile a fractal member.
    ///
    /// Must be called by judiciary.  
    ///
    /// # Arguments
    /// * `fractal` - The account number of the fractal.
    /// * `member` - The fractal member to be exiled.
    #[action]
    fn exile_member(fractal: AccountNumber, member: AccountNumber) {
        Fractal::get_assert(fractal).check_sender_is_judiciary();
        FractalMember::get_assert(fractal, member).exile();
    }

    /// Set ranked guild slots.
    ///
    /// Must be called by legislature.  
    ///
    /// # Arguments
    /// * `fractal` - The account number of the fractal.
    /// * `slots_count` - The number of ranked guild slots.
    #[action]
    fn set_rank_g_s(fractal: AccountNumber, slots_count: u8) {
        Fractal::get_assert(fractal).check_sender_is_legislature();
        RewardConsensus::get_assert(fractal).set_ranked_guild_slot_count(slots_count);
    }

    /// Distribute token for a fractal.
    ///
    /// # Arguments
    /// * `fractal` - The account number of the fractal.
    #[action]
    fn dist_token(fractal: AccountNumber) {
        RewardConsensus::get_assert(fractal).distribute_tokens();
    }

    /// Rank guilds for a fractal
    ///
    /// This action assigns the fractal's consensus reward distribution to the provided
    /// ordered list of guilds using a **Fibonacci-weighted distribution**, where earlier
    /// guilds in the vector receive progressively larger shares.
    ///
    /// Must be called by the legislature.  
    ///
    /// # Arguments
    /// * `fractal` - The account number of the fractal.
    /// * `guilds` - Ranked guilds, from highest rewarded to lowest.
    #[action]
    fn rank_guilds(fractal: AccountNumber, guilds: Vec<AccountNumber>) {
        Fractal::get_assert(fractal).check_sender_is_legislature();
        RewardConsensus::get_assert(fractal).set_ranked_guilds(guilds);
    }

    /// Set a new representative of the Guild.
    ///
    /// # Arguments
    /// * `new_representative` - The account number of the new representative.
    #[action]
    fn set_g_rep(new_representative: AccountNumber) {
        Guild::by_sender().set_representative(new_representative);
    }

    /// Resign as representative of a guild.
    ///
    /// Called by current representative of guild.
    #[action]
    fn resign_g_rep() {
        check_some(
            Guild::get_by_rep_role(get_sender()),
            "sender must be representative role account of guild",
        )
        .remove_representative();
    }

    /// Forcibly remove the current representative of the guild.
    ///
    /// Called by council role account of the guild.
    #[action]
    fn remove_g_rep() {
        check_some(
            Guild::get_by_council_role(get_sender()),
            "sender must be council role account of guild",
        )
        .remove_representative();
    }

    fn account_policy(account: AccountNumber) -> Option<auth_dyn::policy::DynamicAuthPolicy> {
        Fractal::get(account)
            .map(|fractal| fractal.auth_policy())
            .or(Guild::get(account).map(|guild| guild.guild_auth()))
            .or(Guild::get_by_rep_role(account).map(|guild| guild.rep_role_auth()))
            .or(Guild::get_by_council_role(account).map(|guild| guild.council_role_auth()))
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

    /// Has policy action used by AuthDyn service.
    ///
    /// # Arguments
    /// * `account` - Account being checked.
    #[action]
    fn has_policy(account: AccountNumber) -> bool {
        account_policy(account).is_some()
    }

    #[event(history)]
    pub fn created_fractal(fractal_account: AccountNumber) {}

    #[event(history)]
    pub fn joined_fractal(fractal_account: AccountNumber, account: AccountNumber) {}

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
