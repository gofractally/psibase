#[psibase::service_tables]
pub mod tables {
    use async_graphql::SimpleObject;
    use psibase::{AccountNumber, Fracpack, SingletonKey, ToSchema};
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
        pub group_results: Vec<Vec<AccountNumber>>,
        pub group_sizes: Vec<u8>,
        pub groups_created: Vec<u32>,
        pub users: Vec<AccountNumber>,
    }

    #[table(name = "AttestationTable", index = 2)]
    #[derive(Default, Fracpack, ToSchema, SimpleObject, Serialize, Deserialize, Debug, Clone)]
    pub struct Attestation {
        pub evaluation_id: u32,
        pub group_number: u32,
        pub owner: AccountNumber,
        pub proposal: Option<Vec<u8>>,
        pub submission: Option<Vec<AccountNumber>>,
    }

    #[table(name = "GroupTable", index = 3)]
    #[derive(Default, Fracpack, ToSchema, SimpleObject, Serialize, Deserialize, Debug, Clone)]
    pub struct Group {
        pub evaluation_id: u32,
        pub number: u32,
        pub members: Vec<AccountNumber>,
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
                group_results: vec![],
                group_sizes: vec![],
                groups_created: vec![],
                users: vec![],
            }
        }
    }

    impl Group {
        #[primary_key]
        fn pk(&self) -> (u32, u32) {
            (self.evaluation_id, self.number)
        }

        pub fn new(evaluation_id: u32, number: u32, members: Vec<AccountNumber>) -> Self {
            Self {
                evaluation_id,
                number,
                members,
                key_submitter: None,
                key_hash: None,
                keys: vec![],
                result: None,
            }
        }
    }

    impl Attestation {
        #[primary_key]
        fn pk(&self) -> (u32, AccountNumber) {
            (self.evaluation_id, self.owner)
        }

        pub fn new(evaluation_id: u32, group_number: u32, owner: AccountNumber) -> Self {
            Self {
                evaluation_id,
                group_number,
                owner,
                proposal: None,
                submission: None,
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
        Attestation, AttestationTable, ConfigRow, ConfigTable, Evaluation, EvaluationTable, Group,
        GroupTable,
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
        let eval_table: EvaluationTable = EvaluationTable::new();
        let next_id = helpers::get_next_id();

        check(
            registration < deliberation && deliberation < submission && submission < finish_by,
            "invalid times",
        );

        let current_time_seconds = 222;

        let evaluation = Evaluation::new(
            next_id,
            current_time_seconds,
            get_sender(),
            registration,
            deliberation,
            submission,
            finish_by,
        );

        eval_table.put(&evaluation).unwrap();
    }

    #[action]
    #[allow(non_snake_case)]
    fn getEvaluation(id: u32) -> Option<Evaluation> {
        let table = EvaluationTable::new();
        table.get_index_pk().get(&id)
    }

    #[action]
    #[allow(non_snake_case)]
    fn start(id: u32, entropy: u64) {
        let mut evaluation = helpers::get_evaluation(id);

        helpers::assert_status(&evaluation, helpers::EvaluationStatus::Deliberation);
        check(
            evaluation.owner == get_sender(),
            "only the owner can start the evaluation",
        );
        check(
            evaluation.groups_created.len() == 0,
            "groups have already been created",
        );

        let mut users_to_process = evaluation.users.clone();
        let sized_groups = evaluation.group_sizes.clone();

        helpers::shuffle_vec(&mut users_to_process, entropy);

        let attestation_table: AttestationTable = AttestationTable::new();
        let groups = helpers::spread_users_into_groups(&users_to_process, sized_groups);

        let group_table: GroupTable = GroupTable::new();

        for (index, group) in groups.iter().enumerate() {
            let group_number: u32 = (index as u32) + 1;
            evaluation.groups_created.push(group_number);

            for user in group {
                let attestation = Attestation::new(evaluation.id, group_number, user.clone());
                attestation_table.put(&attestation).unwrap();
            }

            let new_group = Group::new(evaluation.id, group_number, group.clone());
            group_table.put(&new_group).unwrap();
        }

        helpers::update_evaluation(&evaluation);
    }

    #[action]
    #[allow(non_snake_case)]
    fn groupKey(evaluation_id: u32, keys: Vec<Vec<u8>>, hash: String) {
        let evaluation = helpers::get_evaluation(evaluation_id);
        helpers::assert_status(&evaluation, helpers::EvaluationStatus::Deliberation);

        let attestation_table: AttestationTable = AttestationTable::new();
        let attestation = attestation_table
            .get_index_pk()
            .get(&(evaluation_id, get_sender()))
            .unwrap();

        let group_table = GroupTable::new();
        let sender = get_sender();

        let mut group = group_table
            .get_index_pk()
            .get(&(evaluation_id, attestation.group_number))
            .unwrap();
        check(
            group.key_submitter.is_none(),
            "group key has already been submitted",
        );

        group.key_submitter = Some(sender);
        group.key_hash = Some(hash);
        group.keys = keys;
        group_table.put(&group).unwrap();
    }

    #[action]
    #[allow(non_snake_case)]
    fn close(id: u32) {
        let evaluation_table: EvaluationTable = EvaluationTable::new();
        let group_table: GroupTable = GroupTable::new();

        let evaluation = helpers::get_evaluation(id);
        helpers::assert_status(&evaluation, helpers::EvaluationStatus::Closed);

        for group_number in evaluation.groups_created {
            let group = group_table
                .get_index_pk()
                .get(&(evaluation.id, group_number))
                .unwrap();
            for user in group.members {
                let attestation_table: AttestationTable = AttestationTable::new();
                attestation_table.erase(&(evaluation.id, user));
            }
            group_table.erase(&(evaluation.id, group_number));
        }

        evaluation_table.erase(&evaluation.id);
    }

    #[action]
    #[allow(non_snake_case)]
    fn propose(evaluation_id: u32, proposal: Vec<u8>) {
        let sender = get_sender();
        let evaluation = helpers::get_evaluation(evaluation_id);
        helpers::assert_status(&evaluation, helpers::EvaluationStatus::Deliberation);

        let attestation_table: AttestationTable = AttestationTable::new();
        let mut attestation = attestation_table
            .get_index_pk()
            .get(&(evaluation_id, sender))
            .unwrap();

        attestation.proposal = Some(proposal);
        attestation_table.put(&attestation).unwrap();
    }

    #[action]
    #[allow(non_snake_case)]
    fn attest(evaluation_id: u32, submission: Vec<String>) {
        let sender = get_sender();
        let evaluation = helpers::get_evaluation(evaluation_id);

        helpers::assert_status(&evaluation, helpers::EvaluationStatus::Submission);

        let attestation_table: AttestationTable = AttestationTable::new();
        let mut attestation = attestation_table
            .get_index_pk()
            .get(&(evaluation_id, sender))
            .unwrap();

        check(
            attestation.submission.is_none(),
            "you have already submitted",
        );

        let submission_account_numbers = submission
            .iter()
            .map(|s| AccountNumber::from(s.as_str()))
            .collect();

        attestation.submission = Some(submission_account_numbers);
        attestation_table.put(&attestation).unwrap();

        let group_table = GroupTable::new();
        let mut group = group_table
            .get_index_pk()
            .get(&(attestation.evaluation_id, attestation.group_number))
            .unwrap();

        check(group.key_submitter.is_some(), "cannot attest without key");
        check(
            group.result.is_none(),
            "group result has already been determined",
        );

        let result = helpers::get_group_result(attestation.evaluation_id, attestation.group_number);
        match result {
            helpers::GroupResult::ConsensusSuccess(users) => {
                group.result = Some(users);
                group_table.put(&group).unwrap();
            }
            helpers::GroupResult::IrreconcilableFailure => {
                group.result = Some(vec![]);
                group_table.put(&group).unwrap();
            }
            _ => {}
        }
    }

    #[action]
    #[allow(non_snake_case)]
    fn register(id: u32) {
        let sender = get_sender();
        let mut evaluation = helpers::get_evaluation(id);
        helpers::assert_status(&evaluation, helpers::EvaluationStatus::Registration);

        let is_hook_allows_registration = true;

        check(
            is_hook_allows_registration,
            "user is not allowed to register",
        );

        check(
            !evaluation.users.contains(&sender),
            "user already registered",
        );

        evaluation.users.push(sender);
        helpers::update_evaluation(&evaluation);
    }
}

#[cfg(test)]
mod tests;
