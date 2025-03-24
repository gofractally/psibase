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
        pub owner: AccountNumber,
        pub group_id: u32,
        pub is_final: bool,
        pub ordering: Option<Vec<AccountNumber>>,
    }

    impl Attestation {
        #[primary_key]
        fn pk(&self) -> (u32, AccountNumber) {
            (self.evaluation_id, self.owner)
        }

        pub fn new(evaluation_id: u32, owner: AccountNumber, group_id: u32) -> Self {
            Self {
                evaluation_id,
                owner,
                group_id,
                is_final: false,
                ordering: None,
            }
        }
    }
}

pub mod helpers {

    use crate::tables::{Attestation, ConfigTable, Evaluation, EvaluationTable};
    use psibase::*;

    #[derive(PartialEq, Eq)]
    pub enum EvaluationStatus {
        Registration,
        Deliberation,
        Submission,
        Closed,
    }

    pub fn get_timed_status(
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

    pub fn rank_order_group(attestations: Vec<Attestation>) -> Vec<AccountNumber> {
        vec![]
    }
}

#[psibase::service(name = "evaluations")]
pub mod service {

    use crate::helpers::{self, EvaluationStatus};
    use crate::tables::{
        Attestation, AttestationTable, ConfigRow, ConfigTable, Evaluation, EvaluationTable,
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
    fn scheduleEvaluation(registration: u32, deliberation: u32, submission: u32) {
        let eval_table: EvaluationTable = EvaluationTable::new();

        let next_id = helpers::get_next_id();
        // TODO: Figure out the time
        let current_time_seconds: u32 = 333;

        let evaluation = Evaluation {
            id: next_id,
            owner: get_sender(),
            created_at: current_time_seconds,
            registration,
            deliberation,
            submission,
            use_hooks: false,
            group_results: vec![],
            group_sizes: vec![],
            groups_created: vec![],
            users: vec![],
        };

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
    fn setGroupSizes(id: u32, group_sizes: Vec<u8>) {
        let mut evaluation = helpers::get_evaluation(id);
        check(
            evaluation.owner == get_sender(),
            "only the owner can set the group sizes",
        );
        let current_time_seconds: u32 = 222;
        let status = helpers::get_timed_status(&evaluation, current_time_seconds);
        check(
            status == helpers::EvaluationStatus::Registration,
            "evaluation must be in registration or deliberation phase",
        );
        evaluation.group_sizes = group_sizes;
        helpers::update_evaluation(&evaluation);
    }

    #[action]
    #[allow(non_snake_case)]
    fn startEvaluation(id: u32) {
        let mut evaluation = helpers::get_evaluation(id);
        let current_time_seconds: u32 = 222;
        let status = helpers::get_timed_status(&evaluation, current_time_seconds);

        check(
            status == helpers::EvaluationStatus::Deliberation,
            "evaluation must be in deliberation phase",
        );

        let has_not_ran_before = false;
        check(has_not_ran_before, "evaluation has already been started");

        // iterate over the groups array and create a group for each one of that size
        let mut users_to_process = evaluation.users.clone();
        let sized_groups = evaluation.group_sizes.clone();

        let seed: u64 = 123;

        helpers::shuffle_vec(&mut users_to_process, seed);

        let attestation_table: AttestationTable = AttestationTable::new();
        let groups = helpers::spread_users_into_groups(&users_to_process, sized_groups);

        for group in groups {
            let group_id = helpers::get_next_id();
            evaluation.groups_created.push(group_id);
            for user in group {
                let attestation = Attestation::new(evaluation.id, user, group_id);
                attestation_table.put(&attestation).unwrap();
            }
        }

        helpers::update_evaluation(&evaluation);
    }

    fn is_all_users_attested(evaluation: &Evaluation) -> bool {
        evaluation.users.iter().all(|user| {
            AttestationTable::new()
                .get_index_pk()
                .get(&(evaluation.id, *user))
                .map_or(false, |attestation| attestation.is_final)
        })
    }

    #[action]
    #[allow(non_snake_case)]
    fn closeEvaluation(id: u32) {
        let evaluation = helpers::get_evaluation(id);

        check(
            evaluation.group_results.len() == 0,
            "evaluation is already closed",
        );

        let current_time_seconds: u32 = 222;
        let status = helpers::get_timed_status(&evaluation, current_time_seconds);

        let can_close = match status {
            EvaluationStatus::Deliberation | EvaluationStatus::Submission => {
                is_all_users_attested(&evaluation)
            }
            EvaluationStatus::Closed => true,
            _ => false,
        };
        check(can_close, "evaluation is not ready to be closed");

        let attestation_table: AttestationTable = AttestationTable::new();

        let all_user_attestations: Vec<Attestation> = evaluation
            .users
            .clone()
            .iter()
            .map(|user| {
                attestation_table
                    .get_index_pk()
                    .get(&(evaluation.id, *user))
                    .unwrap()
            })
            .collect();

        let mut updated_evaluation = evaluation;

        let group_results = updated_evaluation
            .groups_created
            .iter()
            .map(|group_id| {
                let group_attestations: Vec<Attestation> = all_user_attestations
                    .iter()
                    .filter(|attestation| attestation.group_id == *group_id)
                    .cloned()
                    .collect();

                helpers::rank_order_group(group_attestations)
            })
            .collect();

        updated_evaluation.group_results = group_results;
        helpers::update_evaluation(&updated_evaluation);
    }

    #[action]
    #[allow(non_snake_case)]
    fn attest(evaluation_id: u32, ordering: Vec<AccountNumber>, is_final: bool) {
        let sender = get_sender();

        let evaluation = helpers::get_evaluation(evaluation_id);
        let current_time_seconds: u32 = 222;
        check(
            helpers::get_timed_status(&evaluation, current_time_seconds)
                == helpers::EvaluationStatus::Deliberation,
            "evaluation must be in deliberation phase",
        );

        let attestation_table: AttestationTable = AttestationTable::new();
        let attestation = attestation_table
            .get_index_pk()
            .get(&(evaluation_id, sender));
        check(attestation.is_some(), "no attestation found for this user");
        let mut attestation = attestation.unwrap();
        check(attestation.is_final == false, "user has already attested");

        attestation.ordering = Some(ordering);
        attestation.is_final = is_final;
        attestation_table.put(&attestation).unwrap();
    }

    #[action]
    #[allow(non_snake_case)]
    fn register(id: u32, entropy: u64) {
        let sender = get_sender();

        let current_time_seconds: u32 = 222;
        let mut evaluation = helpers::get_evaluation(id);

        let status: helpers::EvaluationStatus =
            helpers::get_timed_status(&evaluation, current_time_seconds);

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
