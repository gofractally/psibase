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
    /// `None` for a type that is never a key.
    key: Option<Vec<u8>>,
    ijson: String,
}

/// A transaction of the fixture: the packed `SignedTransaction`, its id and
/// its I-JSON.
struct TransactionVector {
    signed: Vec<u8>,
    id: Vec<u8>,
    ijson: String,
}

struct Fixture {
    schema: schema_ir::Schema,
    vectors: Vec<(String, Vector)>,
    checked: BTreeSet<String>,
    /// (interface, method, the pSSZ of the arguments of a sample call).
    calls: Vec<(String, String, Vec<u8>)>,
    transactions: Vec<(String, TransactionVector)>,
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
                        key: v["key"].as_str().map(unhex),
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
        let transactions = json["transactions"]
            .as_array()
            .unwrap()
            .iter()
            .map(|t| {
                (
                    t["name"].as_str().unwrap().to_string(),
                    TransactionVector {
                        signed: unhex(t["signed"].as_str().unwrap()),
                        id: unhex(t["id"].as_str().unwrap()),
                        ijson: t["ijson"].as_str().unwrap().to_string(),
                    },
                )
            })
            .collect();
        Fixture {
            schema,
            vectors,
            checked: BTreeSet::new(),
            calls,
            transactions,
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

/// A node with every reference replaced by what it refers to. A reference
/// to a type that is being resolved (a recursive type: the Schema IR's own
/// `AnyType`) stays a reference.
fn resolved(schema: &schema_ir::Schema, ty: &AnyType) -> AnyType {
    resolved_within(schema, ty, &mut Vec::new())
}

fn resolved_within(schema: &schema_ir::Schema, ty: &AnyType, open: &mut Vec<String>) -> AnyType {
    let mut go = |ty: &AnyType| Box::new(resolved_within(schema, ty, open));
    let mut members = |members: &Vec<schema_ir::Member>| {
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
            if open.contains(&reference.r#type) {
                return ty.clone();
            }
            open.push(reference.r#type.clone());
            let target = schema.get(&reference.r#type).expect("a known type");
            let result = resolved_within(schema, target, open);
            open.pop();
            return result;
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
        V::Custom(c) => V::Custom(schema_ir::Custom {
            r#type: go(&c.r#type),
            id: c.id.clone(),
        }),
        V::Tuple(t) => V::Tuple(schema_ir::Tuple {
            members: t.members.iter().map(|m| go(m)).collect(),
        }),
        other => other.clone(),
    })
}

/// The Rust type `T` and the C++ type the fixture calls `name` have one
/// schema and one pSSZ encoding.
fn same_schema_and_bytes<T>(fixture: &mut Fixture, name: &str)
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
    assert_eq!(resolved(&ours, &root), resolved(&fixture.schema, theirs), "{name}: schema");
    same_bytes::<T>(fixture, name);
}

/// The same for a recursive type: the Schema IR's own types, which a
/// `ServiceSchema` holds. A type that refers to itself through an anonymous
/// type does so by the builder's name for it (`@N`), which is not part of
/// the type and differs between the two builders, so the nodes are compared
/// with PSIO's `equivalent` under `Compare::Contract` (bytes, member names,
/// variant labels, custom ids) instead of node for node.
fn same_contract_and_bytes<T>(fixture: &mut Fixture, name: &str)
where
    T: ToPsszSchema
        + psio::pssz::PsszPack<psio::Pssz>
        + psio::pssz::PsszUnpack<psio::Pssz>
        + psio::pssz::PsszValidate<psio::Pssz>,
{
    use psio::pssz::dynamic::{equivalent, Compare};
    fixture.checked.insert(name.to_string());

    let (ours, root) = schema_for::<T>().unwrap();
    let theirs = fixture
        .schema
        .get(name)
        .unwrap_or_else(|| panic!("{name} is not in the fixture's schema"));
    let result = equivalent(&ours, &root, &fixture.schema, theirs, Compare::Contract);
    assert!(result.ok, "{name}: schema: {result:?}");
    same_bytes::<T>(fixture, name);
}

/// The Rust type reads each value of the fixture and writes the same bytes.
fn same_bytes<T>(fixture: &Fixture, name: &str)
where
    T: psio::pssz::PsszPack<psio::Pssz>
        + psio::pssz::PsszUnpack<psio::Pssz>
        + psio::pssz::PsszValidate<psio::Pssz>,
{
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
        let key = vector.key.as_ref().unwrap_or_else(|| panic!("{name} has no key in the fixture"));
        assert_eq!(hex(&psio::to_key(&value)), hex(key), "{name}: key");
        let back = psio::from_key::<T>(key).unwrap();
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

/// Also the same text through serde: what HTTP handlers, the CLI and
/// plugins write and read. (Only a PSIO type has PSIO's text there: a bare
/// `Vec<u8>` or `[u8; N]` handed to serde directly is serde's array.)
fn same_serde_text<T>(fixture: &Fixture, name: &str)
where
    T: psio::pssz::PsszPack<psio::Pssz>
        + psio::pssz::PsszUnpack<psio::Pssz>
        + serde::Serialize
        + serde::de::DeserializeOwned,
{
    for vector in fixture.vectors(name) {
        let value = psio::from_pssz::<T>(&vector.pssz).unwrap();
        assert_eq!(serde_json::to_string(&value).unwrap(), vector.ijson, "{name}: serde");
        let back = serde_json::from_str::<T>(&vector.ijson).unwrap();
        assert_eq!(
            hex(&psio::to_pssz(&back)),
            hex(&vector.pssz),
            "{name}: serde read"
        );
    }
}

#[test]
fn rust_and_cpp_declare_the_same_types() {
    let mut f = Fixture::load();

    // Names (slice R1).
    same_schema_and_bytes::<AccountNumber>(&mut f, "AccountNumber");
    same_key::<AccountNumber>(&f, "AccountNumber");
    same_text::<AccountNumber>(&f, "AccountNumber");
    same_serde_text::<AccountNumber>(&f, "AccountNumber");
    same_schema_and_bytes::<MethodNumber>(&mut f, "MethodNumber");
    same_key::<MethodNumber>(&f, "MethodNumber");
    same_text::<MethodNumber>(&f, "MethodNumber");
    same_serde_text::<MethodNumber>(&f, "MethodNumber");

    // Wrappers and token amounts (slice R2). A memo is a UTF-8 string of at
    // most 80 bytes in both languages, declared as a bound.
    same_schema_and_bytes::<Memo>(&mut f, "Memo");
    same_text::<Memo>(&f, "Memo");
    same_serde_text::<Memo>(&f, "Memo");
    same_schema_and_bytes::<Precision>(&mut f, "Precision");
    same_key::<Precision>(&f, "Precision");
    same_text::<Precision>(&f, "Precision");
    same_serde_text::<Precision>(&f, "Precision");
    same_schema_and_bytes::<Quantity>(&mut f, "Quantity");
    same_key::<Quantity>(&f, "Quantity");
    same_text::<Quantity>(&f, "Quantity");
    same_serde_text::<Quantity>(&f, "Quantity");
    same_schema_and_bytes::<Decimal>(&mut f, "Decimal");
    same_key::<Decimal>(&f, "Decimal");
    same_text::<Decimal>(&f, "Decimal");
    same_serde_text::<Decimal>(&f, "Decimal");

    // Core records (slice R3).
    same_schema_and_bytes::<BlockHeaderCode>(&mut f, "BlockHeaderCode");
    same_key::<BlockHeaderCode>(&f, "BlockHeaderCode");
    same_schema_and_bytes::<HttpHeader>(&mut f, "HttpHeader");
    same_key::<HttpHeader>(&f, "HttpHeader");
    same_schema_and_bytes::<VMOptions>(&mut f, "VMOptions");
    same_schema_and_bytes::<WasmConfigRow>(&mut f, "WasmConfigRow");
    same_schema_and_bytes::<ConsensusChangeRow>(&mut f, "ConsensusChangeRow");
    same_schema_and_bytes::<ScheduledSnapshotRow>(&mut f, "ScheduledSnapshotRow");
    same_schema_and_bytes::<LogTruncateRow>(&mut f, "LogTruncateRow");
    same_schema_and_bytes::<IPV4Address>(&mut f, "IPV4Address");
    same_schema_and_bytes::<IPV6Address>(&mut f, "IPV6Address");
    same_schema_and_bytes::<IPV4Endpoint>(&mut f, "IPV4Endpoint");
    same_schema_and_bytes::<IPV6Endpoint>(&mut f, "IPV6Endpoint");
    same_schema_and_bytes::<LocalEndpoint>(&mut f, "LocalEndpoint");
    same_schema_and_bytes::<TLSInfo>(&mut f, "TLSInfo");
    same_schema_and_bytes::<ServiceMethod>(&mut f, "ServiceMethod");
    same_key::<ServiceMethod>(&f, "ServiceMethod");
    same_schema_and_bytes::<EnvRow>(&mut f, "EnvRow");
    same_schema_and_bytes::<HostConfigRow>(&mut f, "HostConfigRow");
    same_schema_and_bytes::<PendingShutdownRow>(&mut f, "PendingShutdownRow");
    same_schema_and_bytes::<PackageRef>(&mut f, "PackageRef");
    same_schema_and_bytes::<PackageExport>(&mut f, "PackageExport");
    same_schema_and_bytes::<ConsoleTrace>(&mut f, "ConsoleTrace");

    // Byte sequences behind `Hex<T>`, and the records that hold them.
    same_schema_and_bytes::<Checksum256>(&mut f, "Checksum256");
    same_key::<Checksum256>(&f, "Checksum256");
    same_text::<Checksum256>(&f, "Checksum256");
    same_schema_and_bytes::<Vec<u8>>(&mut f, "Bytes");
    same_key::<Vec<u8>>(&f, "Bytes");
    same_text::<Vec<u8>>(&f, "Bytes");
    same_schema_and_bytes::<Vec<u8>>(&mut f, "Octets");
    same_key::<Vec<u8>>(&f, "Octets");
    same_text::<Vec<u8>>(&f, "Octets");
    same_schema_and_bytes::<Action>(&mut f, "Action");
    same_key::<Action>(&f, "Action");
    same_schema_and_bytes::<GenesisService>(&mut f, "GenesisService");
    same_key::<GenesisService>(&f, "GenesisService");
    same_schema_and_bytes::<GenesisActionData>(&mut f, "GenesisActionData");
    same_key::<GenesisActionData>(&f, "GenesisActionData");
    same_schema_and_bytes::<Claim>(&mut f, "Claim");
    same_key::<Claim>(&f, "Claim");
    same_schema_and_bytes::<Producer>(&mut f, "Producer");
    same_key::<Producer>(&f, "Producer");
    same_schema_and_bytes::<CftConsensus>(&mut f, "CftConsensus");
    same_schema_and_bytes::<BftConsensus>(&mut f, "BftConsensus");
    same_schema_and_bytes::<BlockHeaderAuthAccount>(&mut f, "BlockHeaderAuthAccount");
    same_key::<BlockHeaderAuthAccount>(&f, "BlockHeaderAuthAccount");
    same_schema_and_bytes::<HttpRequest>(&mut f, "HttpRequest");
    same_schema_and_bytes::<HttpReply>(&mut f, "HttpReply");
    same_schema_and_bytes::<CodeRow>(&mut f, "CodeRow");
    same_schema_and_bytes::<CodeByHashRow>(&mut f, "CodeByHashRow");
    same_schema_and_bytes::<BlockDataRow>(&mut f, "BlockDataRow");
    same_schema_and_bytes::<StateChecksum>(&mut f, "StateChecksum");
    same_schema_and_bytes::<StateSignature>(&mut f, "StateSignature");
    same_schema_and_bytes::<SnapshotStateItem>(&mut f, "SnapshotStateItem");
    same_schema_and_bytes::<SnapshotRow>(&mut f, "SnapshotRow");

    // Rows whose Rust declaration had fallen behind the C++ one.
    same_schema_and_bytes::<ConfigRow>(&mut f, "ConfigRow");
    same_schema_and_bytes::<LogMessage>(&mut f, "LogMessage");
    same_schema_and_bytes::<NotifyRow>(&mut f, "NotifyRow");
    same_schema_and_bytes::<RunMode>(&mut f, "RunMode");
    same_key::<RunMode>(&f, "RunMode");
    same_text::<RunMode>(&f, "RunMode");
    same_serde_text::<RunMode>(&f, "RunMode");

    // Records of services implemented in Rust, mirrored in C++ headers.
    same_schema_and_bytes::<services::staged_tx::service::Response>(&mut f, "Response");

    // Enums written by name, and the types that are one string in JSON.
    use psibase::services::accounts::NewAccountMode;
    use psibase::services::auth_sig::SubjectPublicKeyInfo;
    same_schema_and_bytes::<DbId>(&mut f, "DbId");
    same_key::<DbId>(&f, "DbId");
    same_text::<DbId>(&f, "DbId");
    same_serde_text::<DbId>(&f, "DbId");
    same_schema_and_bytes::<NewAccountMode>(&mut f, "NewAccountMode");
    same_key::<NewAccountMode>(&f, "NewAccountMode");
    same_text::<NewAccountMode>(&f, "NewAccountMode");
    same_serde_text::<NewAccountMode>(&f, "NewAccountMode");
    same_schema_and_bytes::<SubjectPublicKeyInfo>(&mut f, "SubjectPublicKeyInfo");
    same_text::<SubjectPublicKeyInfo>(&f, "SubjectPublicKeyInfo");
    same_serde_text::<SubjectPublicKeyInfo>(&f, "SubjectPublicKeyInfo");
    same_schema_and_bytes::<IPAddress>(&mut f, "IPAddress");
    same_text::<IPAddress>(&f, "IPAddress");
    same_serde_text::<IPAddress>(&f, "IPAddress");
    same_schema_and_bytes::<SocketEndpoint>(&mut f, "SocketEndpoint");
    same_text::<SocketEndpoint>(&f, "SocketEndpoint");
    same_serde_text::<SocketEndpoint>(&f, "SocketEndpoint");

    // A service's schema: the record, its bytes and its text.
    same_contract_and_bytes::<ServiceSchema>(&mut f, "ServiceSchema");
    same_text::<ServiceSchema>(&f, "ServiceSchema");
    same_serde_text::<ServiceSchema>(&f, "ServiceSchema");

    // Transactions.
    same_schema_and_bytes::<Tapos>(&mut f, "Tapos");
    same_key::<Tapos>(&f, "Tapos");
    same_text::<Tapos>(&f, "Tapos");
    same_serde_text::<Tapos>(&f, "Tapos");
    same_schema_and_bytes::<Transaction>(&mut f, "Transaction");
    same_text::<Transaction>(&f, "Transaction");
    same_serde_text::<Transaction>(&f, "Transaction");
    same_schema_and_bytes::<SignedTransaction>(&mut f, "SignedTransaction");
    same_text::<SignedTransaction>(&f, "SignedTransaction");
    same_serde_text::<SignedTransaction>(&f, "SignedTransaction");

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
fn same_interface<I: Interface>(fixture: &Fixture) {
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
    for theirs in &theirs.funcs {
        let ours = ours.funcs.iter().find(|func| func.name == theirs.name).unwrap();
        let at = format!("{name}::{}", theirs.name);
        let param_names = |func: &schema_ir::Func| -> Vec<String> {
            func.params.iter().map(|param| param.name.clone()).collect()
        };
        assert_eq!(param_names(ours), param_names(theirs), "{at}: parameter names");
        for (ours_param, theirs_param) in ours.params.iter().zip(&theirs.params) {
            assert_eq!(
                resolved(&ours_schema, &ours_param.r#type),
                resolved(&fixture.schema, &theirs_param.r#type),
                "{at}: type of {}",
                theirs_param.name
            );
            assert_eq!(ours_param.attributes, theirs_param.attributes, "{at}: {}", theirs_param.name);
        }
        assert_eq!(ours.result.is_some(), theirs.result.is_some(), "{at}: has a result");
        if let (Some(ours_result), Some(theirs_result)) = (&ours.result, &theirs.result) {
            assert_eq!(
                resolved(&ours_schema, ours_result),
                resolved(&fixture.schema, theirs_result),
                "{at}: result"
            );
        }
        assert_eq!(ours.attributes, theirs.attributes, "{at}: attributes");
    }

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

/// The error callback of a request (`x-http::setCallback`'s `err`), as a
/// Rust service declares it: C++ `XProxy::onError` and `XPeers::errP2P`
/// state the cap of the argument list, and so must a Rust callback, or its
/// arguments are another encoding.
mod proxy {
    #[psibase::service(name = "x-proxy", dispatch = false)]
    #[allow(non_snake_case, unused_variables)]
    pub mod service {
        #[action]
        #[pssz(max_dynamic_data = 4294967295)]
        fn onError(socket: i32, reply: Option<psibase::HttpReply>) {
            unimplemented!()
        }
    }
}
mod peers {
    #[psibase::service(name = "x-peers", dispatch = false)]
    #[allow(non_snake_case, unused_variables)]
    pub mod service {
        #[action]
        #[pssz(max_dynamic_data = 4294967295)]
        fn errP2P(socket: i32, reply: Option<psibase::HttpReply>) {
            unimplemented!()
        }
    }
}
use peers::service as x_peers;
use proxy::service as x_proxy;

/// What the caller a service macro generates packs for a call is the
/// fixture's bytes: the path every Rust client of a C++ service takes.
#[test]
fn rust_callers_pack_what_cpp_packs() {
    use psibase::services::{accounts, producers, transact};
    let f = Fixture::load();
    let call = |interface: &str, method: &str| -> Vec<u8> {
        f.calls
            .iter()
            .find(|(i, m, _)| i == interface && m == method)
            .unwrap_or_else(|| panic!("{interface}::{method} has no call in the fixture"))
            .2
            .clone()
    };
    let digest: Checksum256 = [
        0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08, 0x09, 0x0a, 0x0b, 0x0c, 0x0d, 0x0e,
        0x0f, 0xf0, 0xf1, 0xf2, 0xf3, 0xf4, 0xf5, 0xf6, 0xf7, 0xf8, 0xf9, 0xfa, 0xfb, 0xfc, 0xfd,
        0xfe, 0xff,
    ];
    let bytes = vec![0x00u8, 0x01, 0x7f, 0x80, 0xff];
    let alice = account!("alice");
    let producer = Producer {
        name: account!("prod1"),
        auth: Claim { service: account!("verify-k1"), rawData: bytes.clone() },
    };

    let start_boot = transact::Wrapper::pack().startBoot(vec![digest, [0; 32]]);
    assert_eq!(hex(&start_boot.rawData), hex(&call("transact", "startBoot")));
    assert_eq!(start_boot.method, MethodNumber::from("startBoot"));
    let new_account = accounts::Wrapper::pack().newAccount(
        alice,
        account!("auth-sig"),
        accounts::NewAccountMode::RequireNew,
    );
    assert_eq!(hex(&new_account.rawData), hex(&call("accounts", "newAccount")));
    let set_producers = producers::Wrapper::pack().setProducers(vec![producer.clone()]);
    assert_eq!(hex(&set_producers.rawData), hex(&call("producers", "setProducers")));

    // An empty argument list is one byte.
    assert_eq!(hex(&call("setcode", "init")), "00");
    assert_eq!(hex(&psibase::services::setcode::Wrapper::pack().init().rawData), "00");

    // The error callback without a reply is the capped list with the
    // optional absent: 4-byte offsets, not the 1-byte list of `(socket)`.
    assert_eq!(hex(&call("x-proxy", "onError")), "0400000007000000");
    assert_eq!(
        hex(&psio::to_pssz(&x_proxy::psio_actions::args::onError { socket: 7, reply: None })),
        "0400000007000000"
    );

    // The transactions: the same typed values give the same bytes and id.
    let expiration = TimePointSec::from_ticks(1_700_000_000);
    let genesis_service = GenesisService {
        service: account!("transact"),
        flags: 3,
        vmType: 1,
        vmVersion: 1,
        code: bytes.clone(),
    };
    let genesis = Transaction {
        tapos: Tapos { expiration, refBlockSuffix: 0, flags: 0, refBlockIndex: 0 },
        actions: vec![Action {
            sender: AccountNumber::default(),
            service: AccountNumber::default(),
            method: MethodNumber::from("boot"),
            rawData: psio::to_pssz(&GenesisActionData {
                memo: String::new(),
                services: vec![genesis_service],
            }),
        }],
        claims: vec![],
    };
    let boot = Transaction {
        tapos: Tapos { expiration, refBlockSuffix: 0x01020304, flags: 0, refBlockIndex: 7 },
        actions: vec![
            transact::Wrapper::pack_from(transact::SERVICE).startBoot(vec![digest]),
            producers::Wrapper::pack_from(producers::SERVICE).setProducers(vec![producer.clone()]),
            accounts::Wrapper::pack_from(accounts::SERVICE).newAccount(
                alice,
                account!("auth-any"),
                accounts::NewAccountMode::RequireNew,
            ),
        ],
        claims: vec![producer.auth.clone()],
    };
    let mut checked = BTreeSet::new();
    for (name, trx) in [("genesis", genesis), ("boot", boot)] {
        let (_, vector) = f.transactions.iter().find(|(n, _)| n == name).unwrap();
        let signed = SignedTransaction {
            transaction: psio::pssz::Nested::new(&trx).unwrap(),
            proofs: vec![],
            subjectiveData: None,
        };
        assert_eq!(hex(&psio::to_pssz(&signed)), hex(&vector.signed), "{name}: bytes");
        assert_eq!(hex(&sha256(signed.transaction.bytes())), hex(&vector.id), "{name}: id");
        assert_eq!(hex(&sha256(&psio::to_pssz(&trx))), hex(&vector.id), "{name}: id");
        assert_eq!(psio::to_ijson(&signed), vector.ijson, "{name}: I-JSON");
        let read = psio::from_ijson::<SignedTransaction>(&vector.ijson).unwrap();
        assert_eq!(hex(&psio::to_pssz(&read)), hex(&vector.signed), "{name}: I-JSON read");
        psio::validate_pssz::<SignedTransaction>(&vector.signed).unwrap();
        checked.insert(name.to_string());
    }
    let in_fixture: BTreeSet<String> = f.transactions.iter().map(|(n, _)| n.clone()).collect();
    assert_eq!(checked, in_fixture, "every transaction of the fixture is checked");
}

#[test]
fn rust_and_cpp_declare_the_same_services() {
    use psibase::services::{auth_delegate, setcode};
    let f = Fixture::load();

    same_interface::<setcode::psio_actions::Tag>(&f);
    same_interface::<auth_delegate::psio_actions::Tag>(&f);

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
    // What a boot packs for services implemented in C++, calls of services
    // implemented in Rust, and the two callbacks with a capped argument list.
    use psibase::services::{accounts, auth_sig, http_server, nft, packages, producers, sites, tokens, transact};
    arguments!(transact: startBoot);
    arguments!(accounts: newAccount);
    arguments!(auth_sig: newAccount);
    arguments!(packages: postinstall, setSchema);
    arguments!(sites: storeSys);
    arguments!(producers: setProducers);
    arguments!(http_server: registerServer);
    arguments!(tokens: credit, recall);
    arguments!(nft: mint);
    arguments!(x_proxy: onError);
    arguments!(x_peers: errP2P);
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
        "verify-k1" => verify_k1, "verify-r1" => verify_r1, "x-admin" => x_admin, "x-db" => x_db, "x-http" => x_http,
        "x-keys" => x_keys, "x-packages" => x_packages, "x-sites" => x_sites,
        "credential" => credentials, "nft" => nft, "staged-tx" => staged_tx, "symbol" => symbol,
        "tokens" => tokens, "vserver" => virtual_server, "wsauth" => ws_auth,
    }

    let mut problems = Vec::new();
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
                problems.push(format!("{account}::{method}: view {ours:?}, C++ {theirs:?}"));
            }
        }
        for method in view.keys() {
            if !methods.contains_key(method) {
                problems.push(format!("{account}::{method}: in the view, not in C++"));
            }
        }
    }
    assert!(problems.is_empty(), "{}", problems.join("\n"));
    assert_eq!(json["names"].as_array().unwrap().len(), views.len());
    assert!(compared >= 265, "{compared} methods compared");
}
