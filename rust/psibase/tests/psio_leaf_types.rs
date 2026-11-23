//! The PSIO forms of the leaf types: exact pSSZ bytes, key bytes and order,
//! I-JSON text in both directions, the schema, and rejection of what is not
//! a value. The expected bytes and texts are the ones the C++ tests pin for
//! the same types (`libraries/psibase/common/tests/leaf_types.cpp`), so the
//! two languages are checked against one set of vectors.

use psibase::{AccountNumber, AccountNumberPsszAccessors, MethodNumber};
use psio::pssz::schema_ir::{schema_for, AnyValue};

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{:02x}", b)).collect()
}

fn unhex(text: &str) -> Vec<u8> {
    (0..text.len())
        .step_by(2)
        .map(|i| u8::from_str_radix(&text[i..i + 2], 16).unwrap())
        .collect()
}

fn account(name: &str) -> AccountNumber {
    AccountNumber::from_exact(name).unwrap()
}

fn method(name: &str) -> MethodNumber {
    MethodNumber::from(name)
}

/// Key order is value order, and no key is a prefix of another.
fn check_key_order<T: psio::key::KeyPack>(values: &mut Vec<(u64, T)>) {
    values.sort_by_key(|(value, _)| *value);
    for pair in values.windows(2) {
        let (a, b) = (psio::to_key(&pair[0].1), psio::to_key(&pair[1].1));
        if pair[0].0 == pair[1].0 {
            assert_eq!(a, b);
        } else {
            assert!(a < b, "{} !< {}", hex(&a), hex(&b));
            assert!(!b.starts_with(&a));
        }
    }
}

// ── AccountNumber ───────────────────────────────────────────────────────────

#[test]
fn account_number_pssz_is_the_value_little_endian() {
    assert_eq!(hex(&psio::to_pssz(&account("alice"))), "00b82a1b83aedf04");
    assert_eq!(
        hex(&psio::to_pssz(&AccountNumber::default())),
        "0000000000000000"
    );
    assert_eq!(
        hex(&psio::to_pssz(&account("alice").with_subaccount(7.into()))),
        "07b82a1b83aedf04"
    );
    assert_eq!(
        hex(&psio::to_pssz(&AccountNumber::new(0x0102030405060708))),
        "0807060504030201"
    );
    assert_eq!(psio::pssz_size(&account("alice")), 8);

    assert_eq!(
        psio::from_pssz::<AccountNumber>(&unhex("00b82a1b83aedf04")).unwrap(),
        account("alice")
    );
    assert!(psio::validate_pssz::<AccountNumber>(&unhex("00b82a1b83aedf04")).is_ok());
    for bad in ["", "00b82a1b83aedf", "00b82a1b83aedf0400"] {
        assert!(psio::validate_pssz::<AccountNumber>(&unhex(bad)).is_err());
        assert!(psio::from_pssz::<AccountNumber>(&unhex(bad)).is_err());
    }

    // A view reads the member in place.
    let bytes = psio::to_pssz(&account("alice"));
    let view = psio::PsszView::<AccountNumber>::new(&bytes).unwrap();
    assert_eq!(view.value().get(), account("alice").value);
}

#[test]
fn account_number_key_is_the_value_big_endian_and_sorts_like_it() {
    assert_eq!(hex(&psio::to_key(&account("alice"))), "04dfae831b2ab800");
    assert_eq!(
        hex(&psio::to_key(&AccountNumber::default())),
        "0000000000000000"
    );
    assert_eq!(
        hex(&psio::to_key(&AccountNumber::new(0x0102030405060708))),
        "0102030405060708"
    );
    assert_eq!(
        psio::from_key::<AccountNumber>(&unhex("04dfae831b2ab800")).unwrap(),
        account("alice")
    );
    assert!(psio::validate_key::<AccountNumber>(&unhex("04dfae831b2ab8")).is_err());
    assert!(psio::validate_key::<AccountNumber>(&unhex("04dfae831b2ab80000")).is_err());

    let mut accounts: Vec<(u64, AccountNumber)> = [
        "",
        "a",
        "alice",
        "alicf",
        "bob",
        "a-b-c",
        "0",
        "zzzzzzzzzz",
        "z",
        "transact",
        "accounts",
        "alice2",
    ]
    .iter()
    .map(|name| account(name))
    .chain([
        account("alice").with_subaccount(1.into()),
        account("alice").with_subaccount(255.into()),
        AccountNumber::new(u64::MAX),
        AccountNumber::new(0x8000000000000000),
    ])
    .map(|a| (a.value, a))
    .collect();
    check_key_order(&mut accounts);

    // A composite key starts with the account's own key.
    assert_eq!(
        hex(&psio::to_key(&(account("alice"), 7u32))),
        "04dfae831b2ab80000000007"
    );
    assert_eq!(
        hex(&psio::key::key_prefix::<(AccountNumber, u32), _>(&(
            account("alice"),
        ))),
        "04dfae831b2ab800"
    );
}

#[test]
fn account_number_ijson_is_the_name() {
    assert_eq!(psio::to_ijson(&account("alice")), r#""alice""#);
    assert_eq!(psio::to_ijson(&AccountNumber::default()), r#""""#);
    assert_eq!(psio::to_ijson(&account("a-b-c")), r#""a-b-c""#);
    assert_eq!(psio::to_ijson(&account("0")), r#""0""#);
    assert_eq!(psio::to_ijson(&account("zzzzzzzzzz")), r#""zzzzzzzzzz""#);
    assert_eq!(
        psio::to_ijson(&account("alice").with_subaccount(7.into())),
        r#""alice+7""#
    );
    assert_eq!(
        psio::to_ijson(&account("alice").with_subaccount(255.into())),
        r#""alice+255""#
    );
    assert_eq!(
        psio::from_ijson::<AccountNumber>(r#"  "alice"  "#).unwrap(),
        account("alice")
    );
    assert_eq!(
        psio::from_ijson::<AccountNumber>(r#""alice+7""#)
            .unwrap()
            .subaccount()
            .0,
        7
    );
    // The same text in plain Json.
    assert_eq!(psio::to_json(&account("alice")), r#""alice""#);
}

#[test]
fn account_number_text_that_is_not_exactly_a_name_is_rejected() {
    for text in [
        r#""Alice""#,       // upper case
        r#""-alice""#,      // leading separator
        r#""alice-""#,      // trailing separator
        r#""a--b""#,        // doubled separator
        r#""abcdefghijk""#, // 11 characters
        r#""al ice""#,      // outside the alphabet
        r#""al_ice""#,
        r#""alice+0""#,   // subaccount 0 is the account itself
        r#""alice+07""#,  // not the canonical subaccount
        r#""alice+256""#, // subaccount out of range
        r#""alice+""#,
        r#""alice+x""#,
    ] {
        assert!(
            psio::from_ijson::<AccountNumber>(text).is_err(),
            "{text} was read"
        );
    }
    // Escapes are text, and this text is fine.
    assert_eq!(
        psio::from_ijson::<AccountNumber>("\"\\u0061lice\"").unwrap(),
        account("alice")
    );
    // Not a string at all.
    for text in [
        "5",
        "null",
        "true",
        r#"{"value":5}"#,
        r#"["alice"]"#,
        r#""alice" x"#,
        "",
    ] {
        assert!(
            psio::from_ijson::<AccountNumber>(text).is_err(),
            "{text} was read"
        );
    }
}

#[test]
fn account_number_text_parsers_do_not_panic() {
    // Text that names no account is the invalid account, 0; `from_exact`
    // reports it.
    for text in ["alice+", "alice+x", "alice+256", "alice+-1", "+", "++"] {
        assert_eq!(text.parse::<AccountNumber>().unwrap().value, 0, "{text}");
        assert!(AccountNumber::from_exact(text).is_err(), "{text}");
    }
}

#[test]
fn account_number_schema_is_a_custom_type_over_its_record() {
    let (schema, root) = schema_for::<AccountNumber>().unwrap();
    let AnyValue::Custom(custom) = &schema.resolve(&root).unwrap().value else {
        panic!("AccountNumber is not a Custom type in the schema");
    };
    assert_eq!(custom.id, "AccountNumber");
    let AnyValue::Object(record) = &schema.resolve(&custom.r#type).unwrap().value else {
        panic!("AccountNumber's wire type is not a record");
    };
    assert_eq!(record.members.len(), 1);
    assert_eq!(record.members[0].name, "value");
    assert!(record
        .attributes
        .iter()
        .any(|a| a.name == "definitionWillNotChange"));
    let AnyValue::Int(int) = &schema.resolve(&record.members[0].r#type).unwrap().value else {
        panic!("AccountNumber's member is not an integer");
    };
    assert_eq!((int.bits, int.isSigned), (64, false));
}

// ── MethodNumber ────────────────────────────────────────────────────────────

#[test]
fn method_number_pssz_is_the_value_little_endian() {
    assert_eq!(hex(&psio::to_pssz(&method("transfer"))), "41b6aa42ce000000");
    assert_eq!(
        hex(&psio::to_pssz(&MethodNumber::default())),
        "0000000000000000"
    );
    assert_eq!(
        hex(&psio::to_pssz(&method("someVeryLongMethodNameThatHashes"))),
        "65c102ee92116fad"
    );
    assert_eq!(psio::pssz_size(&method("transfer")), 8);
    assert!(psio::validate_pssz::<MethodNumber>(&unhex("41b6aa42ce0000")).is_err());
    assert!(psio::validate_pssz::<MethodNumber>(&unhex("41b6aa42ce00000000")).is_err());
    assert_eq!(
        psio::from_pssz::<MethodNumber>(&unhex("41b6aa42ce000000")).unwrap(),
        method("transfer")
    );
}

#[test]
fn method_number_key_is_the_value_big_endian_and_sorts_like_it() {
    assert_eq!(hex(&psio::to_key(&method("transfer"))), "000000ce42aab641");
    assert_eq!(
        hex(&psio::to_key(&MethodNumber::default())),
        "0000000000000000"
    );
    assert!(psio::validate_key::<MethodNumber>(&unhex("000000ce42aab6")).is_err());

    let mut methods: Vec<(u64, MethodNumber)> = [
        "",
        "transfer",
        "setcode",
        "init",
        "credit",
        "debit",
        "a",
        "z",
        "someVeryLongMethodNameThatHashes",
        "startsession",
    ]
    .iter()
    .map(|name| method(name))
    .chain([MethodNumber::new(u64::MAX)])
    .map(|m| (m.value, m))
    .collect();
    check_key_order(&mut methods);

    // (service, method): the key of a pair is the two keys in order.
    assert_eq!(
        hex(&psio::to_key(&(account("alice"), method("transfer")))),
        "04dfae831b2ab800000000ce42aab641"
    );
}

#[test]
fn method_number_ijson_is_the_name() {
    assert_eq!(psio::to_ijson(&method("transfer")), r#""transfer""#);
    assert_eq!(psio::to_ijson(&MethodNumber::default()), r#""""#);
    assert_eq!(psio::to_ijson(&method("setcode")), r#""setcode""#);
    // A name that does not compress is written as its hash...
    assert_eq!(
        psio::to_ijson(&method("someVeryLongMethodNameThatHashes")),
        r##""#nradiemmicaayrpu""##
    );
    // ...and read from either spelling.
    assert_eq!(
        psio::from_ijson::<MethodNumber>(r#""someVeryLongMethodNameThatHashes""#).unwrap(),
        method("someVeryLongMethodNameThatHashes")
    );
    assert_eq!(
        psio::from_ijson::<MethodNumber>(r##""#nradiemmicaayrpu""##).unwrap(),
        method("someVeryLongMethodNameThatHashes")
    );
    // An identifier as written in source names the same method.
    assert_eq!(
        psio::from_ijson::<MethodNumber>(r#""setCode""#).unwrap(),
        method("setcode")
    );
    assert_eq!(
        psio::from_ijson::<MethodNumber>(r#""setCode""#).unwrap(),
        method("setCode")
    );
}

#[test]
fn method_number_text_that_names_no_method_is_rejected() {
    for text in [
        r#""bad name""#, // outside the alphabet
        r#""a-b""#,
        r#""tränsfer""#,
        r##""#abc""##,              // a hash form is '#' and 16 letters
        r##""#zzzzzzzzzzzzzzzz""##, // letters outside the hash alphabet
        r##""#aaaaaaaaaaaaaaab""##, // not the hash form of a hashed name
        r##""#""##,
        r##""#abc#abc#abc#abc#""##, // 17 characters, not letters
        "7",
        "null",
        r#"{"value":7}"#,
        r#""transfer" "x""#,
    ] {
        assert!(
            psio::from_ijson::<MethodNumber>(text).is_err(),
            "{text} was read"
        );
    }
}

#[test]
fn method_number_schema_is_a_custom_type() {
    let (schema, root) = schema_for::<MethodNumber>().unwrap();
    let AnyValue::Custom(custom) = &schema.resolve(&root).unwrap().value else {
        panic!("MethodNumber is not a Custom type in the schema");
    };
    assert_eq!(custom.id, "MethodNumber");
}

/// `MethodNumber` is numbered by `psio::compress_name`: a name gets its
/// compressed number only if that number decodes back to it, and its hash
/// otherwise. The names below are the action names of the tree whose
/// numbers changed with that rule (the old coders kept a cut-off code).
#[test]
fn method_numbers_are_psios() {
    use psio::compress_name::{method_to_number, number_to_method};
    for (name, number, text) in [
        ("getSymbolType", 0xd55df3070b8758eb_u64, "#hmlnslheseoypnnp"),
        ("checkFirstAuth", 0xcd29c38cde224f8e, "#mlytiimpdlodcipd"),
        ("get_resources", 0xd5137f98107c0181, "#alaedsealcysoanp"),
        ("cpu_min_unit", 0x13fb233a1d98cbd8, "#lphdlcpauooihyoa"),
        ("frozenAccounts", 0x27303f52c1c094da, "#uptcedadinyoeosi"),
        ("regEvIdx", 0x413db64868a8ec0f, "#yedmlulrltrhpoat"),
        ("removeCallback", 0x978d530fdfe275cb, "#hdnsimypyeonplsc"),
        ("rowsBySecondary", 0x83a92f4d480665a6, "#runrreltptyicuol"),
        ("create_request", 0xf997f22d796b5e2b, "#himnhrcspiiysccy"),
        ("set_paid_occ", 0x15d82d05366fa15c, "#dnauyrronepilpna"),
    ] {
        assert_eq!(method(name).value, number, "{name}");
        assert_eq!(method(name).to_string(), text, "{name}");
        assert_eq!(method_to_number(name), number, "{name}");
        assert_eq!(number_to_method(number), text, "{name}");
        assert_eq!(
            psio::from_ijson::<MethodNumber>(&format!("\"{name}\"")).unwrap(),
            method(name)
        );
    }
    for name in [
        "",
        "transfer",
        "setcode",
        "setCode",
        "set_code",
        "a1",
        "someVeryLongMethodNameThatHashes",
        "#nradiemmicaayrpu",
        "bad name",
        "#abc",
    ] {
        assert_eq!(method(name).value, method_to_number(name), "{name}");
        assert_eq!(
            method(name).to_string(),
            number_to_method(method_to_number(name)),
            "{name}"
        );
    }
}

// ── The serde forms ─────────────────────────────────────────────────────────

#[test]
fn serde_reads_and_writes_psio_s_text() {
    // serde (HTTP handlers, the CLI, plugins) is PSIO's text: exactly one
    // text names an account, as in `from_ijson`.
    assert!(serde_json::from_str::<AccountNumber>(r#""Alice""#).is_err());
    assert!(serde_json::from_str::<AccountNumber>(r#"5"#).is_err());
    assert_eq!(
        serde_json::from_str::<AccountNumber>(r#""alice""#).unwrap(),
        account("alice")
    );
    assert_eq!(
        serde_json::to_string(&account("alice")).unwrap(),
        r#""alice""#
    );
    assert_eq!(serde_json::to_string(&account("alice")).unwrap(), psio::to_ijson(&account("alice")));
    // A method number that compresses is written lower case; every spelling is read.
    assert_eq!(serde_json::to_string(&method("setCode")).unwrap(), r#""setcode""#);
    assert_eq!(serde_json::from_str::<MethodNumber>(r#""setCode""#).unwrap(), method("setCode"));
}
