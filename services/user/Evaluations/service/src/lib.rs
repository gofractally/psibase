pub mod helpers;

pub mod db;

#[psibase::service(name = "evaluations")]
pub mod service {
    use crate::db::tables::{ConfigRow, ConfigTable, Evaluation, Group, User, UserSettings};
    use crate::helpers;
    use psibase::*;

    #[action]
    fn init() {
        let table = ConfigTable::new();
        table.put(&ConfigRow { last_used_id: 0 }).unwrap();

        services::events::Wrapper::call().setSchema(create_schema::<Wrapper>());
    }

    #[pre_action(exclude(init))]
    fn check_init() {
        let table = ConfigTable::new();
        check(
            table.get_index_pk().get(&SingletonKey {}).is_some(),
            "service not inited",
        );
    }

    #[event(history)]
    pub fn keysset(evaluation_id: u32, group_number: u32, keys: Vec<Vec<u8>>, hash: String) {}

    #[action]
    #[allow(non_snake_case)]
    fn create(
        registration: u32,
        deliberation: u32,
        submission: u32,
        finish_by: u32,
        group_sizes: Vec<u8>,
        rank_amount: u8,
    ) {
        check(
            registration < deliberation && deliberation < submission && submission < finish_by,
            "invalid times",
        );

        check(
            group_sizes.len() > 0,
            "allowable group sizes must be at least 1",
        );

        check(
            group_sizes.iter().all(|size| *size > 0),
            "allowable group sizes must be greater than 0",
        );

        let new_evaluation = Evaluation::new(
            helpers::get_next_id(),
            group_sizes,
            helpers::get_current_time_seconds(),
            get_sender(),
            registration,
            deliberation,
            submission,
            finish_by,
            rank_amount,
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
    fn getGroup(id: u32, group_number: u32) -> Option<Group> {
        let evaluation = Evaluation::get(id);
        evaluation.get_group(group_number)
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
    fn getUser(id: u32, user: AccountNumber) -> Option<User> {
        let user = User::get(id, user);
        Some(user)
    }

    #[action]
    #[allow(non_snake_case)]
    fn getGroupUsers(id: u32, group_number: u32) -> Vec<User> {
        let evaluation = Evaluation::get(id);
        evaluation
            .get_users()
            .iter()
            .filter(|user| user.group_number == Some(group_number))
            .map(|user| user.clone())
            .collect()
    }

    #[action]
    #[allow(non_snake_case)]
    fn getUserSettings(account_number: AccountNumber) -> Option<UserSettings> {
        UserSettings::get(account_number)
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

        let mut users_to_process = evaluation.get_users();

        helpers::shuffle_vec(&mut users_to_process, entropy);

        let chunked_groups = helpers::spread_users(&users_to_process, &evaluation);

        check(
            chunked_groups.is_some(),
            "unable to spread users into groups",
        );

        let chunked_groups = chunked_groups.unwrap();

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
    fn refreshKey(key: Vec<u8>) {
        let user = UserSettings::new(get_sender(), key);
        user.save();
    }

    #[action]
    #[allow(non_snake_case)]
    fn groupKey(evaluation_id: u32, keys: Vec<Vec<u8>>, hash: String) {
        let evaluation = Evaluation::get(evaluation_id);
        helpers::assert_status(&evaluation, helpers::EvaluationStatus::Deliberation);

        let sender = get_sender();

        let user = User::get(evaluation_id, sender);

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
        group.save();

        Wrapper::emit()
            .history()
            .keysset(evaluation_id, user.group_number.unwrap(), keys, hash);
    }

    #[action]
    #[allow(non_snake_case)]
    fn close(id: u32) {
        let evaluation = Evaluation::get(id);

        // TODO: Wait until close phase or delete at any time?
        helpers::assert_status(&evaluation, helpers::EvaluationStatus::Closed);

        check(
            evaluation.owner == get_sender(),
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
    fn attest(evaluation_id: u32, submission: Vec<u8>) {
        let sender = get_sender();
        let evaluation = Evaluation::get(evaluation_id);

        helpers::assert_status(&evaluation, helpers::EvaluationStatus::Submission);

        let mut user = User::get(evaluation_id, sender);
        check(user.submission.is_none(), "you have already submitted");

        user.submission = Some(submission);
        user.save();

        let mut group = Group::get(evaluation_id, user.group_number.unwrap());

        check(group.key_submitter.is_some(), "cannot attest without key");
        check(group.result.is_none(), "group result already set");

        if group.result.is_none() {
            let result = helpers::get_group_result(evaluation_id, user.group_number.unwrap());
            match result {
                helpers::GroupResult::ConsensusSuccess(result) => {
                    group.result = Some(result);
                    group.save();
                }
                _ => {}
            }
        }
    }

    #[action]
    #[allow(non_snake_case)]
    fn register(id: u32, account_number: AccountNumber) {
        // Proposals still need to be encrypted, but can that just be an event?
        // Groupkey should emit an event of the symmetric key inside of the asymmetric payloads
        //
        let evaluation = Evaluation::get(id);
        helpers::assert_status(&evaluation, helpers::EvaluationStatus::Registration);

        let sender = get_sender();
        check(
            sender == account_number || sender == evaluation.owner,
            "user is not allowed to register",
        );

        let is_hook_allows_registration = true;

        check(
            is_hook_allows_registration,
            "user is not allowed to register",
        );

        let user_settings = UserSettings::get(account_number);

        check(
            user_settings.is_some(),
            "user must have a pre-existing key to be registered",
        );
        let user = User::new(evaluation.id, get_sender());
        user.save();
    }

    #[action]
    #[allow(non_snake_case)]
    fn unregister(id: u32) {
        let evaluation = Evaluation::get(id);
        helpers::assert_status(&evaluation, helpers::EvaluationStatus::Registration);

        let is_hook_allows_deregistration = true;

        check(
            is_hook_allows_deregistration,
            "user is not allowed to deregister",
        );

        let sender = get_sender();
        let user = User::get(evaluation.id, sender);
        user.delete();
    }
}

#[cfg(test)]
mod tests;
