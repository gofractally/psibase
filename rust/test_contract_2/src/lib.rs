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
    use crate::tables::{Answer, AnswerTable};
    use async_graphql::{connection::Connection, *};
    use psibase::services::events::Wrapper as EventsSvc;
    use psibase::*;
    use serde::{Deserialize, Serialize};
    use serde_aux::field_attributes::deserialize_number_from_string;

    #[derive(SimpleObject, Deserialize)]
    pub struct AddEvent {
        #[serde(deserialize_with = "deserialize_number_from_string")]
        a: i32,
        #[serde(deserialize_with = "deserialize_number_from_string")]
        b: i32,
        #[serde(deserialize_with = "deserialize_number_from_string")]
        result: i32,
    }

    #[derive(SimpleObject, Serialize, Deserialize, Pack, Unpack, ToSchema, Debug, Clone)]
    pub struct ExampleRecord {
        count: u32,
        value: i32,
        message: String,
    }

    #[action]
    pub fn init() {
        EventsSvc::call().setSchema(create_schema::<Wrapper>());
    }

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

    #[action]
    pub fn create_record(count: u32, value: i32, message: String) {
        Wrapper::emit().history().save_record(ExampleRecord {
            count,
            value,
            message,
        });
    }

    #[event(history)]
    pub fn add(a: i32, b: i32, result: i32) {}
    #[event(history)]
    pub fn multiply(a: i32, b: i32, result: i32) {}
    #[event(history)]
    pub fn save_record(record: ExampleRecord) {}

    #[derive(SimpleObject, Serialize, Deserialize)]
    pub struct ExampleRecordWrapper {
        record: ExampleRecord,
    }

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

        async fn get_add_events(
            &self,
            first: Option<i32>,
            last: Option<i32>,
            before: Option<String>,
            after: Option<String>,
        ) -> Result<Connection<i32, AddEvent>, async_graphql::Error> {
            EventQuery::new("history.example.add")
                .first(first)
                .last(last)
                .before(before)
                .after(after)
                .query()
        }

        async fn get_saved_records(
            &self,
            first: Option<i32>,
            last: Option<i32>,
            before: Option<String>,
            after: Option<String>,
        ) -> Result<Connection<i32, ExampleRecordWrapper>, async_graphql::Error> {
            EventQuery::new("history.example.save_record")
                .first(first)
                .last(last)
                .before(before)
                .after(after)
                .query()
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
        json!({
            "add": {"a": 0, "b": 0},
            "multiply": {"a": 0, "b": 0},
            "init": {},
            "create_record": {"count": 0, "value": 0, "message": ""},
            "serveSys": {
                "request": {
                    "body": "",
                    "contentType": "",
                    "headers": [{"name": "", "value": ""}],
                    "host": "",
                    "method": "",
                    "rootHost": "",
                    "target": ""
                }
            }
        })
    );

    Ok(())
}

#[psibase::test_case(packages("TestContract2"))]
fn test_add_events(chain: psibase::Chain) -> Result<(), psibase::Error> {
    use psibase::services::http_server;
    use serde_json::{json, Value};

    http_server::Wrapper::push_from(&chain, SERVICE).registerServer(SERVICE);

    Wrapper::push(&chain).init();
    Wrapper::push(&chain).add(1, 2);
    Wrapper::push(&chain).add(3, 4);
    Wrapper::push(&chain).add(5, 6);

    chain.finish_block();

    // Test pagination of add events
    let reply: Value = chain.graphql(
        SERVICE,
        r#"query {
            getAddEvents(first: 2) {
                edges {
                    node { a b result }
                }
            }
        }"#,
    )?;

    assert_eq!(
        reply,
        json!({
            "data": {
                "getAddEvents": {
                    "edges": [
                        {"node": {"a": 1, "b": 2, "result": 3}},
                        {"node": {"a": 3, "b": 4, "result": 7}}
                    ]
                }
            }
        })
    );

    Ok(())
}

#[psibase::test_case(packages("TestContract2"))]
fn test_example_records(chain: psibase::Chain) -> Result<(), psibase::Error> {
    use psibase::services::http_server;
    use serde_json::{json, Value};

    http_server::Wrapper::push_from(&chain, SERVICE).registerServer(SERVICE);

    Wrapper::push(&chain).init();
    Wrapper::push(&chain).create_record(1, 42, "first".to_string());
    Wrapper::push(&chain).create_record(2, -10, "second".to_string());

    chain.finish_block();

    let reply: Value = chain.graphql(
        SERVICE,
        r#"query {
            getSavedRecords(first: 1) {
                edges {
                    node { record { count value message } }
                }
            }
        }"#,
    )?;

    assert_eq!(
        reply,
        json!({
            "data": {
                "getSavedRecords": {
                    "edges": [
                        {"node": {"record": {"count": 1, "value": 42, "message": "first"}}}
                    ]
                }
            }
        })
    );

    Ok(())
}
