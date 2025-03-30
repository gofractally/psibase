pub mod helpers;

pub mod db;

#[psibase::service(name = "evaluations")]
pub mod service {
    use crate::db::tables::{ConfigRow, ConfigTable, Evaluation, Group, User};
    use crate::helpers::{self};
    use psibase::*;

    #[action]
    fn init() {
        let table = ConfigTable::new();
        table.put(&ConfigRow { last_used_id: 0 }).unwrap();
    }

    #[pre_action(exclude(init))]
    fn check_init() {
        let table = ConfigTable::new();
        check(
            table.get_index_pk().get(&SingletonKey {}).is_some(),
            "service not inited",
        );
    }

    #[action]
    #[allow(non_snake_case)]
    fn create(
        registration: u32,
        deliberation: u32,
        submission: u32,
        finish_by: u32,
        allowable_group_sizes: Vec<u8>,
    ) {
        check(
            registration < deliberation && deliberation < submission && submission < finish_by,
            "invalid times",
        );

        let new_evaluation = Evaluation::new(
            helpers::get_next_id(),
            allowable_group_sizes,
            helpers::get_current_time_seconds(),
            get_sender(),
            registration,
            deliberation,
            submission,
            finish_by,
        );

        new_evaluation.save();
    }

    #[action]
    #[allow(non_snake_case)]
    fn getEvaluation(id: u32) -> Option<Evaluation> {
        let evaluation = Evaluation::get(id);
        Some(evaluation)
    }

    #[action]
    #[allow(non_snake_case)]
    fn getLastId() -> u32 {
        let table = ConfigTable::new();
        table
            .get_index_pk()
            .get(&SingletonKey {})
            .unwrap()
            .last_used_id
    }

    #[action]
    #[allow(non_snake_case)]
    fn getGroups(id: u32) -> Vec<Group> {
        let evaluation = Evaluation::get(id);
        evaluation.get_groups()
    }

    #[action]
    #[allow(non_snake_case)]
    fn getUsers(id: u32) -> Vec<User> {
        let evaluation = Evaluation::get(id);
        evaluation.get_users()
    }

    #[action]
    #[allow(non_snake_case)]
    fn start(id: u32, entropy: u64) {
        let evaluation = Evaluation::get(id);

        helpers::assert_status(&evaluation, helpers::EvaluationStatus::Deliberation);
        check(
            evaluation.owner == get_sender(),
            "only the owner can start the evaluation",
        );
        check(
            evaluation.get_groups().len() == 0,
            "groups have already been created",
        );

        // return;
        let mut users_to_process = evaluation.get_users();

        helpers::shuffle_vec(&mut users_to_process, entropy);

        let chunked_groups = helpers::spread_users(&users_to_process, &evaluation);

        for (index, grouped_users) in chunked_groups.into_iter().enumerate() {
            let group_number: u32 = (index as u32) + 1;
            let new_group = Group::new(evaluation.id, group_number);
            new_group.save();

            for mut user in grouped_users {
                user.group_number = Some(group_number);
                user.save();
            }
        }

        evaluation.save();
    }

    #[action]
    #[allow(non_snake_case)]
    fn groupKey(evaluation_id: u32, keys: Vec<Vec<u8>>, hash: String) {
        let evaluation = Evaluation::get(evaluation_id);
        helpers::assert_status(&evaluation, helpers::EvaluationStatus::Deliberation);

        let sender = get_sender();
        let user = helpers::get_user(evaluation_id, sender);

        check(
            user.group_number.is_some(),
            "user is not sorted into a group",
        );

        let mut group = Group::get(evaluation_id, user.group_number.unwrap());

        check(
            group.key_submitter.is_none(),
            "group key has already been submitted",
        );

        group.key_submitter = Some(sender);
        group.key_hash = Some(hash);
        group.keys = keys;
        group.save();
    }

    #[action]
    #[allow(non_snake_case)]
    fn close(id: u32) {
        let evaluation = Evaluation::get(id);
        helpers::assert_status(&evaluation, helpers::EvaluationStatus::Closed);

        let sender = get_sender();
        check(
            evaluation.owner == sender,
            "only the owner can close the evaluation",
        );

        evaluation.delete();
    }

    #[action]
    #[allow(non_snake_case)]
    fn propose(evaluation_id: u32, proposal: Vec<u8>) {
        let sender = get_sender();
        let evaluation = Evaluation::get(evaluation_id);
        helpers::assert_status(&evaluation, helpers::EvaluationStatus::Deliberation);

        let mut user = User::get(evaluation_id, sender);
        user.proposal = Some(proposal);
        user.save();
    }

    #[action]
    #[allow(non_snake_case)]
    fn attest(evaluation_id: u32, submission: Vec<String>) {
        let sender = get_sender();
        let evaluation = Evaluation::get(evaluation_id);

        helpers::assert_status(&evaluation, helpers::EvaluationStatus::Submission);

        let mut user = User::get(evaluation_id, sender);

        check(user.submission.is_none(), "you have already submitted");

        let submission_account_numbers = submission
            .iter()
            .map(|s| AccountNumber::from(s.as_str()))
            .collect();

        user.submission = Some(submission_account_numbers);
        user.save();

        let mut group = Group::get(evaluation_id, user.group_number.unwrap());

        check(group.key_submitter.is_some(), "cannot attest without key");

        if group.result.is_none() {
            let result = helpers::get_group_result(evaluation_id, user.group_number.unwrap());
            match result {
                helpers::GroupResult::ConsensusSuccess(users) => {
                    group.result = Some(users);
                    group.save();
                }
                _ => {}
            }
        }
    }

    #[action]
    #[allow(non_snake_case)]
    fn register(id: u32) {
        let evaluation = Evaluation::get(id);

        helpers::assert_status(&evaluation, helpers::EvaluationStatus::Registration);
        let is_hook_allows_registration = true;

        check(
            is_hook_allows_registration,
            "user is not allowed to register",
        );

        let user = User::new(evaluation.id, get_sender());
        user.save();
    }
}

#[cfg(test)]
mod tests;
