pub mod helpers;
mod scoring;
pub mod tables;

#[psibase::service(tables = "tables::tables")]
pub mod service {

    use crate::tables::{
        fractal_member::MemberStatus,
        tables::{
            EvaluationInstance, Fractal, FractalMember, Guild, GuildApplication, GuildAttest,
            GuildMember,
        },
    };

    use psibase::fracpack::Pack;
    use psibase::services::{accounts, auth_delegate, sites, transact};
    use psibase::*;

    fn configure_new_fractal_account(fractal_account: AccountNumber) {
        accounts::Wrapper::call().newAccount(
            fractal_account,
            AccountNumber::from("auth-any"),
            true,
        );
        let set_proxy = Action {
            sender: fractal_account,
            service: sites::SERVICE,
            method: sites::action_structs::setProxy::ACTION_NAME.into(),
            rawData: sites::action_structs::setProxy {
                proxy: "fractal-core".into(),
            }
            .packed()
            .into(),
        };

        let set_owner = Action {
            sender: fractal_account,
            service: auth_delegate::SERVICE,
            method: auth_delegate::action_structs::setOwner::ACTION_NAME.into(),
            rawData: auth_delegate::action_structs::setOwner {
                owner: get_sender(),
            }
            .packed()
            .into(),
        };

        let set_auth_serv = Action {
            sender: fractal_account,
            service: accounts::SERVICE,
            method: accounts::action_structs::setAuthServ::ACTION_NAME.into(),
            rawData: accounts::action_structs::setAuthServ {
                authService: auth_delegate::SERVICE,
            }
            .packed()
            .into(),
        };

        // Create the fractal account, proxy it to fractal-core for a default UI
        transact::Wrapper::call().runAs(set_proxy, vec![]);
        transact::Wrapper::call().runAs(set_owner, vec![]);
        transact::Wrapper::call().runAs(set_auth_serv, vec![]);
    }

    /// Creates a new account and fractal.
    ///
    /// # Arguments
    /// * `fractal_account` - The account number for the new fractal.
    /// * `guild_account` - The account number for the associated guild.
    /// * `name` - The name of the fractal.
    /// * `mission` - The mission statement of the fractal.
    #[action]
    fn create_fractal(
        fractal_account: AccountNumber,
        guild_account: AccountNumber,
        name: String,
        mission: String,
    ) {
        let sender = get_sender();

        configure_new_fractal_account(fractal_account);

        Fractal::add(fractal_account, name, mission);
        FractalMember::add(fractal_account, sender, MemberStatus::Citizen);
        let genesis_guild = Guild::add(
            fractal_account,
            guild_account,
            sender,
            "Genesis".to_string().try_into().unwrap(),
        );
        GuildMember::add(genesis_guild.account, sender);

        Wrapper::emit().history().created_fractal(fractal_account);
    }

    /// Apply to join a guild
    ///
    /// # Arguments
    /// * `guild_account` - The account number for the guild.
    /// * `app` - Relevant information to the application.
    #[action]
    fn apply_guild(guild_account: AccountNumber, extra_info: String) {
        let guild = Guild::get_assert(guild_account);
        let member = check_some(
            FractalMember::get(guild.fractal, get_sender()),
            "must be a member of a fractal to apply for its guild",
        );
        check(
            MemberStatus::Exiled != member.member_status.into(),
            "you are exiled",
        );
        GuildApplication::add(guild.account, get_sender(), extra_info);
    }

    /// Set guild display name
    ///
    /// # Arguments
    /// * `display_name` - New display name of the guild.
    #[action]
    fn set_g_disp(display_name: Memo) {
        Guild::get_assert(get_sender()).set_display_name(display_name);
    }

    /// Set guild bio
    ///
    /// # Arguments
    /// * `bio` - New bio of the guild.
    #[action]
    fn set_g_bio(bio: Memo) {
        Guild::get_assert(get_sender()).set_bio(bio);
    }

    /// Set guild description
    ///
    /// # Arguments
    /// * `description` - New description of the guild.
    #[action]
    fn set_g_desc(description: String) {
        Guild::get_assert(get_sender()).set_description(description);
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
    /// * `comment` - Any comment relevant to application.
    /// * `endorses` - True if in favour of application.
    #[action]
    fn at_mem_app(
        guild_account: AccountNumber,
        member: AccountNumber,
        comment: String,
        endorses: bool,
    ) {
        let sender = get_sender();

        let guild = Guild::get_assert(guild_account);
        let application = check_some(
            GuildApplication::get(guild.account, member),
            "application does not exist",
        );
        let fractal_membership = check_some(
            FractalMember::get(guild.fractal, sender),
            "must be a member of a fractal to attest",
        );
        check(
            MemberStatus::Exiled != fractal_membership.member_status.into(),
            "you are exiled",
        );
        check_some(
            GuildMember::get(guild.account, sender),
            "must be member of the guild to attest",
        );
        GuildAttest::add(guild.account, member, sender, comment, endorses);

        if guild_account == sender || guild.rep.is_some_and(|rep| rep == sender) {
            application.conclude(endorses)
        }
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
        evaluation.set_pending_scores(0);

        psibase::services::evaluations::Wrapper::call().start(evaluation.evaluation_id);
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

        check(sender != fractal, "a fractal cannot join itself");
        check_none(
            FractalMember::get(fractal, sender),
            "you are already a member",
        );
        check_none(
            Fractal::get(sender),
            "a fractal cannot join another fractal",
        );

        FractalMember::add(fractal, sender, MemberStatus::Visa);

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
        Guild::get_assert(get_sender()).set_schedule(
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
        let fractal = Guild::get_assert(evaluation.guild).fractal;

        evaluation.save_pending_scores();

        Wrapper::emit().history().evaluation_finished(
            fractal,
            evaluation.guild,
            evaluation.evaluation_id,
        );

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
    #[action]
    fn create_guild(fractal: AccountNumber, guild_account: AccountNumber, display_name: Memo) {
        check(
            FractalMember::get_assert(fractal, get_sender()).is_citizen(),
            "must be a citizen to create a guild",
        );
        Guild::add(fractal, guild_account, get_sender(), display_name);
    }

    #[event(history)]
    pub fn created_fractal(fractal_account: AccountNumber) {}

    #[event(history)]
    pub fn joined_fractal(fractal_account: AccountNumber, account: AccountNumber) {}

    #[event(history)]
    pub fn evaluation_finished(fractal: AccountNumber, guild: AccountNumber, evaluation_id: u32) {}

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
