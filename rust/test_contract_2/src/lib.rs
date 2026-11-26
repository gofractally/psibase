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
    use serde_aux::field_attributes::deserialize_number_from_string;

    /// Holds an answer to a calculation done by an account `id`
    #[table(name = "AnswerTable", index = 0)]
    #[derive(SimpleObject, psio::PsszPack, psio::PsszUnpack, psio::ToPsszSchema, psio::JsonText, psio::Serde)]
    pub struct Answer {
        /// The account responsible for the calculation
        #[primary_key]
        pub id: AccountNumber,

        /// The result of the calculation
        pub result: i32,
    }

    /// A row with a declared member: a memo is UTF-8 of at most 80 bytes.
    #[table(name = "NoteTable", index = 1)]
    #[derive(psio::PsszPack, psio::PsszUnpack, psio::ToPsszSchema, psio::JsonText, psio::Serde)]
    pub struct Note {
        #[primary_key]
        pub id: u32,
        pub memo: Memo,
    }

    #[derive(SimpleObject, Deserialize)]
    pub struct AddEvent {
        #[serde(deserialize_with = "deserialize_number_from_string")]
        a: i32,
        #[serde(deserialize_with = "deserialize_number_from_string")]
        b: i32,
        #[serde(deserialize_with = "deserialize_number_from_string")]
        result: i32,
    }

    #[derive(SimpleObject, Debug, Clone, psio::PsszPack, psio::PsszUnpack, psio::ToPsszSchema, psio::JsonText, psio::Serde)]
    pub struct ExampleRecord {
        count: u32,
        value: i32,
        message: String,
    }

    #[action]
    pub fn init() {}

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

    /// The memo is declared: the dispatcher refuses an argument list that
    /// holds a longer one.
    #[action]
    pub fn note(id: u32, memo: Memo) {
        NoteTable::new().put(&Note { id, memo }).unwrap();
    }

    /// Writes row `id` of this service's own `NoteTable` with a memo of
    /// `80 + extra` bytes: the bytes a fast write leaves for a row that is
    /// outside its declaration (the memo is the last member, so the longer
    /// text still has a frame).
    #[action]
    pub fn store_raw(id: u32, extra: u32) {
        let table = NoteTable::new();
        let mut row = psio::to_pssz(&Note {
            id,
            memo: Memo::new("a".repeat(80)).unwrap(),
        });
        row.extend(std::iter::repeat(b'a').take(extra as usize));
        let key = table.serialize_key(0, &id);
        kv_put_bytes(table.handle(), &psio::to_key(&key), &row);
    }

    /// Stores `row` as the bytes of row `id` of this service's own
    /// `NoteTable`, whatever they are.
    #[action]
    pub fn store_bytes(id: u32, row: Vec<u8>) {
        let table = NoteTable::new();
        let key = table.serialize_key(0, &id);
        kv_put_bytes(table.handle(), &psio::to_key(&key), &row);
    }

    /// The length of the memo of row `id`, read as a service reads its own
    /// table: trusted.
    #[action]
    pub fn note_len(id: u32) -> u32 {
        let note = NoteTable::new().get_index_pk().get(&id).unwrap();
        note.memo.to_string().len() as u32
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
            AnswerTable::read().get_index_pk().get(&account)
        }

        async fn get_add_events(
            &self,
            condition: Option<String>,
            first: Option<i32>,
            last: Option<i32>,
            before: Option<String>,
            after: Option<String>,
        ) -> Result<EventConnection<AddEvent>, async_graphql::Error> {
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
        ) -> Result<EventConnection<ExampleRecordWrapper>, async_graphql::Error> {
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
    use psibase::{HttpBody, Push, Table};
    use serde_json::{json, Value};
    let result = Wrapper::push(&chain).add(3, 4);
    assert_eq!(result.get()?, 7);
    println!("\n\nTrace:\n{}", chain.display_trace(&result.trace));

    chain.finish_block();
    let reply: Value = chain.graphql(
        SERVICE,
        r#"query { answer(account: "example") { id result } }"#,
    )?;
    assert_eq!(
        reply,
        json!({ "data": { "answer": {"id": "example", "result": 7} } })
    );

    let answer = service::AnswerTable::read().get_index_pk().get(&SERVICE);
    assert_eq!(answer.unwrap().result, 7);

    let reply = chain
        .post(
            SERVICE,
            "/pack_action/add",
            HttpBody::json(r#"{"a":5,"b":7}"#),
        )?
        .body;
    // The PSSZ of the argument list: the tuple of the parameters.
    assert_eq!(reply, psio::to_pssz(&(5i32, 7i32)));

    println!("{}", chain.get(SERVICE, "/action_templates")?.text()?);
    let reply: Value = chain.get(SERVICE, "/action_templates")?.json()?;
    assert_eq!(
        reply,
        json!({
            "add": {"a": 0, "b": 0},
            "multiply": {"a": 0, "b": 0},
            "init": {},
            "create_record": {"count": 0, "value": 0, "message": ""},
            "note": {"id": 0, "memo": ""},
            "store_raw": {"id": 0, "extra": 0},
            "note_len": {"id": 0},
            "store_bytes": {"id": 0, "row": ""},
            "serveSys": {
                "request": {
                    "body": "",
                    "contentType": "",
                    "headers": [{"name": "", "value": ""}],
                    "host": "",
                    "method": "",
                    "target": ""
                }
            }
        })
    );

    println!("{}", chain.get(SERVICE, "/schema")?.text()?);

    Ok(())
}

/// Where PSIO's read and write modes meet a Rust service
/// (gofractally/psibase#2281): an action argument is validated at dispatch;
/// a row of the service's own table is read trusted.
#[psibase::test_case(packages("TestContract2"))]
fn test_two_modes(chain: psibase::Chain) -> Result<(), psibase::Error> {
    use psibase::{
        method_raw, Action, Memo, MethodNumber, Push, SignedTransaction, Transaction,
    };

    let longest = Memo::new("a".repeat(80)).unwrap();
    Wrapper::push(&chain).note(1, longest.clone()).get()?;
    assert_eq!(Wrapper::push(&chain).note_len(1).get()?, 80);

    // An argument list that holds a memo of 81 bytes. No `Memo` is that
    // long, so these are the bytes of the longest valid call and one more
    // byte of text. The dispatcher refuses them before the action runs.
    let mut args = psio::to_pssz(&(2u32, longest));
    assert!(psio::from_pssz::<(u32, Memo)>(&args).is_ok());
    args.push(b'a');
    assert!(psio::from_pssz::<(u32, Memo)>(&args).is_err());
    let mut trx = Transaction {
        tapos: Default::default(),
        actions: vec![Action {
            sender: SERVICE,
            service: SERVICE,
            method: MethodNumber::new(method_raw!("note")),
            rawData: args.into(),
        }],
        claims: vec![],
    };
    chain.fill_tapos(&mut trx, 2);
    let trace = chain.push(&SignedTransaction {
        transaction: psio::pssz::Nested::new(&trx).unwrap(),
        proofs: Default::default(),
        subjectiveData: None,
    });
    let error = trace.error_text().expect("an 81-byte memo is refused at dispatch");
    println!("refused: {error}");
    chain.start_block();

    // The same 81 bytes in a row of the service's own table: the service
    // reads its row back as it was written.
    Wrapper::push(&chain).store_raw(3, 1).get()?;
    assert_eq!(Wrapper::push(&chain).note_len(3).get()?, 81);
    Wrapper::push(&chain).store_raw(4, 0).get()?;
    assert_eq!(Wrapper::push(&chain).note_len(4).get()?, 80);

    // A trusted read is still a safe one. Bytes that are not a frame of the
    // row's type (what a wrong change of the type would leave in the table)
    // end the action; nothing outside the row is read.
    let row = psio::to_pssz(&service::Note {
        id: 5,
        memo: Memo::new("abcdefgh".to_string()).unwrap(),
    });
    // header (size of the fixed part), id, offset of the memo, memo
    assert_eq!(row.len(), 14);
    Wrapper::push(&chain).store_bytes(5, row.clone()).get()?;
    assert_eq!(Wrapper::push(&chain).note_len(5).get()?, 8);
    let refused = |id: u32, bytes: Vec<u8>| -> String {
        Wrapper::push(&chain).store_bytes(id, bytes).get().unwrap();
        let error = Wrapper::push(&chain)
            .note_len(id)
            .get()
            .expect_err("a row that is not a frame of its type ends the action")
            .to_string();
        println!("row {id}: {error}");
        error
    };
    // Cut inside the fixed part
    assert!(refused(6, row[..3].to_vec()).contains("out of range"));
    // No bytes at all
    assert!(refused(7, vec![]).contains("out of range"));
    // The offset of the memo points past the end of the row
    let mut past = row.clone();
    past[5] = 200;
    assert!(refused(8, past).contains("out of range"));
    // The header claims a fixed part larger than the row
    let mut header = row.clone();
    header[0] = 200;
    assert!(refused(9, header).contains("out of range"));

    Ok(())
}

#[psibase::test_case(packages("TestContract2"))]
fn test_add_events(chain: psibase::Chain) -> Result<(), psibase::Error> {
    use psibase::services::http_server;
    use psibase::Push;
    use serde_json::{json, Value};

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
    use psibase::Push;
    use serde_json::{json, Value};

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
