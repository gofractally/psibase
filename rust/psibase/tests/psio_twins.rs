//! The types psibase declares in both C++ and Rust agree.
//!
//! `libraries/psibase/common/tests/rust-twins.json` is written from the C++
//! declarations (`rust_twins.cpp` beside it, which fails when the file is
//! not current): the Schema IR of each type and sample values in pSSZ, key
//! and I-JSON form. Here the Rust declaration of each type must
//!
//! * have the same schema node, with every reference resolved;
//! * read each value's pSSZ bytes and write the same bytes back;
//! * write the same key, and read it, where the Rust type is a key;
//! * write the same I-JSON text, and read it, where the Rust type has text.
//!
//!
//! Every type in the fixture must be checked, so a type added in C++ fails
//! here until Rust declares it.
#![allow(non_upper_case_globals)]

use psibase::services::tokens::{Decimal, Precision, Quantity};
use psibase::*;
use psio::pssz::schema_ir::{self, schema_for, AnyType, AnyValue as V, ToPsszSchema};
use std::collections::BTreeSet;

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{:02x}", b)).collect()
}

fn unhex(text: &str) -> Vec<u8> {
    (0..text.len())
        .step_by(2)
        .map(|i| u8::from_str_radix(&text[i..i + 2], 16).unwrap())
        .collect()
}

struct Vector {
    pssz: Vec<u8>,
    key: Vec<u8>,
    ijson: String,
}

struct Fixture {
    schema: schema_ir::Schema,
    vectors: Vec<(String, Vector)>,
    checked: BTreeSet<String>,
    /// (interface, method, the pSSZ of the arguments of a sample call).
    calls: Vec<(String, String, Vec<u8>)>,
}

impl Fixture {
    fn load() -> Self {
        let path = concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../../libraries/psibase/common/tests/rust-twins.json"
        );
        let text = std::fs::read_to_string(path).unwrap();
        let json: serde_json::Value = serde_json::from_str(&text).unwrap();
        let schema = psio::from_pssz(&unhex(json["schema_ir"].as_str().unwrap())).unwrap();
        let vectors = json["vectors"]
            .as_array()
            .unwrap()
            .iter()
            .map(|v| {
                (
                    v["type"].as_str().unwrap().to_string(),
                    Vector {
                        pssz: unhex(v["pssz"].as_str().unwrap()),
                        key: unhex(v["key"].as_str().unwrap()),
                        ijson: v["ijson"].as_str().unwrap().to_string(),
                    },
                )
            })
            .collect();
        let calls = json["calls"]
            .as_array()
            .unwrap()
            .iter()
            .map(|c| {
                (
                    c["interface"].as_str().unwrap().to_string(),
                    c["method"].as_str().unwrap().to_string(),
                    unhex(c["pssz"].as_str().unwrap()),
                )
            })
            .collect();
        Fixture {
            schema,
            vectors,
            checked: BTreeSet::new(),
            calls,
        }
    }

    fn vectors<'a>(&'a self, name: &'a str) -> impl Iterator<Item = &'a Vector> {
        let found: Vec<&Vector> = self
            .vectors
            .iter()
            .filter(move |(ty, _)| ty == name)
            .map(|(_, v)| v)
            .collect();
        assert!(!found.is_empty(), "{name} has no vectors");
        found.into_iter()
    }
}

/// The differences between two declarations that leave every byte, key
/// and text the same and are known and listed (each is a decision or a gap
/// recorded in doc/pssz-conversion.md):
///
/// * a string member: C++ `std::string` is raw bytes
///   (`Custom{List<u8>, "string"}`), a Rust `String` is UTF-8
///   (`Custom{List<u8>, "utf8"}`);
/// * a byte sequence: C++ `std::vector<char>` is hex over the element
///   `Custom{u8, "char"}`, a Rust `Vec<u8>` hex over `u8`.
#[derive(Clone, Copy, PartialEq, Debug)]
struct Reading {
    /// A raw string reads as a UTF-8 one.
    raw_as_utf8: bool,
    /// A `char` reads as the `u8` it is.
    char_as_u8: bool,
}

/// The two schemas are equal as they stand.
const Same: Reading = Reading { raw_as_utf8: false, char_as_u8: false };
/// C++ declares the type's strings raw and Rust UTF-8; nothing else differs.
const RawInCpp: Reading = Reading { raw_as_utf8: true, char_as_u8: false };
/// C++ declares the type's byte sequences over `char`; nothing else differs.
const CharInCpp: Reading = Reading { raw_as_utf8: false, char_as_u8: true };
/// Both.
const RawAndCharInCpp: Reading = Reading { raw_as_utf8: true, char_as_u8: true };

/// A node with every reference replaced by what it refers to, read as
/// `reading` says.
fn resolved(schema: &schema_ir::Schema, ty: &AnyType, reading: Reading) -> AnyType {
    let go = |ty: &AnyType| Box::new(resolved(schema, ty, reading));
    let members = |members: &Vec<schema_ir::Member>| {
        members
            .iter()
            .map(|m| schema_ir::Member {
                name: m.name.clone(),
                r#type: go(&m.r#type),
                attributes: m.attributes.clone(),
            })
            .collect()
    };
    AnyType::new(match &ty.value {
        V::Type(reference) => {
            return resolved(
                schema,
                schema.get(&reference.r#type).expect("a known type"),
                reading,
            )
        }
        V::Object(o) => V::Object(schema_ir::Object {
            members: members(&o.members),
            attributes: o.attributes.clone(),
        }),
        V::Struct(o) => V::Struct(schema_ir::Struct {
            members: members(&o.members),
            attributes: o.attributes.clone(),
        }),
        V::Variant(o) => V::Variant(schema_ir::Variant {
            members: members(&o.members),
            attributes: o.attributes.clone(),
        }),
        V::List(l) => V::List(schema_ir::List {
            r#type: go(&l.r#type),
        }),
        V::BoundedList(l) => V::BoundedList(schema_ir::BoundedList {
            r#type: go(&l.r#type),
            maxCount: l.maxCount,
        }),
        V::Array(a) => V::Array(schema_ir::Array {
            r#type: go(&a.r#type),
            len: a.len,
        }),
        V::Option(o) => V::Option(schema_ir::Optional {
            r#type: go(&o.r#type),
        }),
        V::Custom(c) if reading.char_as_u8 && c.id == "char" => {
            return resolved(schema, &c.r#type, reading)
        }
        // TEMPORARY, until the C++ flip branch is merged: there `Action` and
        // `ServiceMethod` carry these custom ids (PSIO_INVARIANT in
        // block.hpp / nativeTables.hpp); the C++ of this tree does not yet,
        // so the id is read through on both sides. Remove with the merge.
        V::Custom(c) if c.id == "Action" || c.id == "ServiceMethod" => {
            return resolved(schema, &c.r#type, reading)
        }
        V::Custom(c) => V::Custom(schema_ir::Custom {
            r#type: go(&c.r#type),
            id: if reading.raw_as_utf8 && c.id == "string" {
                "utf8".to_string()
            } else {
                c.id.clone()
            },
        }),
        V::Tuple(t) => V::Tuple(schema_ir::Tuple {
            members: t.members.iter().map(|m| go(m)).collect(),
        }),
        other => other.clone(),
    })
}

/// The Rust type `T` and the C++ type the fixture calls `name` have one
/// schema and one pSSZ encoding.
fn same_schema_and_bytes<T>(fixture: &mut Fixture, name: &str, reading: Reading)
where
    T: ToPsszSchema
        + psio::pssz::PsszPack<psio::Pssz>
        + psio::pssz::PsszUnpack<psio::Pssz>
        + psio::pssz::PsszValidate<psio::Pssz>,
{
    fixture.checked.insert(name.to_string());

    let (ours, root) = schema_for::<T>().unwrap();
    let theirs = fixture
        .schema
        .get(name)
        .unwrap_or_else(|| panic!("{name} is not in the fixture's schema"));
    let equal_under = |reading: Reading| {
        resolved(&ours, &root, reading) == resolved(&fixture.schema, theirs, reading)
    };
    assert_eq!(
        resolved(&ours, &root, reading),
        resolved(&fixture.schema, theirs, reading),
        "{name}: schema, read as {reading:?}"
    );
    // Each difference a type is listed with is one it has: the list is
    // exact, and a type leaves it when either declaration changes.
    if reading.raw_as_utf8 {
        assert!(
            !equal_under(Reading { raw_as_utf8: false, ..reading }),
            "{name}: its strings are declared alike now"
        );
    }
    if reading.char_as_u8 {
        assert!(
            !equal_under(Reading { char_as_u8: false, ..reading }),
            "{name}: its byte sequences are declared alike now"
        );
    }

    for vector in fixture.vectors(name) {
        psio::validate_pssz::<T>(&vector.pssz)
            .unwrap_or_else(|e| panic!("{name}: {} is rejected: {e:?}", hex(&vector.pssz)));
        let value = psio::from_pssz::<T>(&vector.pssz).unwrap();
        assert_eq!(
            hex(&psio::to_pssz(&value)),
            hex(&vector.pssz),
            "{name}: pSSZ"
        );
    }
}

/// Also the same key.
fn same_key<T>(fixture: &Fixture, name: &str)
where
    T: psio::pssz::PsszPack<psio::Pssz>
        + psio::pssz::PsszUnpack<psio::Pssz>
        + psio::key::KeyPack
        + psio::key::KeyUnpack,
{
    for vector in fixture.vectors(name) {
        let value = psio::from_pssz::<T>(&vector.pssz).unwrap();
        assert_eq!(hex(&psio::to_key(&value)), hex(&vector.key), "{name}: key");
        let back = psio::from_key::<T>(&vector.key).unwrap();
        assert_eq!(
            hex(&psio::to_pssz(&back)),
            hex(&vector.pssz),
            "{name}: key read"
        );
    }
}

/// Also the same I-JSON text.
fn same_text<T>(fixture: &Fixture, name: &str)
where
    T: psio::pssz::PsszPack<psio::Pssz> + psio::pssz::PsszUnpack<psio::Pssz> + psio::json::JsonText,
{
    for vector in fixture.vectors(name) {
        let value = psio::from_pssz::<T>(&vector.pssz).unwrap();
        assert_eq!(psio::to_ijson(&value), vector.ijson, "{name}: I-JSON");
        let back = psio::from_ijson::<T>(&vector.ijson).unwrap();
        assert_eq!(
            hex(&psio::to_pssz(&back)),
            hex(&vector.pssz),
            "{name}: I-JSON read"
        );
    }
}

#[test]
fn rust_and_cpp_declare_the_same_types() {
    let mut f = Fixture::load();

    // Names (slice R1).
    same_schema_and_bytes::<AccountNumber>(&mut f, "AccountNumber", Same);
    same_key::<AccountNumber>(&f, "AccountNumber");
    same_text::<AccountNumber>(&f, "AccountNumber");
    same_schema_and_bytes::<MethodNumber>(&mut f, "MethodNumber", Same);
    same_key::<MethodNumber>(&f, "MethodNumber");
    same_text::<MethodNumber>(&f, "MethodNumber");

    // Wrappers and token amounts (slice R2). A memo is a UTF-8 string of at
    // most 80 bytes in both languages, declared as a bound.
    same_schema_and_bytes::<Memo>(&mut f, "Memo", Same);
    same_text::<Memo>(&f, "Memo");
    same_schema_and_bytes::<Precision>(&mut f, "Precision", Same);
    same_key::<Precision>(&f, "Precision");
    same_text::<Precision>(&f, "Precision");
    same_schema_and_bytes::<Quantity>(&mut f, "Quantity", Same);
    same_key::<Quantity>(&f, "Quantity");
    same_text::<Quantity>(&f, "Quantity");
    same_schema_and_bytes::<Decimal>(&mut f, "Decimal", Same);
    same_key::<Decimal>(&f, "Decimal");
    same_text::<Decimal>(&f, "Decimal");

    // Core records (slice R3).
    same_schema_and_bytes::<BlockHeaderCode>(&mut f, "BlockHeaderCode", Same);
    same_key::<BlockHeaderCode>(&f, "BlockHeaderCode");
    same_schema_and_bytes::<HttpHeader>(&mut f, "HttpHeader", RawInCpp);
    same_key::<HttpHeader>(&f, "HttpHeader");
    same_schema_and_bytes::<VMOptions>(&mut f, "VMOptions", Same);
    same_schema_and_bytes::<WasmConfigRow>(&mut f, "WasmConfigRow", Same);
    same_schema_and_bytes::<ConsensusChangeRow>(&mut f, "ConsensusChangeRow", Same);
    same_schema_and_bytes::<ScheduledSnapshotRow>(&mut f, "ScheduledSnapshotRow", Same);
    same_schema_and_bytes::<LogTruncateRow>(&mut f, "LogTruncateRow", Same);
    same_schema_and_bytes::<IPV4Address>(&mut f, "IPV4Address", Same);
    same_schema_and_bytes::<IPV6Address>(&mut f, "IPV6Address", Same);
    same_schema_and_bytes::<IPV4Endpoint>(&mut f, "IPV4Endpoint", Same);
    same_schema_and_bytes::<IPV6Endpoint>(&mut f, "IPV6Endpoint", Same);
    same_schema_and_bytes::<LocalEndpoint>(&mut f, "LocalEndpoint", Same);
    same_schema_and_bytes::<TLSInfo>(&mut f, "TLSInfo", Same);
    same_schema_and_bytes::<ServiceMethod>(&mut f, "ServiceMethod", Same);
    same_key::<ServiceMethod>(&f, "ServiceMethod");
    same_schema_and_bytes::<EnvRow>(&mut f, "EnvRow", Same);
    same_schema_and_bytes::<HostConfigRow>(&mut f, "HostConfigRow", RawInCpp);
    same_schema_and_bytes::<PendingShutdownRow>(&mut f, "PendingShutdownRow", RawInCpp);
    same_schema_and_bytes::<PackageRef>(&mut f, "PackageRef", RawInCpp);
    same_schema_and_bytes::<PackageExport>(&mut f, "PackageExport", RawInCpp);
    same_schema_and_bytes::<ConsoleTrace>(&mut f, "ConsoleTrace", Same);

    // Byte sequences behind `Hex<T>`, and the records that hold them.
    same_schema_and_bytes::<Checksum256>(&mut f, "Checksum256", Same);
    same_key::<Checksum256>(&f, "Checksum256");
    same_text::<Checksum256>(&f, "Checksum256");
    same_schema_and_bytes::<Hex<Vec<u8>>>(&mut f, "Bytes", Same);
    same_key::<Hex<Vec<u8>>>(&f, "Bytes");
    same_text::<Hex<Vec<u8>>>(&f, "Bytes");
    same_schema_and_bytes::<Hex<Vec<u8>>>(&mut f, "Octets", Same);
    same_key::<Hex<Vec<u8>>>(&f, "Octets");
    same_text::<Hex<Vec<u8>>>(&f, "Octets");
    same_schema_and_bytes::<Action>(&mut f, "Action", Same);
    same_key::<Action>(&f, "Action");
    same_schema_and_bytes::<GenesisService>(&mut f, "GenesisService", Same);
    same_key::<GenesisService>(&f, "GenesisService");
    same_schema_and_bytes::<GenesisActionData>(&mut f, "GenesisActionData", RawInCpp);
    same_key::<GenesisActionData>(&f, "GenesisActionData");
    same_schema_and_bytes::<Claim>(&mut f, "Claim", Same);
    same_key::<Claim>(&f, "Claim");
    same_schema_and_bytes::<Producer>(&mut f, "Producer", Same);
    same_key::<Producer>(&f, "Producer");
    same_schema_and_bytes::<CftConsensus>(&mut f, "CftConsensus", Same);
    same_schema_and_bytes::<BftConsensus>(&mut f, "BftConsensus", Same);
    same_schema_and_bytes::<BlockHeaderAuthAccount>(&mut f, "BlockHeaderAuthAccount", Same);
    same_key::<BlockHeaderAuthAccount>(&f, "BlockHeaderAuthAccount");
    same_schema_and_bytes::<HttpRequest>(&mut f, "HttpRequest", RawInCpp);
    same_schema_and_bytes::<HttpReply>(&mut f, "HttpReply", RawInCpp);
    same_schema_and_bytes::<CodeRow>(&mut f, "CodeRow", Same);
    same_schema_and_bytes::<CodeByHashRow>(&mut f, "CodeByHashRow", Same);
    same_schema_and_bytes::<BlockDataRow>(&mut f, "BlockDataRow", Same);
    same_schema_and_bytes::<StateChecksum>(&mut f, "StateChecksum", Same);
    same_schema_and_bytes::<StateSignature>(&mut f, "StateSignature", Same);
    same_schema_and_bytes::<SnapshotStateItem>(&mut f, "SnapshotStateItem", Same);
    same_schema_and_bytes::<SnapshotRow>(&mut f, "SnapshotRow", Same);

    // Rows whose Rust declaration had fallen behind the C++ one.
    same_schema_and_bytes::<ConfigRow>(&mut f, "ConfigRow", Same);
    same_schema_and_bytes::<LogMessage>(&mut f, "LogMessage", RawInCpp);
    same_schema_and_bytes::<NotifyRow>(&mut f, "NotifyRow", Same);
    same_schema_and_bytes::<RunMode>(&mut f, "RunMode", Same);
    same_key::<RunMode>(&f, "RunMode");
    same_text::<RunMode>(&f, "RunMode");

    // Records of services implemented in Rust, mirrored in C++ headers.
    same_schema_and_bytes::<services::staged_tx::service::Response>(&mut f, "Response", Same);

    let in_fixture: BTreeSet<String> = f.vectors.iter().map(|(ty, _)| ty.clone()).collect();
    assert_eq!(
        f.checked, in_fixture,
        "every type of the fixture is checked"
    );
}

// ── Services ────────────────────────────────────────────────────────────────

use psio::interface::{Interface, Method};

/// The interface the service macro declares for a Rust service
/// (`#[psibase::service(psio = true)]`: `psio_actions::Tag`) and the one C++
/// declares for the same service (`PSIO_REFLECT(Svc, method(...))` +
/// `PSIO_INTERFACE`) have the same functions: names, parameter names in
/// order, parameter and result types, attributes. The order of the
/// functions is not compared (an action is found by its method number).
fn same_interface<I: Interface>(fixture: &Fixture, reading: Reading) {
    let mut builder = schema_ir::SchemaBuilder::new();
    builder.insert_interface::<I>().unwrap();
    let ours_schema = builder.finish();
    let ours = &ours_schema.interfaces[0];
    let name = I::NAME;
    let theirs = fixture
        .schema
        .interfaces
        .iter()
        .find(|interface| interface.name == name)
        .unwrap_or_else(|| panic!("{name} is not an interface of the fixture"));

    let names = |interface: &schema_ir::Interface| -> BTreeSet<String> {
        interface.funcs.iter().map(|func| func.name.clone()).collect()
    };
    assert_eq!(names(ours), names(theirs), "{name}: functions");
    assert_eq!(ours.funcs.len(), theirs.funcs.len(), "{name}: a function is listed twice");
    let mut differs = false;
    for theirs in &theirs.funcs {
        let ours = ours.funcs.iter().find(|func| func.name == theirs.name).unwrap();
        let at = format!("{name}::{}", theirs.name);
        let param_names = |func: &schema_ir::Func| -> Vec<String> {
            func.params.iter().map(|param| param.name.clone()).collect()
        };
        assert_eq!(param_names(ours), param_names(theirs), "{at}: parameter names");
        for (ours_param, theirs_param) in ours.params.iter().zip(&theirs.params) {
            assert_eq!(
                resolved(&ours_schema, &ours_param.r#type, reading),
                resolved(&fixture.schema, &theirs_param.r#type, reading),
                "{at}: type of {}",
                theirs_param.name
            );
            assert_eq!(ours_param.attributes, theirs_param.attributes, "{at}: {}", theirs_param.name);
            differs |= resolved(&ours_schema, &ours_param.r#type, Same)
                != resolved(&fixture.schema, &theirs_param.r#type, Same);
        }
        assert_eq!(ours.result.is_some(), theirs.result.is_some(), "{at}: has a result");
        if let (Some(ours_result), Some(theirs_result)) = (&ours.result, &theirs.result) {
            assert_eq!(
                resolved(&ours_schema, ours_result, reading),
                resolved(&fixture.schema, theirs_result, reading),
                "{at}: result"
            );
            differs |= resolved(&ours_schema, ours_result, Same)
                != resolved(&fixture.schema, theirs_result, Same);
        }
        assert_eq!(ours.attributes, theirs.attributes, "{at}: attributes");
    }
    assert_eq!(differs, reading != Same, "{name}: the listed differences are exact");

    // The method metadata says what the schema says.
    for (index, method) in I::METHODS.iter().enumerate() {
        let func = &ours.funcs[index];
        assert_eq!(method.name, func.name);
        assert_eq!(method.params.len(), func.params.len());
        assert_eq!(method.has_result, func.result.is_some());
    }
}

/// The argument record of an action reads the arguments C++ packs for a
/// call of it (the tuple of the method's parameters) and writes the same
/// bytes.
fn same_arguments<M>(fixture: &Fixture, checked: &mut BTreeSet<(String, String)>)
where
    M: Method + psio::pssz::PsszValidate<psio::Pssz>,
{
    let interface = <M::Interface as Interface>::NAME;
    let mut found = false;
    for (_, method, bytes) in fixture
        .calls
        .iter()
        .filter(|(i, m, _)| i == interface && m == M::NAME)
    {
        found = true;
        psio::validate_pssz::<M>(bytes)
            .unwrap_or_else(|e| panic!("{interface}::{method}: {} is rejected: {e:?}", hex(bytes)));
        let args = psio::from_pssz::<M>(bytes).unwrap();
        assert_eq!(hex(&psio::to_pssz(&args)), hex(bytes), "{interface}::{method}: arguments");
        // The record is the tuple of its parameters.
        let tuple = psio::from_pssz::<M::Tuple>(bytes).unwrap();
        assert_eq!(hex(&psio::to_pssz(&tuple)), hex(bytes), "{interface}::{method}: tuple");
    }
    assert!(found, "{interface}::{} has no call in the fixture", M::NAME);
    checked.insert((interface.to_string(), M::NAME.to_string()));
}

#[test]
fn rust_and_cpp_declare_the_same_services() {
    use psibase::services::{auth_delegate, setcode};
    let f = Fixture::load();

    same_interface::<setcode::psio_actions::Tag>(&f, Same);
    same_interface::<auth_delegate::psio_actions::Tag>(&f, Same);

    let mut checked = BTreeSet::new();
    macro_rules! arguments {
        ($service:ident: $($method:ident),*) => {
            $(same_arguments::<$service::psio_actions::args::$method>(&f, &mut checked);)*
        };
    }
    arguments!(setcode: init, setCode, stageCode, unstageCode, setCodeStaged, setFlags, verifySeq,
               defaultVmVersion, setDefaultVmVersion);
    arguments!(auth_delegate: checkAuthSys, canAuthUserSys, getDlgsSys, isAuthSys, isRejectSys,
               setOwner, newAccount, getOwner, checkOwner);
    let in_fixture: BTreeSet<(String, String)> = f
        .calls
        .iter()
        .map(|(interface, method, _)| (interface.clone(), method.clone()))
        .collect();
    assert_eq!(checked, in_fixture, "every call of the fixture is checked");
}

// ── Parameter names ─────────────────────────────────────────────────────────

/// The actions of a Rust view with the names of their parameters, from the
/// schema the service macro generates for it.
fn view_names<W: psibase::ToServiceSchema>() -> std::collections::BTreeMap<String, Vec<String>> {
    use psio::pssz::schema_ir::AnyValue as T;
    let schema = W::schema();
    let mut out = std::collections::BTreeMap::new();
    for (name, function) in &schema.actions {
        let params = schema.types.resolve(&function.params).expect("a known type");
        let names = match &params.value {
            T::Object(record) => record.members.iter().map(|m| m.name.clone()).collect(),
            T::Struct(record) => record.members.iter().map(|m| m.name.clone()).collect(),
            other => panic!("{}: unexpected parameter node {other:?}", name),
        };
        out.insert(name.clone(), names);
    }
    out
}

/// A parameter of an action has one name in both languages: it is the name
/// of the argument in JSON. The authority is the implementation (C++ for
/// the first group of the fixture, the Rust service for the second, whose
/// C++ header carries the Rust names); the views in `psibase::services` are
/// mirrors. The differences that remain are listed here, each with its
/// reason; anything else fails.
#[test]
fn rust_views_name_parameters_as_the_implementation_does() {
    use psibase::services::*;
    let path = concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../libraries/psibase/common/tests/rust-twins.json"
    );
    let json: serde_json::Value =
        serde_json::from_str(&std::fs::read_to_string(path).unwrap()).unwrap();

    // (service, method) -> why the names differ.
    let known: std::collections::BTreeMap<(&str, &str), &str> = [
        // `type` is a Rust keyword; the view says `type_`.
        (("transact", "addCallback"), "keyword"),
        (("transact", "removeCallback"), "keyword"),
        // The C++ reflection misnames or does not name a parameter
        // (doc/pssz-conversion.md 6.22); the view has the declared name.
        (("packages", "setSchema"), "C++ reflection"),
        (("packages", "getSchema"), "C++ reflection"),
        (("x-admin", "isAdmin"), "C++ reflection"),
        (("x-packages", "serveSys"), "C++ reflection"),
    ]
    .into_iter()
    .collect();

    let mut views: std::collections::BTreeMap<&str, std::collections::BTreeMap<String, Vec<String>>> =
        Default::default();
    macro_rules! view {
        ($($account:literal => $module:ident),* $(,)?) => {
            $(views.insert($account, view_names::<$module::Wrapper>());)*
        };
    }
    view! {
        "accounts" => accounts, "auth-any" => auth_any, "auth-delg" => auth_delegate,
        "auth-none" => auth_none, "auth-sig" => auth_sig, "cpu-limit" => cpu_limit, "db" => db,
        "dyn-ld" => dyn_ld, "http" => http_server, "packages" => packages,
        "producers" => producers, "setcode" => setcode, "sites" => sites, "transact" => transact,
        "verify-sig" => verify_sig, "x-admin" => x_admin, "x-db" => x_db, "x-http" => x_http,
        "x-keys" => x_keys, "x-packages" => x_packages, "x-sites" => x_sites,
        "credential" => credentials, "nft" => nft, "staged-tx" => staged_tx, "symbol" => symbol,
        "tokens" => tokens, "vserver" => virtual_server, "wsauth" => ws_auth,
    }

    let mut problems = Vec::new();
    let mut seen_known = BTreeSet::new();
    let mut compared = 0;
    for service in json["names"].as_array().unwrap() {
        let account = service["service"].as_str().unwrap();
        let view = views
            .get(account)
            .unwrap_or_else(|| panic!("{account} has no view in this test"));
        let methods = service["methods"].as_object().unwrap();
        for (method, params) in methods {
            let theirs: Vec<String> = params
                .as_array()
                .unwrap()
                .iter()
                .map(|p| p.as_str().unwrap().to_string())
                .collect();
            let Some(ours) = view.get(method) else { continue };
            compared += 1;
            if *ours != theirs {
                if known.contains_key(&(account, method.as_str())) {
                    seen_known.insert((account, method.clone()));
                } else {
                    problems.push(format!("{account}::{method}: view {ours:?}, C++ {theirs:?}"));
                }
            }
        }
        for method in view.keys() {
            if !methods.contains_key(method) {
                problems.push(format!("{account}::{method}: in the view, not in C++"));
            }
        }
    }
    assert!(problems.is_empty(), "{}", problems.join("\n"));
    assert_eq!(seen_known.len(), known.len(), "a listed difference is gone: {seen_known:?}");
    assert_eq!(json["names"].as_array().unwrap().len(), views.len());
    assert!(compared >= 265, "{compared} methods compared");
}
