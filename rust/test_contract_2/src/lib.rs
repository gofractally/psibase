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
            condition: Option<String>,
            first: Option<i32>,
            last: Option<i32>,
            before: Option<String>,
            after: Option<String>,
        ) -> Result<Connection<i32, AddEvent>, async_graphql::Error> {
            let mut q = EventQuery::new("history.example.add")
                .first(first)
                .last(last)
                .before(before)
                .after(after);

            if let Some(condition) = condition {
                q = q.condition(condition);
            }

            q.query()
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
    Wrapper::push(&chain).add(7, 8);
    Wrapper::push(&chain).add(9, 10);
    Wrapper::push(&chain).add(11, 12);
    Wrapper::push(&chain).add(13, 14);
    Wrapper::push(&chain).add(15, 16);
    Wrapper::push(&chain).add(17, 18);
    Wrapper::push(&chain).add(19, 20);

    chain.finish_block();

    let all_events: Value = chain.graphql(
        SERVICE,
        r#"query {
            getAddEvents {
                edges {
                    cursor
                    node { a b result }
                }
            }
        }"#,
    )?;

    // Extract first and last cursors for subsequent tests
    let edges = all_events["data"]["getAddEvents"]["edges"]
        .as_array()
        .unwrap();
    let cursor_1 = edges[0]["cursor"].as_str().unwrap();
    let cursor_2 = edges[1]["cursor"].as_str().unwrap();
    let cursor_4 = edges[3]["cursor"].as_str().unwrap();
    let cursor_5 = edges[4]["cursor"].as_str().unwrap();
    let cursor_6 = edges[5]["cursor"].as_str().unwrap();
    let cursor_9 = edges[8]["cursor"].as_str().unwrap();
    let cursor_10 = edges[9]["cursor"].as_str().unwrap();

    // first: 2
    let reply: Value = chain.graphql(
        SERVICE,
        r#"query {
            getAddEvents(first: 2) {
                edges {
                    cursor
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
                        {"cursor": cursor_1, "node": {"a": 1, "b": 2, "result": 3}},
                        {"cursor": cursor_2, "node": {"a": 3, "b": 4, "result": 7}}
                    ]
                }
            }
        })
    );
    println!("Test passed: first:2");

    // first:1 after first
    let reply: Value = chain.graphql(
        SERVICE,
        &format!(
            r#"query {{
            getAddEvents(first: 1, after: "{}") {{
                edges {{
                    cursor
                    node {{ a b result }}
                }}
            }}
        }}"#,
            cursor_1
        ),
    )?;
    assert_eq!(
        reply,
        json!({
            "data": {
                "getAddEvents": {
                    "edges": [
                        {"cursor": cursor_2, "node": {"a": 3, "b": 4, "result": 7}}
                    ]
                }
            }
        })
    );
    println!("Test passed: first:1 after first");

    // last:2
    let reply: Value = chain.graphql(
        SERVICE,
        r#"query {
            getAddEvents(last: 2) {
                edges {
                    cursor
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
                        {"cursor": cursor_9, "node": {"a": 17, "b": 18, "result": 35}},
                        {"cursor": cursor_10, "node": {"a": 19, "b": 20, "result": 39}}
                    ]
                }
            }
        })
    );
    println!("Test passed: last:2");

    // last:1 before last
    let reply: Value = chain.graphql(
        SERVICE,
        &format!(
            r#"query {{
            getAddEvents(last: 1, before: "{}") {{
                edges {{
                    cursor
                    node {{ a b result }}
                }}
            }}
        }}"#,
            cursor_10
        ),
    )?;
    assert_eq!(
        reply,
        json!({
            "data": {
                "getAddEvents": {
                    "edges": [
                        {"cursor": cursor_9, "node": {"a": 17, "b": 18, "result": 35}}
                    ]
                }
            }
        })
    );
    println!("Test passed: last:1 before last");

    // after:4 before:6
    let reply: Value = chain.graphql(
        SERVICE,
        &format!(
            r#"query {{
            getAddEvents(after: "{}", before: "{}") {{
                edges {{
                    cursor
                    node {{ a b result }}
                }}
            }}
        }}"#,
            cursor_4, cursor_6
        ),
    )?;
    assert_eq!(
        reply,
        json!({
            "data": {
                "getAddEvents": {
                    "edges": [
                        {"cursor": cursor_5, "node": {"a": 9, "b": 10, "result": 19}}
                    ]
                }
            }
        })
    );
    println!("Test passed: after:4 before:6");

    // condition a = 1
    let reply: Value = chain.graphql(
        SERVICE,
        r#"query {
            getAddEvents(condition: "a = 1") {
                edges {
                    cursor
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
                        {"cursor": cursor_1, "node": {"a": 1, "b": 2, "result": 3}}
                    ]
                }
            }
        })
    );
    println!("Test passed: condition a = 1");

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
