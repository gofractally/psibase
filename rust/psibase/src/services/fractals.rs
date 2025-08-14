#[crate::service(name = "fractals", dispatch = false, psibase_mod = "crate")]
#[allow(non_snake_case, unused_variables)]
pub mod Service {
    use crate::AccountNumber;

    /// Creates a new account and fractal.
    ///
    /// # Arguments
    /// * `fractal_account` - The account number for the new fractal.
    /// * `name` - The name of the fractal.
    /// * `mission` - The mission statement of the fractal.
    #[action]
    fn create_fractal(fractal_account: AccountNumber, name: String, mission: String) {
        unimplemented!()
    }

    /// Starts an evaluation for the specified fractal and evaluation type.
    ///
    /// # Arguments
    /// * `fractal` - The account number of the fractal.
    /// * `evaluation_type` - The type of evaluation to start.
    #[action]
    fn start_eval(fractal: AccountNumber, evaluation_type: u8) {
        unimplemented!()
    }

    /// Allows a user to join a fractal and immediately become a citizen.
    ///
    /// # Arguments
    /// * `fractal` - The account number of the fractal to join.
    #[action]
    fn join(fractal: AccountNumber) {
        unimplemented!()
    }

    /// Withdraws the fractal members locked balance depending on it's progression
    /// 
    /// # Arguments
    /// * `fractal` - The account number of the fractal
    #[action]
    fn withdraw(fractal: AccountNumber) {
        unimplemented!()
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

    #[event(history)]
    pub fn created_fractal(fractal_account: AccountNumber) {}

    #[event(history)]
    pub fn joined_fractal(fractal_account: AccountNumber, account: AccountNumber) {}

    #[event(history)]
    pub fn evaluation_finished(fractal_account: AccountNumber, evaluation_id: u32) {}

    #[event(history)]
    pub fn scheduled_evaluation(
        fractal_account: AccountNumber,
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
