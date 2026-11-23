//! The `ServiceSchema` record against the sample of the interop
//! specification (`doc/flip-interop.md` section 2 of the C++ flip branch):
//! a service with `credit(to, amount, memo)`, `getRow(AccountNumber)` with an
//! unnamed parameter, `init()` and one table, as C++ `psio::to_ijson` writes
//! its schema. `tests/service-schema-sample.json` is that text.

#![allow(non_snake_case)]

use psibase::{AccountNumber, ServiceSchema, ToServiceSchema};
use psio::pssz::dynamic::{self, Compare};

const SAMPLE: &str = include_str!("service-schema-sample.json");

#[psibase::service_tables]
mod tables {
    use psibase::AccountNumber;

    #[table(name = "RowTable", index = 0)]
    #[derive(
        Debug, Clone, psio::PsszPack, psio::PsszUnpack, psio::ToPsszSchema, psio::JsonText,
    )]
    pub struct Row {
        #[primary_key]
        pub owner: AccountNumber,
        pub n: u64,
    }
}

/// The sample's declaration in Rust. (`getRow`'s parameter has a name
/// here: a Rust action always names its parameters.)
#[psibase::service(name = "svc", dispatch = false, tables = "tables")]
#[allow(unused_variables)]
mod service {
    use crate::tables::Row;
    use psibase::AccountNumber;
    use psio::pssz::RawString;

    #[action]
    fn credit(to: AccountNumber, amount: u64, memo: Option<RawString>) {
        unimplemented!()
    }
    #[action]
    fn getRow(account: AccountNumber) -> Option<Row> {
        unimplemented!()
    }
    #[action]
    fn init() {
        unimplemented!()
    }
}

fn sample() -> ServiceSchema {
    psio::from_ijson::<ServiceSchema>(SAMPLE).expect("the sample is a ServiceSchema")
}

/// The record's own layout is the specification's: Rust reads the text C++
/// wrote, writes the same text, and packs it to the same 1336 bytes.
#[test]
fn the_record_reads_and_writes_the_cpp_sample() {
    let schema = sample();
    assert_eq!(schema.service, "svc".parse::<AccountNumber>().unwrap());
    assert_eq!(psio::to_ijson(&schema), SAMPLE);
    let bytes = psio::to_pssz(&schema);
    assert_eq!(bytes.len(), 1336);
    psio::validate_pssz::<ServiceSchema>(&bytes).unwrap();
    assert_eq!(psio::from_pssz::<ServiceSchema>(&bytes).unwrap(), schema);
    // serde (the CLI reads schema files and HTTP replies with it) is the
    // same text.
    let through_serde: ServiceSchema = serde_json::from_str(SAMPLE).unwrap();
    assert_eq!(through_serde, schema);
    assert_eq!(serde_json::to_string(&schema).unwrap(), SAMPLE);
}

/// The schema the service macro builds for the same declaration is
/// equivalent to the C++ one, action by action and for the table.
#[test]
fn the_rust_built_schema_is_equivalent_to_the_cpp_sample() {
    let ours = service::Wrapper::schema();
    let theirs = sample();
    assert_eq!(ours.service, theirs.service);
    assert_eq!(
        ours.actions.keys().collect::<Vec<_>>(),
        theirs.actions.keys().collect::<Vec<_>>()
    );
    let contract = |what: &str, a: &psio::pssz::schema_ir::AnyType, b: &psio::pssz::schema_ir::AnyType| {
        let result = dynamic::equivalent(&ours.types, a, &theirs.types, b, Compare::Contract);
        assert!(result.ok, "{what}: {} at {}", result.reason, result.path);
    };
    for name in ["credit", "init"] {
        contract(name, &ours.actions[name].params, &theirs.actions[name].params);
        assert_eq!(ours.actions[name].result.is_some(), theirs.actions[name].result.is_some());
    }
    // `getRow`: C++ leaves the parameter unnamed (positional "0"), Rust
    // names it; the bytes are the same.
    let wire = dynamic::equivalent(
        &ours.types,
        &ours.actions["getRow"].params,
        &theirs.types,
        &theirs.actions["getRow"].params,
        Compare::Wire,
    );
    assert!(wire.ok, "getRow: {} at {}", wire.reason, wire.path);
    contract(
        "getRow result",
        ours.actions["getRow"].result.as_ref().unwrap(),
        theirs.actions["getRow"].result.as_ref().unwrap(),
    );
    assert!(ours.history.is_empty() && ours.merkle.is_empty());
    let ours_table = &ours.database.as_ref().unwrap()["service"][0];
    let theirs_table = &theirs.database.as_ref().unwrap()["service"][0];
    assert_eq!(ours_table.name, theirs_table.name);
    assert_eq!(ours_table.table, theirs_table.table);
    assert_eq!(ours_table.indexes, theirs_table.indexes);
    contract("Row", &ours_table.r#type, &theirs_table.r#type);

    // A Rust-built schema is a value of the record in both encodings.
    let text = psio::to_ijson(&ours);
    assert_eq!(psio::from_ijson::<ServiceSchema>(&text).unwrap(), ours);
    assert_eq!(psio::from_pssz::<ServiceSchema>(&psio::to_pssz(&ours)).unwrap(), ours);
}

/// The bytes of an action's arguments: the typed argument record, the
/// tuple of the parameters, and the schema-driven codec over the C++
/// schema all give the same.
#[test]
fn argument_values_have_one_encoding() {
    use psio::pssz::RawString;
    let theirs = sample();
    let bob: AccountNumber = "bob".parse().unwrap();
    let typed = psio::to_pssz(&service::action_structs::credit { to: bob, amount: 5, memo: None });
    assert_eq!(typed, psio::to_pssz(&(bob, 5u64, None::<RawString>)));
    let handlers = psibase::schema_handlers();
    let by_cpp_schema = dynamic::json_to_pssz_with::<psio::IJson>(
        &theirs.types,
        &theirs.actions["credit"].params,
        br#"{"to":"bob","amount":5}"#,
        &handlers,
    )
    .unwrap();
    assert_eq!(typed, by_cpp_schema);
    let with_memo = psio::to_pssz(&service::action_structs::credit {
        to: bob,
        amount: 5,
        memo: Some(RawString::from(b"hi".to_vec())),
    });
    let (text, _) = dynamic::pssz_to_json_with::<psio::IJson>(
        &theirs.types,
        &theirs.actions["credit"].params,
        &with_memo,
        &handlers,
    )
    .unwrap();
    assert_eq!(text, r#"{"to":"bob","amount":5,"memo":"hi"}"#);
    assert_eq!(psio::to_pssz(&service::action_structs::init {}), psio::to_pssz(&()));
}

/// The dispatcher reads the current action through a view: the method and
/// the argument bytes of a packed `Action`.
#[test]
fn an_action_view_gives_the_method_and_the_argument_bytes() {
    use psibase::{Action, ActionPsszAccessors as _, MethodNumber, MethodNumberPsszAccessors as _};
    let action = Action {
        sender: "alice".parse().unwrap(),
        service: "svc".parse().unwrap(),
        method: MethodNumber::from("credit"),
        rawData: vec![1u8, 2, 3, 0, 255].into(),
    };
    let bytes = psio::to_pssz(&action);
    let view = psio::PsszView::<Action>::new(&bytes).unwrap();
    assert_eq!(view.method().value().get(), action.method.value);
    assert_eq!(view.rawData().bytes(), &action.rawData[..]);
    let empty = Action { rawData: Vec::new().into(), ..action };
    let bytes = psio::to_pssz(&empty);
    let view = psio::PsszView::<Action>::new(&bytes).unwrap();
    assert!(view.rawData().bytes().is_empty());
}

/// A service whose results are annotated, as C++ `TestService::TestResult`
/// declares them (`method(symbol, token, returns(utf8 | max<8>))`,
/// `method(names, count, returns(max<4> | element(utf8 | max<16>)))`).
mod annotated {
    #[psibase::service(name = "test-res", dispatch = false)]
    #[allow(non_snake_case, unused_variables)]
    pub mod service {
        #[action]
        #[psio(returns(max = 8))]
        fn symbol(token: u32) -> String {
            unimplemented!()
        }
        #[action]
        #[psio(returns(max = 4, element(max = 16)))]
        fn names(count: u32) -> Vec<String> {
            unimplemented!()
        }
    }
}

/// `#[psio(returns(...))]` on an action types its result: in the schema of
/// the service, for the service that writes it (`set_method_retval`) and
/// for a caller that reads it (`Caller::call`, `ChainResult::get`), which
/// all go through the action's `Method` (gofractally/psibase#2235).
#[test]
fn an_annotated_result_is_in_the_schema_and_is_what_a_caller_reads() {
    use annotated::service::action_structs::{names, symbol};
    use psio::interface::Method;
    use psio::pssz::schema_ir::AnyValue;

    let schema = annotated::service::Wrapper::schema();
    let resolve = |ty: &psio::pssz::schema_ir::AnyType| schema.types.resolve(ty).unwrap().value.clone();
    // UTF-8 of at most `max` bytes: the node C++ builds for
    // returns(utf8 | max<N>) (packages/psibase_tests/test/test_result.cpp).
    let utf8_max = |ty: &psio::pssz::schema_ir::AnyType| -> u64 {
        let AnyValue::Custom(custom) = resolve(ty) else { panic!("a custom type") };
        assert_eq!(custom.id, "utf8");
        let AnyValue::BoundedList(bytes) = resolve(&custom.r#type) else { panic!("a bounded list") };
        assert!(matches!(resolve(&bytes.r#type), AnyValue::Int(int) if int.bits == 8 && !int.isSigned));
        bytes.maxCount as u64
    };
    assert_eq!(utf8_max(schema.actions["symbol"].result.as_ref().unwrap()), 8);
    let AnyValue::BoundedList(list) = resolve(schema.actions["names"].result.as_ref().unwrap()) else {
        panic!("the result of names is a bounded list")
    };
    assert_eq!(list.maxCount, 4);
    assert_eq!(utf8_max(&list.r#type), 16);

    // The service: a value outside returns(...) has no encoding.
    assert_eq!(symbol::result_to_pssz(&"USD".to_string()).unwrap(), b"USD");
    assert!(symbol::result_to_pssz(&"123456789".to_string()).is_err());
    let two = vec!["alice".to_string(), "alice".to_string()];
    // One-byte offsets, where the plain list has four.
    assert_eq!(names::result_to_pssz(&two).unwrap().len(), 2 + 10);
    assert_eq!(psio::to_pssz(&two).len(), 2 * 4 + 10);
    assert!(names::result_to_pssz(&vec![String::new(); 5]).is_err());

    // The caller: what a callee that promises less may return is refused.
    assert_eq!(symbol::result_from_pssz(b"USD").unwrap(), "USD");
    assert!(symbol::result_from_pssz(b"123456789").is_err());
    assert!(symbol::result_from_pssz(b"ab\xff").is_err());
    assert_eq!(names::result_from_pssz(&names::result_to_pssz(&two).unwrap()).unwrap(), two);
    assert!(names::result_from_pssz(&psio::to_pssz(&two)).is_err());
}
