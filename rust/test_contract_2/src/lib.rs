/// This is another example service that adds and multiplies `i32`
/// numbers, similar to test_contract. This service has additional
/// features such as writing tables, and providing a graphiql
/// query interface.

#[psibase::service_tables]
mod tables {
    use async_graphql::*;
    use psibase::*;
    use serde::{Deserialize, Serialize};
    /// Holds an answer to a calculation done by an account `id`
    #[table(name = "AnswerTable", index = 0)]
    #[derive(Fracpack, Serialize, Deserialize, SimpleObject)]
    pub struct Answer {
        /// The account responsible for the calculation
        #[primary_key]
        pub id: AccountNumber,

        /// The result of the calculation
        pub result: i32,
    }
}

#[psibase::service]
#[allow(non_snake_case)]
mod service {
    use async_graphql::*;
    use psibase::*;

    use crate::tables::{Answer, AnswerTable};

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
    pub fn multiply(a: i32, b: i32) -> i32 {
        let res = a * b;

        let answer_table = AnswerTable::new();
        answer_table
            .put(&Answer {
                id: get_sender(),
                result: res,
            })
            .unwrap();

        Wrapper::emit().history().multiply(a, b, res);

        res
    }

    #[event(history)]
    pub fn add(a: i32, b: i32, result: i32) {}
    #[event(history)]
    pub fn multiply(a: i32, b: i32, result: i32) {}

    struct Query;

    #[Object]
    impl Query {
        /// Get the answer to `account`'s most recent calculation
        async fn answer(&self, account: AccountNumber) -> Option<Answer> {
            AnswerTable::new().get_index_pk().get(&account)
        }

        /// Look up an event
        ///
        /// ```
        /// query {
        ///   event(id: 1) {
        ///     __typename
        ///     ... on Add {
        ///       a b result
        ///     }
        ///     ... on Multiply {
        ///       a b result
        ///     }
        ///   }
        /// }
        /// ```
        async fn event(&self, id: u64) -> Result<event_structs::HistoryEvents, anyhow::Error> {
            get_event(id)
        }
    }

    #[action]
    #[allow(non_snake_case)]
    fn serveSys(request: HttpRequest) -> Option<HttpReply> {
        None.or_else(|| serve_simple_ui::<Wrapper>(&request))
            .or_else(|| serve_graphql(&request, Query))
            .or_else(|| serve_graphiql(&request))
    }
}

#[psibase::test_case(packages("TestContract2"))]
fn test_arith(chain: psibase::Chain) -> Result<(), psibase::Error> {
    use psibase::services::http_server;
    use psibase::HttpBody;
    use serde_json::{json, Value};
    http_server::Wrapper::push_from(&chain, SERVICE).registerServer(SERVICE);
    let result = Wrapper::push(&chain).add(3, 4);
    assert_eq!(result.get()?, 7);
    println!("\n\nTrace:\n{}", result.trace);

    chain.finish_block();
    let reply: Value = chain.graphql(
        SERVICE,
        r#"query { answer(account: "example") { id result } }"#,
    )?;
    assert_eq!(
        reply,
        json!({ "data": { "answer": {"id": "example", "result": 7} } })
    );

    let reply = chain
        .post(
            SERVICE,
            "/pack_action/add",
            HttpBody::json(r#"{"a":5,"b":7}"#),
        )?
        .body;
    assert_eq!(format!("{}", reply), "08000500000007000000");

    println!("{}", chain.get(SERVICE, "/action_templates")?.text()?);
    let reply: Value = chain.get(SERVICE, "/action_templates")?.json()?;
    assert_eq!(
        reply,
        json!({"add":{"a":0, "b": 0}, "multiply": {"a": 0, "b": 0}, "serveSys": {"request": {"body": "", "contentType": "", "headers": [{"name": "", "value": ""}], "host": "", "method": "", "rootHost": "", "target": ""}}})
    );

    Ok(())
}
