#[crate::service(name = "fractals", dispatch = false, psibase_mod = "crate")]
#[allow(non_snake_case, unused_variables)]
pub mod Service {
    use crate::services::auth_dyn::policy::DynamicAuthPolicy;
    use crate::services::transact::ServiceMethod;
    use crate::AccountNumber;
    use crate::Memo;

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
        unimplemented!()
    }

    /// Set Fractal distribution interval
    ///
    /// # Arguments
    /// * `fractal` - Fractal to update.
    /// * `distribution_interval_secs` - New fractal distribution interval in seconds.
    #[action]
    fn set_dist_int(fractal: AccountNumber, distribution_interval_secs: u32) {
        unimplemented!()
    }

    /// Apply to join a guild
    ///
    /// # Arguments
    /// * `guild_account` - The account number for the guild.
    /// * `extra_info` - Relevant information to the application.
    #[action]
    fn apply_guild(guild_account: AccountNumber, extra_info: String) {
        unimplemented!()
    }

    /// Set guild display name
    ///
    /// # Arguments
    /// * `display_name` - New display name of the guild.
    #[action]
    fn set_g_disp(display_name: Memo) {
        unimplemented!()
    }

    /// Set guild bio
    ///
    /// # Arguments
    /// * `bio` - New bio of the guild.
    #[action]
    fn set_g_bio(bio: Memo) {
        unimplemented!()
    }

    /// Exile a fractal member.
    ///
    /// # Arguments
    /// * `fractal` - The account number of the fractal.
    /// * `member` - The fractal member to be exiled.
    #[action]
    fn exile_member(fractal: AccountNumber, member: AccountNumber) {
        unimplemented!()
    }

    /// Set guild description
    ///
    /// # Arguments
    /// * `description` - New description of the guild.
    #[action]
    fn set_g_desc(description: String) {
        unimplemented!()
    }

    /// Kick member from guild
    ///
    /// # Arguments
    /// * `member` - Guild member to be kicked.
    #[action]
    fn guild_kick(member: AccountNumber) {
        unimplemented!()
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
        member: AccountNumber,
        comment: String,
        endorses: bool,
    ) {
        unimplemented!()
    }

    /// Conclude Guild Membership application
    ///
    /// # Arguments
    /// * `applicant` - Account of the applicant.
    /// * `accepted` - True to accept application, False will deny and delete the application.
    #[action]
    fn con_mem_app(applicant: AccountNumber, accepted: bool) {
        unimplemented!()
    }

    /// Starts an evaluation for the specified guild.
    ///
    /// # Arguments
    /// * `guild_account` - The account number for the guild.
    #[action]
    fn start_eval(guild_account: AccountNumber) {
        unimplemented!()
    }

    /// Allows a user to join a fractal and immediately become a citizen.
    ///
    /// Cannot be called by a fractal.
    ///
    /// # Arguments
    /// * `fractal` - The account number of the fractal to join.
    #[action]
    fn join(fractal: AccountNumber) {
        unimplemented!()
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
        unimplemented!()
    }

    /// Called when an evaluation in a fractal is finalized.
    ///
    /// # Arguments
    /// * `evaluation_id` - The ID of the evaluation.
    #[action]
    fn on_eval_fin(evaluation_id: u32) {
        unimplemented!()
    }

    /// Called when a user registers for an evaluation in a fractal.
    ///
    /// # Arguments
    /// * `evaluation_id` - The ID of the evaluation.
    /// * `account` - The account number of the registering user.
    #[action]
    fn on_ev_reg(evaluation_id: u32, account: AccountNumber) {
        unimplemented!()
    }

    /// Called when a user unregisters from an evaluation in a fractal.
    ///
    /// # Arguments
    /// * `evaluation_id` - The ID of the evaluation.
    /// * `account` - The account number of the unregistering user.
    #[action]
    fn on_ev_unreg(evaluation_id: u32, account: AccountNumber) {
        unimplemented!()
    }

    /// Called when a user submits an attestation for decrypted proposals in a fractal evaluation.
    ///
    /// # Arguments
    /// * `evaluation_id` - The ID of the evaluation.
    /// * `group_number` - The group number within the evaluation.
    /// * `user` - The account number of the user submitting the attestation.
    /// * `attestation` - The attestation data.
    #[action]
    fn on_attest(evaluation_id: u32, group_number: u32, user: AccountNumber, attestation: Vec<u8>) {
        unimplemented!()
    }

    /// Called when a group finalizes its result in a fractal evaluation.
    ///
    /// # Arguments
    /// * `evaluation_id` - The ID of the evaluation.
    /// * `group_number` - The group number within the evaluation.
    /// * `group_result` - The result data of the group.
    #[action]
    fn on_grp_fin(evaluation_id: u32, group_number: u32, group_result: Vec<u8>) {
        unimplemented!()
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
        unimplemented!()
    }

    /// Set a new representative of the Guild.
    ///
    /// # Arguments
    /// * `new_representative` - The account number of the new representative.
    #[action]
    fn set_g_rep(new_representative: AccountNumber) {
        unimplemented!()
    }

    /// Resign as representative of a guild.
    ///
    /// Called by current representative of guild.
    #[action]
    fn resign_g_rep() {
        unimplemented!()
    }

    /// Forcibly remove the current representative of the guild.
    ///
    /// Called by council role account of the guild.
    #[action]
    fn remove_g_rep() {
        unimplemented!()
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
        unimplemented!()
    }

    /// Get policy action used by AuthDyn service.
    ///
    /// # Arguments
    /// * `account` - Account being checked.
    #[action]
    fn get_policy(account: AccountNumber, method: Option<ServiceMethod>) -> DynamicAuthPolicy {
        unimplemented!()
    }

    /// Has policy action used by AuthDyn service.
    ///
    /// # Arguments
    /// * `account` - Account being checked.
    #[action]
    fn has_policy(account: AccountNumber) -> bool {
        unimplemented!()
    }

    /// Distribute token for a fractal.
    ///
    /// # Arguments
    /// * `fractal` - The account number of the fractal.
    #[action]
    fn dist_token(fractal: AccountNumber) {
        unimplemented!()
    }

    /// Set rank ordering threshold.
    ///
    /// Amount of active participants a guild must have prior to auto-enabling rank ordering.  
    ///
    /// # Arguments
    /// * `threshold` - The minimum amount of active members required.
    #[action]
    fn set_rnk_thrs(threshold: u8) {
        unimplemented!()
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
        unimplemented!()
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
        unimplemented!()
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
        unimplemented!()
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
        unimplemented!()
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
        unimplemented!()
    }

    #[event(history)]
    pub fn created_fractal(fractal_account: AccountNumber) {}

    #[event(history)]
    pub fn joined_fractal(fractal_account: AccountNumber, account: AccountNumber) {}

    #[event(history)]
    pub fn evaluation_finished(guild_account: AccountNumber, evaluation_id: u32) {}

    #[event(history)]
    pub fn scheduled_evaluation(
        fractal_account: AccountNumber,
        guild_account: AccountNumber,
        evaluation_id: u32,
        registration: u32,
        deliberation: u32,
        submission: u32,
        finish_by: u32,
    ) {
    }
}

#[test]
fn verify_schema() {
    crate::assert_schema_matches_package::<Wrapper>();
}
