#[crate::service(
    name = "eval-hooks",
    actions = "hooks_actions",
    wrapper = "hooks_wrapper",
    structs = "hooks_structs",
    dispatch = false,
    pub_constant = false,
    psibase_mod = "crate"
)]
#[allow(non_snake_case, unused_variables)]
pub mod Hooks {
    use crate::AccountNumber;

    #[action]
    fn on_ev_reg(evaluation_id: u32, account: AccountNumber) {
        unimplemented!()
    }

    #[action]
    fn on_ev_unreg(evaluation_id: u32, account: AccountNumber) {
        unimplemented!()
    }

    #[action]
    fn on_grp_fin(evaluation_id: u32, group_number: u32, result: Vec<u8>) {
        unimplemented!()
    }

    #[action]
    fn on_attest(evaluation_id: u32, group_number: u32, user: AccountNumber, attestation: Vec<u8>) {
        unimplemented!()
    }
}

#[crate::service(name = "evaluations", dispatch = false, psibase_mod = "crate")]
#[allow(non_snake_case, unused_variables)]
pub mod Service {
    use crate::AccountNumber;

    /// Creates and schedules a new evaluation with specified phases and parameters.
    ///
    /// # Arguments
    /// * `registration` - Unix seconds timestamp for the start of the registration phase.
    /// * `deliberation` - Unix seconds timestamp for the start of the deliberation phase.
    /// * `submission` - Unix seconds timestamp for the start of the submission phase.
    /// * `finish_by` - Unix seconds timestamp for the start of the evaluation completion phase.
    /// * `allowed_group_sizes` - Vector of allowed group sizes (sizes must be greater than 0, traditionally [4, 5, 6]).
    /// * `num_options` - Number of options available for proposals (traditionally 6).
    /// * `use_hooks` - Flag to enable or disable hooks for the evaluation.
    ///
    /// # Returns
    /// The ID of the newly created evaluation.    
    #[action]
    fn create(
        registration: u32,
        deliberation: u32,
        submission: u32,
        finish_by: u32,
        allowed_group_sizes: Vec<u8>,
        num_options: u8,
        use_hooks: bool,
    ) -> u32 {
        unimplemented!()
    }

    /// Starts an evaluation, sorting registrants into groups and enabling proposal submission.
    ///
    /// # Arguments
    /// * `evaluation_id` - The ID of the evaluation to start.
    #[action]
    fn start(evaluation_id: u32) {
        unimplemented!()
    }

    /// Sets the public key for the user to receive the symmetric key.
    ///
    /// # Arguments
    /// * `key` - The public key to be set for the user.
    #[action]
    fn set_key(key: Vec<u8>) {
        unimplemented!()
    }

    /// Sets the symmetric key for a group during the deliberation phase, callable only once by any group member
    ///
    /// # Arguments
    /// * `owner` - The account number of the evaluation owner.
    /// * `evaluation_id` - The ID of the evaluation.
    /// * `keys` - Vector of keys to set for the group.
    /// * `hash` - Hash of the keys for verification.
    #[action]
    fn group_key(owner: AccountNumber, evaluation_id: u32, keys: Vec<Vec<u8>>, hash: String) {
        unimplemented!()
    }

    /// Closes an evaluation and deletes its groups.
    ///
    /// # Arguments
    /// * `evaluation_id` - The ID of the evaluation to close.
    #[action]
    fn close(evaluation_id: u32) {
        unimplemented!()
    }

    /// Deletes an evaluation, optionally forcing deletion.
    ///
    /// # Arguments
    /// * `evaluation_id` - The ID of the evaluation to delete.
    /// * `force` - If true, allows deletion regardless of the evaluation's phase.
    #[action]
    fn delete(evaluation_id: u32, force: bool) {
        unimplemented!()
    }

    /// Submits an encrypted proposal for a user in a group.
    ///
    /// # Arguments
    /// * `owner` - The account number of the evaluation owner.
    /// * `evaluation_id` - The ID of the evaluation.
    /// * `proposal` - The encrypted proposal data.
    #[action]
    fn propose(owner: AccountNumber, evaluation_id: u32, proposal: Vec<u8>) {
        unimplemented!()
    }

    /// Submits an attestation for decrypted proposals, potentially triggering group result declaration.
    ///
    /// # Arguments
    /// * `owner` - The account number of the evaluation owner.
    /// * `evaluation_id` - The ID of the evaluation.
    /// * `attestation` - The attestation data containing ranks.
    #[action]
    fn attest(owner: AccountNumber, evaluation_id: u32, attestation: Vec<u8>) {
        unimplemented!()
    }

    /// Registers a user for an evaluation during the registration phase.
    ///
    /// # Arguments
    /// * `owner` - The account number of the evaluation owner.
    /// * `evaluation_id` - The ID of the evaluation.
    /// * `registrant` - The account number of the user to register.
    #[action]
    fn register(owner: AccountNumber, evaluation_id: u32, registrant: AccountNumber) {
        unimplemented!()
    }

    /// Unregisters a user from an evaluation during the registration phase.
    ///
    /// # Arguments
    /// * `owner` - The account number of the evaluation owner.
    /// * `evaluation_id` - The ID of the evaluation.
    /// * `registrant` - The account number of the user to unregister.
    #[action]
    fn unregister(owner: AccountNumber, evaluation_id: u32, registrant: AccountNumber) {
        unimplemented!()
    }
}
