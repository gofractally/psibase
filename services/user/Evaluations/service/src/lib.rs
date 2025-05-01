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
    pub fn groupfinished(
        owner: String,
        evaluation_id: String,
        group_number: String,
        users: Vec<String>,
        result: Vec<String>,
    ) {
    }

    // Create / schedule an evaluation
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

    // Commences an evaluation, sorts registrants into groups and allows proposals
    #[action]
    fn start(owner: AccountNumber, evaluation_id: u32) {
        let evaluation = Evaluation::get(owner, evaluation_id);

        evaluation.assert_status(helpers::EvaluationStatus::Deliberation);

        evaluation.create_groups();
    }

    // Sets the public key for the user to receive the symmetric key
    #[action]
    fn set_key(key: Vec<u8>) {
        let user = UserSettings::new(get_sender(), key);
        user.save();
    }

    // Sets the symmetric key for a group
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

    // Close the evaluation
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

    // Accepts a group members encrypted proposal, to be decrypted and attested by group members in attestation phase
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

    // Sends group member attestation from decrypted proposals, triggers evalGroupFin in a successful consensus result
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

    // Registers a user for an evaluation
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

    // Removes a registrant from an evaluation pre-deliberation
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
