pub mod helpers;

pub mod db;

#[psibase::service(tables = "db::tables")]
#[allow(non_snake_case)]
pub mod service {
    use crate::db::tables::{Evaluation, Group, User, UserSettings};
    use crate::helpers;

    use crate::helpers::EvaluationStatus;
    use psibase::*;

    #[event(history)]
    pub fn keysset(evaluation_id: u32, group_number: u32, keys: Vec<Vec<u8>>, hash: String) {}

    #[event(history)]
    pub fn evaluation_created(owner: AccountNumber, evaluation_id: u32) {}

    #[event(history)]
    pub fn group_finished(
        owner: AccountNumber,
        evaluation_id: u32,
        group_number: u32,
        result: Vec<u8>,
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
    ) {
        check(
            registration < deliberation && deliberation < submission && submission < finish_by,
            "invalid times",
        );

        check(
            allowed_group_sizes.iter().all(|size| *size > 0),
            "allowable group sizes must be greater than 0",
        );

        let new_evaluation = Evaluation::new(
            allowed_group_sizes,
            registration,
            deliberation,
            submission,
            finish_by,
            num_options,
            use_hooks,
        );

        new_evaluation.save();
        Wrapper::emit()
            .history()
            .evaluation_created(get_sender(), new_evaluation.id);
    }

    // Commences an evaluation, sorts registrants into groups and allows proposals
    #[action]
    fn start(owner: AccountNumber, evaluation_id: u32) {
        let evaluation = Evaluation::get(owner, evaluation_id);

        evaluation.assert_status(helpers::EvaluationStatus::Deliberation);

        check(
            evaluation.get_groups().len() == 0,
            "groups have already been created",
        );

        let mut users_to_process = evaluation.get_users();

        users_to_process.sort_by_key(|user| user.user.value);

        helpers::shuffle_vec(&mut users_to_process, evaluation_id as u64);

        let chunked_groups = check_some(
            helpers::spread_users(&users_to_process, &evaluation),
            "unable to spread users into groups",
        );

        for (index, grouped_users) in chunked_groups.into_iter().enumerate() {
            let group_number: u32 = (index as u32) + 1;
            let new_group = Group::new(owner, evaluation.id, group_number);
            new_group.save();

            for mut user in grouped_users {
                user.group_number = Some(group_number);
                user.save();
            }
        }

        evaluation.save();
    }

    // Sets the public key for the user to receive the symmetric key
    #[action]
    fn setKey(key: Vec<u8>) {
        let user = UserSettings::new(get_sender(), key);
        user.save();
    }

    // Sets the symmetric key for a group
    #[action]
    fn groupKey(owner: AccountNumber, evaluation_id: u32, keys: Vec<Vec<u8>>, hash: String) {
        let evaluation = Evaluation::get(owner, evaluation_id);

        evaluation.assert_status(helpers::EvaluationStatus::Deliberation);

        let sender: AccountNumber = get_sender();

        let user = User::get(sender, evaluation_id, sender);

        let group_number = check_some(user.group_number, "user is not sorted into a group");

        let mut group = Group::get(sender, evaluation_id, group_number).expect("group not found");

        check_none(group.key_submitter, "group key has already been submitted");

        group.key_submitter = Some(sender);
        group.save();

        Wrapper::emit()
            .history()
            .keysset(evaluation_id, group_number, keys, hash);
    }

    // Closes the evaluation
    #[action]
    fn close(id: u32) {
        let evaluation = Evaluation::get(get_sender(), id);
        let current_phase = evaluation.get_current_phase();

        match current_phase {
            EvaluationStatus::Submission => {
                let is_successful_evaluation_start = Group::get(get_sender(), id, 1).is_some();
                if is_successful_evaluation_start {
                    abort_message("evaluation is still in submission phase");
                }
            }
            EvaluationStatus::Deliberation | EvaluationStatus::Registration => {
                abort_message("evaluation must be in registration or closed phase");
            }
            EvaluationStatus::Pending | EvaluationStatus::Closed => {}
        }

        evaluation.delete();
    }

    // Accepts a group members encrypted proposal, to be decrypted and attested by group members in attestation phase
    #[action]
    fn propose(owner: AccountNumber, evaluation_id: u32, proposal: Vec<u8>) {
        let evaluation = Evaluation::get(owner, evaluation_id);
        evaluation.assert_status(helpers::EvaluationStatus::Deliberation);

        let mut user = User::get(owner, evaluation_id, get_sender());

        let group =
            Group::get(owner, evaluation_id, user.group_number.unwrap()).expect("group not found");

        check(
            group.key_submitter.is_some(),
            "group key has not been submitted",
        );

        user.proposal = Some(proposal);
        user.save();
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

        evaluation.assert_status(helpers::EvaluationStatus::Submission);

        let mut user = User::get(owner, evaluation_id, sender);
        check(user.attestation.is_none(), "you have already submitted");

        user.attestation = Some(attestation);
        user.save();

        let mut group =
            Group::get(owner, evaluation_id, user.group_number.unwrap()).expect("group not found");

        check(group.key_submitter.is_some(), "cannot attest without key");
        check(group.result.is_none(), "group result already set");

        if group.result.is_none() {
            let result =
                helpers::get_group_result(owner, evaluation_id, user.group_number.unwrap());
            match result {
                helpers::GroupResult::ConsensusSuccess(result) => {
                    group.result = Some(result.clone());
                    group.save();

                    evaluation.notify_group_finish(user.group_number.unwrap(), result.clone());


                    Wrapper::emit().history().group_finished(
                        evaluation.owner,
                        evaluation.id,
                        user.group_number.unwrap(),
                        result,
                    );
                }
                _ => {}
            }
        }
    }

    // Registers a user for an evaluation
    #[action]
    fn register(owner: AccountNumber, evaluation_id: u32, registrant: AccountNumber) {
        let evaluation = Evaluation::get(owner, evaluation_id);

        evaluation.assert_status(helpers::EvaluationStatus::Registration);

        let sender = get_sender();
        check(
            sender == registrant || sender == evaluation.owner,
            "user is not allowed to register",
        );

        let user_settings = UserSettings::get(registrant);

        check_some(
            user_settings,
            "user must have a pre-existing key to be registered",
        );
        let user = User::new(evaluation.owner, evaluation.id, registrant);
        user.save();

        evaluation.notify_register(registrant);
    }

    // Removes a registrant from an evaluation pre-deliberation
    #[action]
    fn unregister(owner: AccountNumber, evaluation_id: u32, registrant: AccountNumber) {
        let evaluation = Evaluation::get(owner, evaluation_id);
        evaluation.assert_status(helpers::EvaluationStatus::Registration);

        let sender = get_sender();
        check(
            sender == registrant || sender == evaluation.owner,
            "user is not allowed to unregister",
        );

        let user = User::get(owner, evaluation_id, registrant);
        user.delete();

        evaluation.notify_unregister(registrant);
    }
}

#[cfg(test)]
mod tests;
