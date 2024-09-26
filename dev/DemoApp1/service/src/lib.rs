/// This is another example service that adds and multiplies `i32`
/// numbers, similar to test_contract. This service has additional
/// features such as writing tables, and providing a graphiql
/// query interface.
#[psibase::service]
#[allow(non_snake_case)]
mod service {
    use async_graphql::*;
    use psibase::*;
    use serde::{Deserialize, Serialize};

    /// Holds an answer to a calculation done by an account `id`
    #[table(name = "AnswerTable", index = 0)]
    #[derive(Fracpack, ToSchema, Serialize, Deserialize, SimpleObject)]
    pub struct Answer {
        /// The account responsible for the calculation
        #[primary_key]
        id: AccountNumber,

        /// The result of the calculation
        result: i32,
    }

    #[table(record = "WebContentRow", index = 1)]
    struct WebContentTable;

    #[action]
    pub fn add(a: i32, b: i32) -> i32 {
        let res = a + b;

        let answer_table = AnswerTable::new();
        answer_table
            .put(&Answer {
                id: get_sender(),
                result: res,
            })
            .unwrap();

        Wrapper::emit().history().add(a, b, res);

        res
    }

    #[action]
    pub fn multiply(a: u32, b: u32) -> u32 {
        let res = a * b;

        let answer_table = AnswerTable::new();
        answer_table
            .put(&Answer {
                id: get_sender(),
                result: res as i32,
            })
            .unwrap();

        res
    }

    #[event(history)]
    pub fn add(a: i32, b: i32, result: i32) {}
    #[event(history)]
    pub fn multiply(a: i32, b: i32, result: i32) {}

    struct Query;

    #[Object]
    impl Query {
        async fn answer(&self, account: AccountNumber) -> Option<Answer> {
            AnswerTable::new().get_index_pk().get(&account)
        }

        async fn answers(&self, _account: AccountNumber) -> Option<Vec<i32>> {
            let answer_table = AnswerTable::new();
            let tab = answer_table.get_index_pk();

            Some(tab.iter().map(|val| val.result).collect())
        }

        async fn event(&self, id: u64) -> Result<event_structs::HistoryEvents, anyhow::Error> {
            get_event(id)
        }
    }

    #[action]
    #[allow(non_snake_case)]
    fn serveSys(request: HttpRequest) -> Option<HttpReply> {
        None.or_else(|| serve_content(&request, &WebContentTable::new()))
            .or_else(|| serve_graphql(&request, Query))
            .or_else(|| serve_graphiql(&request))
    }
}
