mod db;
mod helpers;

#[psibase::service(tables = "db::tables")]
#[allow(non_snake_case)]
pub mod service {
    pub use crate::db::tables::*;
    use crate::helpers::{self, EvaluationStatus};
    use psibase::*;

    #[event(history)]
    pub fn keysset(
        owner: AccountNumber,
        evaluation_id: u32,
        group_number: u32,
        keys: Vec<Vec<u8>>,
        hash: String,
    ) {
    }

    #[event(history)]
    pub fn evaluation_created(owner: AccountNumber, evaluation_id: u32) {}

    #[event(history)]
    pub fn evaluation_finished(owner: AccountNumber, evaluation_id: u32) {}

    #[event(history)]
    pub fn group_finished(
        owner: String,
        evaluation_id: String,
        group_number: String,
        users: Vec<String>,
        result: Vec<String>,
    ) {
    }

    /// Creates and schedules a new evaluation with specified phases and parameters.
    ///
    /// # Arguments
    /// * `registration` - Unix seconds timestamp for the start of the registration phase.
    /// * `deliberation` - Unix seconds timestamp for the start of the deliberation phase.
    /// * `submission` - Unix seconds timestamp for the start of the submission phase.
    /// * `finish_by` - Unix seconds timestamp for the start of the evaluation completion phase.
    /// * `allowed_group_sizes` - Vector of allowed group sizes (must be greater than 0, traditionally 4, 5, or 6).
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
        check(
            registration < deliberation && deliberation < submission && submission < finish_by,
            "invalid times",
        );

        check(
            allowed_group_sizes.iter().all(|size| *size > 0),
            "allowable group sizes must be greater than 0",
        );

        let new_evaluation = Evaluation::add(
            allowed_group_sizes,
            registration,
            deliberation,
            submission,
            finish_by,
            num_options,
            use_hooks,
        );

        Wrapper::emit()
            .history()
            .evaluation_created(get_sender(), new_evaluation.id);
        new_evaluation.id
    }

    /// Starts an evaluation, sorting registrants into groups and enabling proposal submission.
    ///
    /// # Arguments
    /// * `owner` - The account number of the evaluation owner.
    /// * `evaluation_id` - The ID of the evaluation to start.
    #[action]
    fn start(owner: AccountNumber, evaluation_id: u32) {
        let evaluation = Evaluation::get(owner, evaluation_id);

        evaluation.assert_status(helpers::EvaluationStatus::Deliberation);

        evaluation.create_groups();
    }

    /// Sets the public key for the user to receive the symmetric key.
    ///
    /// # Arguments
    /// * `key` - The public key to be set for the user.
    #[action]
    fn set_key(key: Vec<u8>) {
        let user = UserSettings::new(get_sender(), key);
        user.save();
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
        let evaluation = Evaluation::get(owner, evaluation_id);

        evaluation.assert_status(helpers::EvaluationStatus::Deliberation);

        let sender = get_sender();

        let group_number = evaluation
            .get_user(sender)
            .expect("user not found")
            .group_number
            .expect("user not grouped");

        let mut group = evaluation.get_group(group_number).expect("group not found");
        group.set_key_submitter(sender);

        Wrapper::emit()
            .history()
            .keysset(owner, evaluation_id, group_number, keys, hash);
    }

    /// Closes an evaluation and deletes its groups.
    ///
    /// # Arguments
    /// * `owner` - The account number of the evaluation owner.
    /// * `evaluation_id` - The ID of the evaluation to close.
    #[action]
    fn close(owner: AccountNumber, evaluation_id: u32) {
        let evaluation = Evaluation::get(owner, evaluation_id);
        evaluation.assert_status(EvaluationStatus::Closed);

        evaluation.get_groups().iter().for_each(|group| {
            group.delete();
        });

        Wrapper::emit()
            .history()
            .evaluation_finished(evaluation.owner, evaluation.id);

        evaluation.delete();
    }

    /// Deletes an evaluation, optionally forcing deletion.
    ///
    /// # Arguments
    /// * `evaluation_id` - The ID of the evaluation to delete.
    /// * `force` - If true, allows deletion regardless of the evaluation's phase.
    #[action]
    fn delete(evaluation_id: u32, force: bool) {
        let evaluation = Evaluation::get(get_sender(), evaluation_id);
        if !force {
            let phase = evaluation.get_current_phase();
            check(
                phase == EvaluationStatus::Pending || phase == EvaluationStatus::Closed,
                "evaluation is not deletable unless pending or closed",
            );
        }
        evaluation.delete();
    }

    /// Submits an encrypted proposal for a user in a group.
    ///
    /// # Arguments
    /// * `owner` - The account number of the evaluation owner.
    /// * `evaluation_id` - The ID of the evaluation.
    /// * `proposal` - The encrypted proposal data.
    #[action]
    fn propose(owner: AccountNumber, evaluation_id: u32, proposal: Vec<u8>) {
        let evaluation = Evaluation::get(owner, evaluation_id);
        evaluation.assert_status(EvaluationStatus::Deliberation);

        let sender = get_sender();
        let user = evaluation.get_user(sender);
        let mut user = psibase::check_some(user, format!("user {} not found", sender).as_str());

        check(
            evaluation
                .get_group(user.group_number.unwrap())
                .expect("group not found")
                .key_submitter
                .is_some(),
            "group key has not been submitted",
        );

        user.propose(proposal);
    }

    /// Submits an attestation for decrypted proposals, potentially triggering group result declaration.
    ///
    /// # Arguments
    /// * `owner` - The account number of the evaluation owner.
    /// * `evaluation_id` - The ID of the evaluation.
    /// * `attestation` - The attestation data containing ranks.
    #[action]
    fn attest(owner: AccountNumber, evaluation_id: u32, attestation: Vec<u8>) {
        let sender = get_sender();
        let evaluation = Evaluation::get(owner, evaluation_id);

        let ranks_within_scope = attestation
            .iter()
            .all(|rank| rank <= &evaluation.num_options);
        check(ranks_within_scope, "attestation is out of scope");

        evaluation.assert_status(EvaluationStatus::Submission);

        let mut user = evaluation.get_user(sender).expect("user not found");
        user.attest(attestation);

        let group = evaluation
            .get_group(user.group_number.unwrap())
            .expect("group not found");

        let result = group.get_result();
        if result.is_some() {
            group.declare_result(result.unwrap());
        }
    }

    /// Registers a user for an evaluation during the registration phase.
    ///
    /// # Arguments
    /// * `owner` - The account number of the evaluation owner.
    /// * `evaluation_id` - The ID of the evaluation.
    /// * `registrant` - The account number of the user to register.
    #[action]
    fn register(owner: AccountNumber, evaluation_id: u32, registrant: AccountNumber) {
        let evaluation = Evaluation::get(owner, evaluation_id);
        evaluation.assert_status(EvaluationStatus::Registration);

        let sender = get_sender();
        check(
            sender == registrant || sender == evaluation.owner,
            "user is not allowed to register",
        );

        check_some(
            UserSettings::get(registrant),
            "user must have a pre-existing key to be registered",
        );

        evaluation.register_user(registrant);
    }

    /// Unregisters a user from an evaluation during the registration phase.
    ///
    /// # Arguments
    /// * `owner` - The account number of the evaluation owner.
    /// * `evaluation_id` - The ID of the evaluation.
    /// * `registrant` - The account number of the user to unregister.
    #[action]
    fn unregister(owner: AccountNumber, evaluation_id: u32, registrant: AccountNumber) {
        let evaluation = Evaluation::get(owner, evaluation_id);
        evaluation.assert_status(EvaluationStatus::Registration);

        let sender = get_sender();
        check(
            sender == registrant || sender == evaluation.owner,
            "user is not allowed to unregister",
        );

        evaluation.unregister_user(registrant);
    }
}

#[cfg(test)]
mod tests;
