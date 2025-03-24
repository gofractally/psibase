#[psibase::service_tables]
pub mod tables {

    use async_graphql::SimpleObject;
    use psibase::{Fracpack, SingletonKey, ToSchema};
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

        pub rsvp_start_from: u32,
        pub rsvp_deadline: u32,
        pub evaluation_deadline: u32,
    }
}

#[psibase::service(name = "evaluations")]
pub mod service {
    use crate::tables::{ConfigRow, ConfigTable, Evaluation, EvaluationTable};

    use psibase::*;

    fn get_next_id() -> u32 {
        let table = ConfigTable::new();
        let mut config = table.get_index_pk().get(&SingletonKey {}).unwrap();
        config.last_used_id += 1;
        table.put(&config).unwrap();
        config.last_used_id
    }

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
    fn scheduleEvaluation(rsvp_start_from: u32, rsvp_deadline: u32, evaluation_deadline: u32) {
        let eval_table: EvaluationTable = EvaluationTable::new();

        let next_id = get_next_id();

        let evaluation = Evaluation {
            id: next_id,
            rsvp_start_from,
            rsvp_deadline,
            evaluation_deadline,
        };

        eval_table.put(&evaluation).unwrap();
    }

    #[action]
    #[allow(non_snake_case)]
    fn getEvaluation(id: u32) -> Option<Evaluation> {
        let table = EvaluationTable::new();
        table.get_index_pk().get(&id)
    }
}

#[cfg(test)]
mod tests;
