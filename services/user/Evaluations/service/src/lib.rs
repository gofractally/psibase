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

        pub registration: u32,
        pub deliberation: u32,
        pub submission: u32,

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
        pub keys: Vec<String>,

        pub result: Option<Vec<AccountNumber>>,
    }

    impl Evaluation {
        pub fn new(
            id: u32,
            created_at: u32,
            owner: AccountNumber,
            registration: u32,
            deliberation: u32,
            submission: u32,
        ) -> Self {
            Self {
                id,
                owner,
                created_at,
                registration,
                deliberation,
                submission,
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

pub mod helpers {

    use crate::tables::{
        Attestation, AttestationTable, ConfigTable, Evaluation, EvaluationTable, GroupTable,
    };
    use psibase::*;

    #[derive(PartialEq, Eq)]
    pub enum EvaluationStatus {
        Registration,
        Deliberation,
        Submission,
        Closed,
    }

    #[derive(Eq, PartialEq)]
    pub enum GroupResult {
        NotEnoughAttestations,
        Order(Vec<AccountNumber>),
    }

    pub fn get_scheduled_phase(
        evaluation: &Evaluation,
        current_time_seconds: u32,
    ) -> EvaluationStatus {
        if current_time_seconds < evaluation.registration {
            EvaluationStatus::Registration
        } else if current_time_seconds < evaluation.deliberation {
            EvaluationStatus::Deliberation
        } else if current_time_seconds < evaluation.submission {
            EvaluationStatus::Submission
        } else {
            EvaluationStatus::Closed
        }
    }

    pub fn get_evaluation(id: u32) -> Evaluation {
        let table: EvaluationTable = EvaluationTable::new();
        table.get_index_pk().get(&id).unwrap()
    }

    pub fn update_evaluation(evaluation: &Evaluation) {
        let table: EvaluationTable = EvaluationTable::new();
        table.put(&evaluation).unwrap();
    }

    pub fn get_next_id() -> u32 {
        let table = ConfigTable::new();
        let mut config = table.get_index_pk().get(&SingletonKey {}).unwrap();
        config.last_used_id += 1;
        table.put(&config).unwrap();
        config.last_used_id
    }

    pub fn shuffle_vec<T>(vec: &mut Vec<T>, seed: u64) {
        let len = vec.len();
        if len <= 1 {
            return;
        }

        let mut rng = seed;
        fn next_rand(current: u64) -> u64 {
            current
                .wrapping_mul(6364136223846793005)
                .wrapping_add(1442695040888963407)
        }

        for i in (1..len).rev() {
            rng = next_rand(rng);
            let j = (rng as usize) % (i + 1);
            vec.swap(i, j);
        }
    }

    pub fn spread_users_into_groups(
        users: &Vec<AccountNumber>,
        group_sizes: Vec<u8>,
    ) -> Vec<Vec<AccountNumber>> {
        let mut users_to_process = users.clone();
        let mut groups = vec![];

        for group_size in group_sizes {
            let mut group = vec![];
            for _ in 0..group_size {
                let user = users_to_process.pop();
                if let Some(user) = user {
                    group.push(user);
                }
            }
            if group.len() > 0 {
                groups.push(group);
            }
        }
        groups
    }

    pub fn calculate_results(
        attestations: Vec<Option<Vec<AccountNumber>>>,
        users: Vec<AccountNumber>,
        is_past_deadline: bool,
    ) -> GroupResult {
        let percent_attested = attestations.len() as f64 / users.len() as f64;
        if !is_past_deadline && percent_attested < 0.66 {
            return GroupResult::NotEnoughAttestations;
        }
        let x = GroupResult::Order(users);
        return x;
    }

    pub fn get_group_result(
        evaluation_id: u32,
        group_number: u32,
        current_time: u32,
    ) -> GroupResult {
        let group_table = GroupTable::new();
        let group = group_table
            .get_index_pk()
            .get(&(evaluation_id, group_number))
            .unwrap();
        let attestation_table: AttestationTable = AttestationTable::new();
        let mut attestations: Vec<Option<Vec<AccountNumber>>> = Vec::new();

        for member in group.members.clone() {
            let attestation = attestation_table
                .get_index_pk()
                .get(&(evaluation_id, member))
                .unwrap();
            attestations.push(attestation.submission);
        }

        let evaluation = get_evaluation(evaluation_id);

        let status = get_scheduled_phase(&evaluation, current_time);
        calculate_results(
            attestations,
            group.members,
            status == EvaluationStatus::Closed,
        )
    }
}

#[psibase::service(name = "evaluations")]
pub mod service {

    use crate::helpers::{self, EvaluationStatus};
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
    fn create(registration: u32, deliberation: u32, submission: u32) {
        let eval_table: EvaluationTable = EvaluationTable::new();

        let next_id = helpers::get_next_id();

        // TODO: Figure out the time
        let current_time_seconds: u32 = 333;

        let evaluation = Evaluation::new(
            next_id,
            current_time_seconds,
            get_sender(),
            registration,
            deliberation,
            submission,
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
    fn propose(evaluation_id: u32, proposal: Vec<u8>) {
        let sender = get_sender();

        let evaluation = helpers::get_evaluation(evaluation_id);
        check(
            helpers::get_scheduled_phase(&evaluation, 222)
                == helpers::EvaluationStatus::Deliberation,
            "evaluation must be in deliberation phase",
        );

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
    fn start(id: u32, entropy: u64) {
        let mut evaluation = helpers::get_evaluation(id);
        let current_time_seconds: u32 = 222;

        let status = helpers::get_scheduled_phase(&evaluation, current_time_seconds);

        check(
            status == helpers::EvaluationStatus::Deliberation,
            "evaluation must be in deliberation phase",
        );
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
    fn groupKey(evaluation_id: u32, group_number: u32, keys: Vec<Vec<u8>>, hash: String) {
        let evaluation = helpers::get_evaluation(evaluation_id);

        let current_time_seconds: u32 = 222;
        let status = helpers::get_scheduled_phase(&evaluation, current_time_seconds);
        check(
            status == helpers::EvaluationStatus::Deliberation,
            "evaluation must be in deliberation phase",
        );

        let group_table = GroupTable::new();
        let sender = get_sender();

        let mut group = group_table
            .get_index_pk()
            .get(&(evaluation_id, group_number))
            .unwrap();
        check(
            group.key_submitter.is_none(),
            "group key has already been submitted",
        );

        check(
            group.members.contains(&sender),
            "user is not a member of the group",
        );

        group.key_submitter = Some(sender);
        group.key_hash = Some(hash);
        group.keys = vec!["TODO".to_string()];
        group_table.put(&group).unwrap();
    }

    #[action]
    #[allow(non_snake_case)]
    fn closeEvaluation(id: u32) {
        let evaluation_table: EvaluationTable = EvaluationTable::new();
        let group_table: GroupTable = GroupTable::new();

        let evaluation = helpers::get_evaluation(id);

        let current_time_seconds: u32 = 222;
        let status = helpers::get_scheduled_phase(&evaluation, current_time_seconds);

        check(
            status == EvaluationStatus::Closed,
            "evaluation has not reached closed time",
        );

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
    fn nudge_group(evaluation_id: u32, group_number: u32) {
        let group_table = GroupTable::new();
        let group = group_table
            .get_index_pk()
            .get(&(evaluation_id, group_number))
            .unwrap();

        check(group.key_submitter.is_some(), "cannot attest without key");

        let evaluation = helpers::get_evaluation(evaluation_id);
        let current_time_seconds: u32 = 111;

        check(
            helpers::get_scheduled_phase(&evaluation, current_time_seconds)
                == helpers::EvaluationStatus::Closed,
            "evaluation must be in closed phase",
        );

        let attestation_table: AttestationTable = AttestationTable::new();
        let mut attestations: Vec<Option<Vec<AccountNumber>>> = Vec::new();

        for member in group.members.clone() {
            let attestation = attestation_table
                .get_index_pk()
                .get(&(evaluation_id, member))
                .unwrap();
            attestations.push(attestation.submission);
        }
        let result = helpers::calculate_results(attestations, group.members, true);

        match result {
            helpers::GroupResult::Order(users) => {
                let mut group = group_table
                    .get_index_pk()
                    .get(&(evaluation_id, group_number))
                    .unwrap();
                group.result = Some(users);
                group_table.put(&group).unwrap();
            }
            helpers::GroupResult::NotEnoughAttestations => {
                check(false, "not enough attestations");
            }
        }
    }

    #[action]
    #[allow(non_snake_case)]
    fn attest(evaluation_id: u32, submission: Vec<String>) {
        let sender = get_sender();

        let evaluation = helpers::get_evaluation(evaluation_id);
        let current_time_seconds: u32 = 222;

        let scheduled_phase = helpers::get_scheduled_phase(&evaluation, current_time_seconds);

        check(
            scheduled_phase == helpers::EvaluationStatus::Deliberation,
            "evaluation must be in deliberation phase",
        );
        // Question: Can someone attest if they haven't proposed?

        let attestation_table: AttestationTable = AttestationTable::new();
        let mut attestation = attestation_table
            .get_index_pk()
            .get(&(evaluation_id, sender))
            .unwrap();

        check(
            attestation.submission.is_none(),
            "user has already submitted",
        );

        let submission_account_numbers = submission
            .iter()
            .map(|s| AccountNumber::from(s.as_str()))
            .collect();

        attestation.submission = Some(submission_account_numbers);

        attestation_table.put(&attestation).unwrap();

        let group_table = GroupTable::new();
        let group = group_table
            .get_index_pk()
            .get(&(attestation.evaluation_id, attestation.group_number))
            .unwrap();

        check(group.key_submitter.is_some(), "cannot attest without key");

        let members = group.members;
        let mut member_attestations: Vec<Option<Vec<AccountNumber>>> = Vec::new();

        for member in members.clone() {
            let member_attest = attestation_table
                .get_index_pk()
                .get(&(evaluation_id, member))
                .unwrap();

            member_attestations.push(member_attest.submission);
        }

        let result = helpers::calculate_results(
            member_attestations,
            members,
            scheduled_phase == helpers::EvaluationStatus::Closed,
        );
        match result {
            helpers::GroupResult::Order(users) => {
                let mut group = group_table
                    .get_index_pk()
                    .get(&(evaluation_id, attestation.group_number))
                    .unwrap();
                group.result = Some(users);
                group_table.put(&group).unwrap();
            }
            _ => return,
        }
    }

    #[action]
    #[allow(non_snake_case)]
    fn register(id: u32) {
        let sender = get_sender();

        let current_time_seconds: u32 = 222;
        let mut evaluation = helpers::get_evaluation(id);

        let status: helpers::EvaluationStatus =
            helpers::get_scheduled_phase(&evaluation, current_time_seconds);

        let is_allowed_to_register = true;

        check(is_allowed_to_register, "user is not allowed to register");
        check(
            status == helpers::EvaluationStatus::Registration,
            "evaluation must be in registration phase",
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
