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
//! Until the wire flip the fixture also carries each value as the C++ legacy
//! library packs it, and the legacy Rust declaration -- what Rust writes
//! today -- must read and write those bytes (`same_legacy_bytes`).
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
    /// The value as the C++ legacy library packs it.
    frac: Vec<u8>,
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
                        frac: unhex(v["frac"].as_str().unwrap()),
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

/// The legacy declaration of the Rust type `T` reads what the C++ legacy
/// library packs for the type the fixture calls `name`, and packs the same
/// bytes. Deleted with the legacy library.
fn same_legacy_bytes<T>(fixture: &Fixture, name: &str)
where
    T: psibase::fracpack::Pack + psibase::fracpack::UnpackOwned,
{
    for vector in fixture.vectors(name) {
        let value = T::unpacked(&vector.frac)
            .unwrap_or_else(|e| panic!("{name}: legacy {} is rejected: {e:?}", hex(&vector.frac)));
        assert_eq!(hex(&value.packed()), hex(&vector.frac), "{name}: legacy bytes");
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

    // Byte sequences behind `Hex<T>`, and the records that hold them.
    same_schema_and_bytes::<Checksum256>(&mut f, "Checksum256", Same);
    same_key::<Checksum256>(&f, "Checksum256");
    same_text::<Checksum256>(&f, "Checksum256");
    same_schema_and_bytes::<Hex<Vec<u8>>>(&mut f, "Bytes", CharInCpp);
    same_key::<Hex<Vec<u8>>>(&f, "Bytes");
    same_text::<Hex<Vec<u8>>>(&f, "Bytes");
    same_schema_and_bytes::<Hex<Vec<u8>>>(&mut f, "Octets", Same);
    same_key::<Hex<Vec<u8>>>(&f, "Octets");
    same_text::<Hex<Vec<u8>>>(&f, "Octets");
    same_schema_and_bytes::<Action>(&mut f, "Action", CharInCpp);
    same_key::<Action>(&f, "Action");
    same_schema_and_bytes::<GenesisService>(&mut f, "GenesisService", CharInCpp);
    same_key::<GenesisService>(&f, "GenesisService");
    same_schema_and_bytes::<GenesisActionData>(&mut f, "GenesisActionData", RawAndCharInCpp);
    same_key::<GenesisActionData>(&f, "GenesisActionData");
    same_schema_and_bytes::<Claim>(&mut f, "Claim", CharInCpp);
    same_key::<Claim>(&f, "Claim");
    same_schema_and_bytes::<Producer>(&mut f, "Producer", CharInCpp);
    same_key::<Producer>(&f, "Producer");
    same_schema_and_bytes::<CftConsensus>(&mut f, "CftConsensus", CharInCpp);
    same_schema_and_bytes::<BftConsensus>(&mut f, "BftConsensus", CharInCpp);
    same_schema_and_bytes::<BlockHeaderAuthAccount>(&mut f, "BlockHeaderAuthAccount", Same);
    same_key::<BlockHeaderAuthAccount>(&f, "BlockHeaderAuthAccount");
    same_schema_and_bytes::<HttpRequest>(&mut f, "HttpRequest", RawAndCharInCpp);
    same_schema_and_bytes::<HttpReply>(&mut f, "HttpReply", RawAndCharInCpp);
    same_schema_and_bytes::<CodeRow>(&mut f, "CodeRow", Same);
    same_schema_and_bytes::<CodeByHashRow>(&mut f, "CodeByHashRow", Same);
    same_schema_and_bytes::<BlockDataRow>(&mut f, "BlockDataRow", CharInCpp);
    same_schema_and_bytes::<StateChecksum>(&mut f, "StateChecksum", Same);
    same_schema_and_bytes::<StateSignature>(&mut f, "StateSignature", CharInCpp);
    same_schema_and_bytes::<SnapshotStateItem>(&mut f, "SnapshotStateItem", CharInCpp);
    same_schema_and_bytes::<SnapshotRow>(&mut f, "SnapshotRow", CharInCpp);
    borrowed_records_write_the_bytes_of_the_owned_ones(&f);

    // Rows whose Rust declaration had fallen behind the C++ one.
    same_schema_and_bytes::<ConfigRow>(&mut f, "ConfigRow", Same);
    same_schema_and_bytes::<LogMessage>(&mut f, "LogMessage", RawInCpp);
    same_schema_and_bytes::<NotifyRow>(&mut f, "NotifyRow", CharInCpp);
    same_schema_and_bytes::<RunMode>(&mut f, "RunMode", Same);
    same_key::<RunMode>(&f, "RunMode");
    same_text::<RunMode>(&f, "RunMode");

    // What Rust writes today: the legacy declarations pack what C++ packs.
    // (`Decimal` has no legacy codec in Rust.)
    macro_rules! legacy {
        ($($name:literal => $ty:ty),* $(,)?) => {
            $(same_legacy_bytes::<$ty>(&f, $name);)*
            let with_legacy: BTreeSet<String> =
                [$($name),*, "Decimal"].iter().map(|name| name.to_string()).collect();
            assert_eq!(with_legacy, f.checked, "every type's legacy bytes are checked");
        };
    }
    f.checked.insert("Memo".to_string());
    legacy! {
        "AccountNumber" => AccountNumber, "MethodNumber" => MethodNumber, "Memo" => Memo,
        "Precision" => Precision, "Quantity" => Quantity,
        "BlockHeaderCode" => BlockHeaderCode, "HttpHeader" => HttpHeader,
        "VMOptions" => VMOptions, "WasmConfigRow" => WasmConfigRow,
        "ConsensusChangeRow" => ConsensusChangeRow,
        "ScheduledSnapshotRow" => ScheduledSnapshotRow, "LogTruncateRow" => LogTruncateRow,
        "IPV4Address" => IPV4Address, "IPV6Address" => IPV6Address,
        "IPV4Endpoint" => IPV4Endpoint, "IPV6Endpoint" => IPV6Endpoint,
        "LocalEndpoint" => LocalEndpoint, "TLSInfo" => TLSInfo,
        "ServiceMethod" => ServiceMethod, "EnvRow" => EnvRow, "HostConfigRow" => HostConfigRow,
        "PendingShutdownRow" => PendingShutdownRow, "PackageRef" => PackageRef,
        "PackageExport" => PackageExport, "ConsoleTrace" => ConsoleTrace,
        "Checksum256" => Checksum256, "Bytes" => Hex<Vec<u8>>, "Octets" => Hex<Vec<u8>>,
        "Action" => Action, "GenesisService" => GenesisService,
        "GenesisActionData" => GenesisActionData, "Claim" => Claim, "Producer" => Producer,
        "CftConsensus" => CftConsensus, "BftConsensus" => BftConsensus,
        "BlockHeaderAuthAccount" => BlockHeaderAuthAccount, "HttpRequest" => HttpRequest,
        "HttpReply" => HttpReply, "CodeRow" => CodeRow, "CodeByHashRow" => CodeByHashRow,
        "BlockDataRow" => BlockDataRow, "StateChecksum" => StateChecksum,
        "StateSignature" => StateSignature, "SnapshotStateItem" => SnapshotStateItem,
        "SnapshotRow" => SnapshotRow, "ConfigRow" => ConfigRow, "LogMessage" => LogMessage,
        "NotifyRow" => NotifyRow, "RunMode" => RunMode,
    }

    memo_differs_only_in_its_declared_bound(&mut f);

    let in_fixture: BTreeSet<String> = f.vectors.iter().map(|(ty, _)| ty.clone()).collect();
    assert_eq!(
        f.checked, in_fixture,
        "every type of the fixture is checked"
    );
}

/// `SharedAction`, `SharedGenesisService` and `SharedGenesisActionData`
/// borrow their bytes and are only written (`PsszPack`); what they write is
/// what `Action`, `GenesisService` and `GenesisActionData` write.
fn borrowed_records_write_the_bytes_of_the_owned_ones(f: &Fixture) {
    for vector in f.vectors("Action") {
        let owned = psio::from_pssz::<Action>(&vector.pssz).unwrap();
        let shared = SharedAction {
            sender: owned.sender,
            service: owned.service,
            method: owned.method,
            rawData: Hex(&owned.rawData.0[..]),
        };
        assert_eq!(hex(&psio::to_pssz(&shared)), hex(&vector.pssz));
    }
    for vector in f.vectors("GenesisActionData") {
        let owned = psio::from_pssz::<GenesisActionData>(&vector.pssz).unwrap();
        let shared = SharedGenesisActionData {
            memo: owned.memo.clone(),
            services: owned
                .services
                .iter()
                .map(|s| SharedGenesisService {
                    service: s.service,
                    flags: s.flags,
                    vmType: s.vmType,
                    vmVersion: s.vmVersion,
                    code: Hex(&s.code.0[..]),
                })
                .collect(),
        };
        assert_eq!(hex(&psio::to_pssz(&shared)), hex(&vector.pssz));
        for (shared, owned) in shared.services.iter().zip(&owned.services) {
            assert_eq!(hex(&psio::to_pssz(shared)), hex(&psio::to_pssz(owned)));
        }
    }
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
    let ours = resolved(&ours, &root, Same);
    let theirs = resolved(&f.schema, f.schema.get("Memo").unwrap(), Same);
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

    same_interface::<setcode::psio_actions::Tag>(&f, CharInCpp);
    same_interface::<auth_delegate::psio_actions::Tag>(&f, CharInCpp);

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

    // What the macro generates today is untouched and packs the same
    // arguments in the legacy form: the action record and the tuple.
    use psibase::fracpack::Pack;
    let alice: AccountNumber = "alice".parse().unwrap();
    assert_eq!(
        setcode::action_structs::setFlags { service: alice, flags: 1 }.packed(),
        (alice, 1u64).packed()
    );
}
