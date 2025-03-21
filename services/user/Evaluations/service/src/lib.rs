pub mod constants {
    pub const EVALUATION: u8 = 1;
    pub const GROUP: u8 = 2;
}

#[psibase::service_tables]
pub mod tables {

    use async_graphql::SimpleObject;
    use psibase::{Fracpack, ToKey, ToSchema};
    use serde::{Deserialize, Serialize};

    #[table(name = "InitTable", index = 0)]
    #[derive(Serialize, Deserialize, ToSchema, Fracpack)]
    pub struct InitRow {}

    impl InitRow {
        #[primary_key]
        fn pk(&self) {}
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

    #[table(name = "LastUsedTable", index = 2)]
    #[derive(Fracpack, ToSchema, SimpleObject, Default, Serialize, Deserialize, Debug)]
    pub struct LastUsed {
        #[primary_key]
        pub entity: u8,

        pub id: u32,
    }
}

#[psibase::service(name = "evaluations")]
pub mod service {
    use crate::constants;
    use crate::tables::{Evaluation, EvaluationTable, LastUsed, LastUsedTable};

    use psibase::*;

    impl LastUsed {
        fn get_next_id(entity: u8) -> u32 {
            let table = LastUsedTable::new();
            let mut last_used = table.get_index_pk().get(&entity).unwrap_or_default();
            last_used.id += 1;
            last_used.entity = entity;
            table.put(&last_used).unwrap();
            last_used.id
        }
    }

    #[action]
    fn init() {}

    #[action]
    #[allow(non_snake_case)]
    fn scheduleEvaluation(
        id: u32,
        rsvp_start_from: u32,
        rsvp_deadline: u32,
        evaluation_deadline: u32,
    ) {
        let eval_table: EvaluationTable = EvaluationTable::new();

        let next_id = LastUsed::get_next_id(constants::EVALUATION);

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

// ////////////////////////////////////// TYPES

// interface hook-service-api {
//     eval-register: func(eval-id, user, description) -> bool
//     eval-propose: func(proposer, eval-id, group-nr, ordering: list<u8>)
//     eval-attest: func(attester, eval-id, group-nr, ordering: list<account>)
//     eval-group-fin: func(eval-id, group-nr, hash)
//  }

//  record Timings { // seconds
//     registration: u32,
//     deliberation: u32,
//     submission: u32
//  }

//  record EvalConfig {
//     owner: account,
//     use-hooks: bool,
//     group-sizes: option<list<u8>>, // None means only one group, otherwise list entries are allowed group sizes. Minimum = 3.
//     timings: Timings
//  }

//  record Eval {
//     id: u32,
//     creation-date,
//     config: EvalConfig,
//  }

//  record score {
//     eval-id: u32,
//     user: account,
//     entropy: u64,
//     rank: u8,
//     group-id: option<u16>,
//     group-key: option<list<u8>>,
//  }
//  score-table: table<score>

//  record attestation: {
//      eval-id: u32,
//      hash: list<u8>, // primary key: { evail-id, hash }
//      group-nr: u16,
//      ordering: list<account>,
//      nr-attested: u8,
//  }

//  ////////////////////////////////////// ACTIONS

//  /// Creates a new evaluation
//  /// - Requires no currently open evaluation
//  /// - Temporarily: Anyone can open an eval on behalf of anyone.
//  ///   Future: Validate that the sender == owner
//  open(eval: Eval)

//  /// Register for an evaluation
//  /// - Requires specified eval is open
//  /// - Requires being in the registration phase
//  /// - Calls `hook-service:is-valid-reg` to allow eval owner to enforce constraints
//  register(id: u32, entropy: u64, description: option<string>)

//  /// Generate groups
//  /// - Requires being in the deliberation phase
//  /// - Calculates the groups on the server side
//  generate-groups(id: u32)

//  /// Publish group-key.
//  /// The group key is an encrypted symmetric key used for sharing group-private messages
//  /// The number of keys should match the number of group members
//  /// - Requires being in the deliberation phase
//  /// - Requires no group-key exists
//  group-key(id: u32, group-nr: u16, keys: list<list<u8>>)

//  /// Propose a rank-ordering (encrypted with group key)
//  /// - Requires being in the deliberation phase
//  propose(id: u32, group-nr: u16, ordering: list<u8>)

//  /// Attest to a final rank-ordering
//  /// - Requires being in the submission phase
//  /// - Requires that sender is in the specified group
//  /// - Requires that the sender has not attested prior
//  attest(id: u32, group-nr: u16, ordering: list<account>)

//  /// Closes an evaluation, deleting all associated data
//  /// - Requires that the submission phase has ended
//  /// - Temporarily: anyone can close an eval
//  ///   Future: Validate that the sender == owner
//  close(id: u32)
