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
//! Every type in the fixture must be checked, so a type added in C++ fails
//! here until Rust declares it.

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
        Fixture {
            schema,
            vectors,
            checked: BTreeSet::new(),
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

/// How a string member is declared. C++ `std::string` is raw bytes
/// (`Custom{List<u8>, "string"}`); a Rust `String` is UTF-8
/// (`Custom{List<u8>, "utf8"}`). The bytes are the same.
#[derive(Clone, Copy, PartialEq)]
enum Strings {
    /// The two schemas are equal as they stand.
    Same,
    /// C++ declares the type's strings raw and Rust UTF-8; nothing else
    /// differs.
    RawInCpp,
}

/// A node with every reference replaced by what it refers to. With
/// `raw_as_utf8`, a raw string reads as a UTF-8 one.
fn resolved(schema: &schema_ir::Schema, ty: &AnyType, raw_as_utf8: bool) -> AnyType {
    let go = |ty: &AnyType| Box::new(resolved(schema, ty, raw_as_utf8));
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
                raw_as_utf8,
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
        V::Custom(c) => V::Custom(schema_ir::Custom {
            r#type: go(&c.r#type),
            id: if raw_as_utf8 && c.id == "string" {
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
fn same_schema_and_bytes<T>(fixture: &mut Fixture, name: &str, strings: Strings)
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
    let exact = resolved(&ours, &root, false) == resolved(&fixture.schema, theirs, false);
    match strings {
        Strings::Same => assert_eq!(
            resolved(&ours, &root, false),
            resolved(&fixture.schema, theirs, false),
            "{name}: schema"
        ),
        Strings::RawInCpp => {
            assert!(
                !exact,
                "{name}: the schemas are equal now; check it with Strings::Same"
            );
            assert_eq!(
                resolved(&ours, &root, true),
                resolved(&fixture.schema, theirs, true),
                "{name}: schema, apart from raw / UTF-8 strings"
            );
        }
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
    use Strings::*;

    // Names (slice R1).
    same_schema_and_bytes::<AccountNumber>(&mut f, "AccountNumber", Same);
    same_key::<AccountNumber>(&f, "AccountNumber");
    same_text::<AccountNumber>(&f, "AccountNumber");
    same_schema_and_bytes::<MethodNumber>(&mut f, "MethodNumber", Same);
    same_key::<MethodNumber>(&f, "MethodNumber");
    same_text::<MethodNumber>(&f, "MethodNumber");

    // Wrappers and token amounts (slice R2). `Memo` is checked on its own
    // below: its two declarations are not the same yet.
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
    same_schema_and_bytes::<LocalEndpoint>(&mut f, "LocalEndpoint", RawInCpp);
    same_schema_and_bytes::<TLSInfo>(&mut f, "TLSInfo", Same);
    same_schema_and_bytes::<ServiceMethod>(&mut f, "ServiceMethod", Same);
    same_key::<ServiceMethod>(&f, "ServiceMethod");
    same_schema_and_bytes::<EnvRow>(&mut f, "EnvRow", RawInCpp);
    same_schema_and_bytes::<HostConfigRow>(&mut f, "HostConfigRow", RawInCpp);
    same_schema_and_bytes::<PendingShutdownRow>(&mut f, "PendingShutdownRow", RawInCpp);
    same_schema_and_bytes::<PackageRef>(&mut f, "PackageRef", RawInCpp);
    same_schema_and_bytes::<PackageExport>(&mut f, "PackageExport", RawInCpp);
    same_schema_and_bytes::<ConsoleTrace>(&mut f, "ConsoleTrace", RawInCpp);

    memo_differs_only_in_its_declared_bound(&mut f);

    let in_fixture: BTreeSet<String> = f.vectors.iter().map(|(ty, _)| ty.clone()).collect();
    assert_eq!(
        f.checked, in_fixture,
        "every type of the fixture is checked"
    );
}

/// `Memo`. Rust declares what the type is to be at the wire flip: a UTF-8
/// string of at most 80 bytes, stated as a bound (`#[psio(max = 80)]`). C++
/// still declares a raw string with an invariant that checks the same two
/// things. A memo's bytes and text are the same in both; the schema
/// node is not, and inside a record the bound can select a narrower offset
/// width. This test pins exactly that difference, so it fails when C++
/// declares the bound and the two can be compared like every other type.
fn memo_differs_only_in_its_declared_bound(f: &mut Fixture) {
    f.checked.insert("Memo".to_string());
    for vector in f.vectors("Memo") {
        let value = psio::from_pssz::<Memo>(&vector.pssz).unwrap();
        assert_eq!(hex(&psio::to_pssz(&value)), hex(&vector.pssz));
        // (No key: a Rust `Memo` is not a PSIO key; see `psibase::Memo`.)
        assert_eq!(psio::to_ijson(&value), vector.ijson);
        assert_eq!(
            hex(&psio::to_pssz(
                &psio::from_ijson::<Memo>(&vector.ijson).unwrap()
            )),
            hex(&vector.pssz)
        );
    }

    let (ours, root) = schema_for::<Memo>().unwrap();
    let ours = resolved(&ours, &root, false);
    let theirs = resolved(&f.schema, f.schema.get("Memo").unwrap(), false);
    assert_ne!(
        ours, theirs,
        "Memo: the schemas are equal now; check it like the others"
    );
    // Rust: UTF-8 text of at most 80 bytes.
    let V::Custom(text) = &ours.value else {
        panic!("Memo is not a string in Rust's schema: {ours:?}")
    };
    assert_eq!(text.id, "utf8");
    let V::BoundedList(bytes) = &text.r#type.value else {
        panic!("Memo has no bound in Rust's schema: {ours:?}")
    };
    assert_eq!(bytes.maxCount, 80);
    // C++: the custom type `Memo` over an unbounded raw string.
    let V::Custom(memo) = &theirs.value else {
        panic!("Memo is not a custom type in the C++ schema: {theirs:?}")
    };
    assert_eq!(memo.id, "Memo");
    let V::Custom(text) = &memo.r#type.value else {
        panic!("Memo is not over a string in the C++ schema: {theirs:?}")
    };
    assert_eq!(text.id, "string");
    assert!(matches!(text.r#type.value, V::List(_)));
}
