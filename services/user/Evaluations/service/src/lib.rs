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
        pub group_sizes: Vec<u8>,
        pub groups_created: Vec<u32>,
        pub users: Vec<AccountNumber>,
    }

    #[table(name = "AttestationTable", index = 2)]
    #[derive(Default, Fracpack, ToSchema, SimpleObject, Serialize, Deserialize, Debug)]
    pub struct Attestation {
        pub evaluation_id: u32,
        pub owner: AccountNumber,
        pub group_id: u32,

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
                ordering: None,
            }
        }
    }
}

pub mod helpers {

    use crate::tables::{ConfigTable, Evaluation, EvaluationTable};
    use psibase::*;

    #[derive(PartialEq, Eq)]
    pub enum EvaluationStatus {
        Registration,
        Deliberation,
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
}

#[psibase::service(name = "evaluations")]
pub mod service {

    use crate::helpers;
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
            group_sizes: vec![6],
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

        let mut groups = vec![];

        for group_size in sized_groups {
            let mut group = vec![];
            for _ in 0..group_size {
                group.push(users_to_process.pop().unwrap());
            }
            groups.push(group);
        }

        let attestation_table: AttestationTable = AttestationTable::new();

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
