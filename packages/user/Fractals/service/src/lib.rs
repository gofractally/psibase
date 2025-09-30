pub mod helpers;
mod scoring;
pub mod tables;

#[psibase::service(tables = "tables::tables")]
pub mod service {

    use crate::tables::{
        fractal_member::MemberStatus,
        tables::{EvaluationInstance, Fractal, FractalMember, Guild, GuildMember, GID},
    };

    use psibase::*;

    /// TEMP ACTION
    #[action]
    fn init() {
        ///
        let fractal_core: AccountNumber = "fractal-core".into();
        let a_account: AccountNumber = "a".into();
        Fractal::add(
            fractal_core,
            "Fractal Core".to_string(),
            "mission".to_string(),
        );
        FractalMember::add(fractal_core, "a".into(), MemberStatus::Citizen);
        let discovery_guild = Guild::add(
            fractal_core,
            a_account,
            "Discovery".to_string().try_into().unwrap(),
            "discovery".into(),
        );
        GuildMember::add(fractal_core, discovery_guild.id, a_account);
    }

    /// Creates a new account and fractal.
    ///
    /// # Arguments
    /// * `fractal_account` - The account number for the new fractal.
    /// * `name` - The name of the fractal.
    /// * `mission` - The mission statement of the fractal.
    #[action]
    fn create_fractal(fractal_account: AccountNumber, name: String, mission: String) {
        let sender = get_sender();
        psibase::services::auth_delegate::Wrapper::call().newAccount(fractal_account, sender);

        Fractal::add(fractal_account, name, mission);
        FractalMember::add(fractal_account, sender, MemberStatus::Citizen);
        let discovery_guild = Guild::add(
            fractal_account,
            sender,
            "Discovery".to_string().try_into().unwrap(),
            "discovery".into(),
        );
        GuildMember::add(fractal_account, discovery_guild.id, sender);

        Wrapper::emit().history().created_fractal(fractal_account);
    }

    /// Starts an evaluation for the specified fractal and evaluation type.
    ///
    /// # Arguments
    /// * `guild` - The ID of the guild.
    #[action]
    fn start_eval(guild_id: GID) {
        let evaluation = EvaluationInstance::get_assert(guild_id);

        evaluation.set_pending_scores(0);

        psibase::services::evaluations::Wrapper::call().start(evaluation.evaluation_id);
    }

    /// Allows a user to join a fractal and immediately become a citizen.
    ///
    /// Cannot be called by a fractal.
    ///
    /// # Arguments
    /// * `fractal` - The account number of the fractal to join.
    #[action]
    fn join(fractal: AccountNumber) {
        let sender = get_sender();

        check(sender != fractal, "a fractal cannot join itself");
        check_none(
            FractalMember::get(fractal, sender),
            "you are already a member",
        );
        check_none(
            Fractal::get(sender),
            "a fractal cannot join another fractal",
        );

        FractalMember::add(fractal, sender, MemberStatus::Citizen);

        Wrapper::emit().history().joined_fractal(fractal, sender);
    }

    /// Sets the schedule for an evaluation type within a fractal.
    ///
    /// # Arguments
    /// * `evaluation_type` - The type of evaluation.
    /// * `registration` - Unix seconds timestamp for the start of the registration phase.
    /// * `deliberation` - Unix seconds timestamp for the start of the deliberation phase.
    /// * `submission` - Unix seconds timestamp for the start of the submission phase.
    /// * `finish_by` - Unix seconds timestamp for the start of the evaluation completion phase.
    /// * `interval_seconds` - Interval in seconds for recurring evaluations.
    #[action]
    fn set_schedule(
        evaluation_type: u8,
        registration: u32,
        deliberation: u32,
        submission: u32,
        finish_by: u32,
        interval_seconds: u32,
    ) {
        Fractal::get_assert(get_sender()).set_schedule(
            evaluation_type.into(),
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

        evaluation.save_pending_scores();

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
            .unwrap()
            .len();
        let is_valid_attestion = attestation
            .iter()
            .all(|num| *num as usize <= acceptable_numbers);
        check(is_valid_attestion, "invalid attestation");
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

    #[action]
    fn create_guild(fractal: AccountNumber, display_name: Memo, slug: AccountNumber) {
        check(
            FractalMember::get_assert(fractal, get_sender()).is_citizen(),
            "must be a citizen to create a guild",
        );
        Guild::add(fractal, get_sender(), display_name, slug);
    }

    #[event(history)]
    pub fn created_fractal(fractal_account: AccountNumber) {}

    #[event(history)]
    pub fn joined_fractal(fractal_account: AccountNumber, account: AccountNumber) {}

    #[event(history)]
    pub fn evaluation_finished(guild: GID, evaluation_id: u32) {}

    #[event(history)]
    pub fn scheduled_evaluation(
        fractal_account: AccountNumber,
        guild: GID,
        evaluation_id: u32,
        registration: u32,
        deliberation: u32,
        submission: u32,
        finish_by: u32,
    ) {
    }
}
