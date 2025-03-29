#[psibase::service_tables]
pub mod tables {
    use async_graphql::SimpleObject;
    use psibase::{AccountNumber, Fracpack, SingletonKey, Table, ToSchema};
    use serde::{Deserialize, Serialize};

    #[table(name = "ConfigTable", index = 0)]
    #[derive(Serialize, Deserialize, ToSchema, Fracpack)]
    pub struct ConfigRow {
        pub last_used_id: u32,
    }

    impl ConfigRow {
        #[primary_key]
        fn pk(&self) -> SingletonKey {
            SingletonKey {}
        }
    }

    #[table(name = "EvaluationTable", index = 1)]
    #[derive(Default, Fracpack, ToSchema, SimpleObject, Serialize, Deserialize, Debug)]
    pub struct Evaluation {
        #[primary_key]
        pub id: u32,
        pub created_at: u32,
        pub owner: AccountNumber,
        pub registration_starts: u32,
        pub deliberation_starts: u32,
        pub submission_starts: u32,
        pub finish_by: u32,
        pub use_hooks: bool,
        pub allowable_group_sizes: Vec<u8>,
    }

    #[table(name = "UserTable", index = 2)]
    #[derive(Default, Fracpack, ToSchema, SimpleObject, Serialize, Deserialize, Debug, Clone)]
    pub struct User {
        pub evaluation_id: u32,
        pub user: AccountNumber,
        pub group_number: Option<u32>,
        pub proposal: Option<Vec<u8>>,

        // Change this to a hash and change field name to attestation
        pub submission: Option<Vec<AccountNumber>>,
    }

    impl User {
        #[primary_key]
        fn pk(&self) -> (u32, AccountNumber) {
            (self.evaluation_id, self.user)
        }

        pub fn new(evaluation_id: u32, user: AccountNumber) -> Self {
            Self {
                evaluation_id,
                user,
                group_number: None,
                proposal: None,
                submission: None,
            }
        }

        pub fn get(evaluation_id: u32, user: AccountNumber) -> Self {
            let table = UserTable::new();
            let result = table.get_index_pk().get(&(evaluation_id, user));
            psibase::check(result.is_some(), "user not found");
            result.unwrap()
        }

        pub fn save(&self) {
            let table = UserTable::new();
            table.put(&self).unwrap();
        }
    }

    #[table(name = "GroupTable", index = 3)]
    #[derive(Default, Fracpack, ToSchema, SimpleObject, Serialize, Deserialize, Debug, Clone)]
    pub struct Group {
        pub evaluation_id: u32,
        pub number: u32,
        pub key_submitter: Option<AccountNumber>,
        pub key_hash: Option<String>,
        pub keys: Vec<Vec<u8>>,
        pub result: Option<Vec<AccountNumber>>,
    }

    impl Evaluation {
        pub fn new(
            id: u32,
            created_at: u32,
            owner: AccountNumber,
            registration_starts: u32,
            deliberation_starts: u32,
            submission_starts: u32,
            finish_by: u32,
        ) -> Self {
            Self {
                id,
                owner,
                created_at,
                registration_starts,
                deliberation_starts,
                submission_starts,
                finish_by,
                use_hooks: false,
                allowable_group_sizes: vec![],
            }
        }

        pub fn get(evaluation_id: u32) -> Self {
            let table = EvaluationTable::new();
            let result = table.get_index_pk().get(&evaluation_id);
            psibase::check(result.is_some(), "evaluation not found");
            result.unwrap()
        }

        pub fn save(&self) {
            let table = EvaluationTable::new();
            table.put(&self).unwrap();
        }

        pub fn delete(&self) {
            let evaluation_id = self.id;
            let users_table = UserTable::new();

            let users: Vec<User> = users_table
                .get_index_pk()
                .range(
                    (evaluation_id, AccountNumber::new(0))
                        ..=(evaluation_id, AccountNumber::new(u64::MAX)),
                )
                .collect();

            for user in users {
                users_table.erase(&user.pk());
            }

            let groups_table = GroupTable::new();
            let groups: Vec<Group> = groups_table
                .get_index_pk()
                .range((evaluation_id, 0)..=(evaluation_id, u32::MAX))
                .collect();

            for group in groups {
                groups_table.erase(&group.pk());
            }

            let evaluation_table = EvaluationTable::new();
            evaluation_table.erase(&self.id);
        }
    }

    impl Group {
        #[primary_key]
        fn pk(&self) -> (u32, u32) {
            (self.evaluation_id, self.number)
        }

        pub fn get(evaluation_id: u32, number: u32) -> Self {
            let table = GroupTable::new();
            let result = table.get_index_pk().get(&(evaluation_id, number));
            psibase::check(result.is_some(), "group not found");
            result.unwrap()
        }

        pub fn save(&self) {
            let table = GroupTable::new();
            table.put(&self).unwrap();
        }

        pub fn new(evaluation_id: u32, number: u32) -> Self {
            Self {
                evaluation_id,
                number,
                key_submitter: None,
                key_hash: None,
                keys: vec![],
                result: None,
            }
        }
    }
}

pub mod helpers;

// Registration: From when people can register to an evaluation.
// Deliberation: From when people can submit proposals to an evaluation, Proposals only, no attestations.
// Submission: From when people can submit attestations to an evaluation. Attestations only, no proposals.
// Closed: When the evaluation is closed.

#[psibase::service(name = "evaluations")]
pub mod service {
    use crate::helpers::{self};
    use crate::tables::{
        ConfigRow, ConfigTable, Evaluation, EvaluationTable, Group, GroupTable, User, UserTable,
    };
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
    fn create(registration: u32, deliberation: u32, submission: u32, finish_by: u32) {
        check(
            registration < deliberation && deliberation < submission && submission < finish_by,
            "invalid times",
        );

        let new_evaluation = Evaluation::new(
            helpers::get_next_id(),
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
    fn start(id: u32, entropy: u64) {
        let evaluation = Evaluation::get(id);

        helpers::assert_status(&evaluation, helpers::EvaluationStatus::Deliberation);
        check(
            evaluation.owner == get_sender(),
            "only the owner can start the evaluation",
        );
        check(
            helpers::get_groups(id).len() == 0,
            "groups have already been created",
        );

        let mut users_to_process = helpers::get_users(id);

        let allowed_group_sizes = evaluation
            .allowable_group_sizes
            .iter()
            .map(|size| *size as u32)
            .collect();

        let chunks = psibase::services::subgroups::Wrapper::call()
            .gmp(users_to_process.len() as u32, allowed_group_sizes)
            .unwrap()
            .iter()
            .map(|size| *size as u8)
            .collect();

        helpers::shuffle_vec(&mut users_to_process, entropy);

        let chunked_groups = helpers::chunk_users(&users_to_process, chunks);

        for (index, group) in chunked_groups.into_iter().enumerate() {
            let group_number: u32 = (index as u32) + 1;
            let new_group = Group::new(evaluation.id, group_number);
            new_group.save();

            for mut user in group {
                user.group_number = Some(group_number);
                user.save();
            }
        }

        helpers::update_evaluation(&evaluation);
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
