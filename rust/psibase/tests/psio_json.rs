//! The JSON text of representative psibase types, pinned.
//!
//! JSON has one source of behaviour, PSIO's I-JSON (`external/psio/docs/json.md`):
//! `psio::to_ijson` / `from_ijson`, and serde through `psio::Serde`, read and
//! write the same text. The texts here are the ones the C++ side documents
//! (`doc/migrations/2026-11-fracpack-to-pssz/flip-interop.md` 5 of the C++ flip
//! branch) and pins in
//! `libraries/psibase/common/tests/json.cpp`: what a Rust tool reads from a
//! node and what a node reads from a Rust tool.
#![allow(non_snake_case)]

use psibase::services::accounts::NewAccountMode;
use psibase::services::auth_sig::SubjectPublicKeyInfo;
use psibase::services::{setcode, sites, tokens};
use psibase::{
    AccountNumber, Action, ActionTrace, DbId, MethodNumber, TimePointSec, TimePointUSec,
    TransactionTrace,
};
use std::fmt::Debug;

/// `text` is the I-JSON of `value`, through PSIO and through serde, and
/// reads back to it through both.
#[track_caller]
fn pinned<T>(value: &T, text: &str)
where
    T: psio::json::JsonText + serde::Serialize + serde::de::DeserializeOwned + Debug,
{
    assert_eq!(psio::to_ijson(value), text, "to_ijson");
    assert_eq!(serde_json::to_string(value).unwrap(), text, "serde");
    assert_eq!(psio::to_ijson(&psio::from_ijson::<T>(text).unwrap()), text, "from_ijson");
    assert_eq!(
        psio::to_ijson(&serde_json::from_str::<T>(text).unwrap()),
        text,
        "serde read"
    );
    // A serde_json::Value holds the same document.
    assert_eq!(
        serde_json::to_value(value).unwrap(),
        serde_json::from_str::<serde_json::Value>(text).unwrap(),
        "serde value"
    );
}

/// What reading `text` and writing it again gives, or the reader's message.
fn reread<T: psio::json::JsonText + serde::de::DeserializeOwned>(text: &str) -> String {
    let through_psio = match psio::from_ijson::<T>(text) {
        Ok(value) => psio::to_ijson(&value),
        Err(error) => format!("error: {}", error.what),
    };
    // serde accepts and rejects the same texts.
    match serde_json::from_str::<T>(text) {
        Ok(value) => assert_eq!(psio::to_ijson(&value), through_psio, "serde reads {text}"),
        Err(_) => assert!(through_psio.starts_with("error: "), "serde rejects {text}"),
    }
    through_psio
}

fn account(name: &str) -> AccountNumber {
    AccountNumber::from_exact(name).unwrap()
}

// ── An action's arguments: 64-bit integers and bytes ────────────────────────

#[test]
fn action_arguments_with_64_bit_and_byte_members() {
    type Args = setcode::action_structs::stageCode;
    let args = |id: u64| Args {
        service: account("alice"),
        id,
        vmType: 0,
        vmVersion: 0,
        code: vec![0x00, 0x61, 0x73, 0x6d, 0xff],
    };
    // An object keyed by parameter name; a 64-bit integer is bare up to
    // 2^53 - 1 and a decimal string beyond; bytes are upper-case hex.
    pinned(
        &args(9007199254740991),
        r#"{"service":"alice","id":9007199254740991,"vmType":0,"vmVersion":0,"code":"0061736DFF"}"#,
    );
    pinned(
        &args(9007199254740992),
        r#"{"service":"alice","id":"9007199254740992","vmType":0,"vmVersion":0,"code":"0061736DFF"}"#,
    );
    pinned(
        &args(u64::MAX),
        r#"{"service":"alice","id":"18446744073709551615","vmType":0,"vmVersion":0,"code":"0061736DFF"}"#,
    );
    // A reader takes either form of a 64-bit integer in range, either case
    // of hex, the members in any order, and skips an unknown member.
    assert_eq!(
        reread::<Args>(r#"{"code":"0061736dff","id":"7","x":[1,{}],"vmVersion":0,"vmType":0,"service":"alice"}"#),
        r#"{"service":"alice","id":7,"vmType":0,"vmVersion":0,"code":"0061736DFF"}"#
    );
    // The positional array is accepted as well.
    assert_eq!(
        reread::<Args>(r#"["alice",7,0,0,"0061736DFF"]"#),
        r#"{"service":"alice","id":7,"vmType":0,"vmVersion":0,"code":"0061736DFF"}"#
    );
    // A bare number beyond 2^53 - 1 is not rounded; a narrower integer is
    // not read from a string; bytes are not an array; a missing member is
    // an error.
    for text in [
        r#"{"service":"alice","id":9007199254740992,"vmType":0,"vmVersion":0,"code":""}"#,
        r#"{"service":"alice","id":"18446744073709551616","vmType":0,"vmVersion":0,"code":""}"#,
        r#"{"service":"alice","id":1,"vmType":"0","vmVersion":0,"code":""}"#,
        r#"{"service":"alice","id":1,"vmType":256,"vmVersion":0,"code":""}"#,
        r#"{"service":"alice","id":1,"vmType":0,"vmVersion":0,"code":[0,97]}"#,
        r#"{"service":"alice","id":1,"vmType":0,"vmVersion":0,"code":"0"}"#,
        r#"{"service":"Alice","id":1,"vmType":0,"vmVersion":0,"code":""}"#,
        r#"["alice",7,0,0]"#,
    ] {
        assert!(reread::<Args>(text).starts_with("error: "), "{text}");
    }
    assert_eq!(
        reread::<Args>(r#"{"service":"alice","id":1,"vmType":0,"vmVersion":0}"#),
        r#"error: json: missing required member "code" of stageCode"#
    );
    // The bytes that are sent are the PSSZ of the tuple of the parameters.
    assert_eq!(
        psio::to_pssz(&args(7)),
        psio::to_pssz(&(account("alice"), 7u64, 0u8, 0u8, vec![0x00u8, 0x61, 0x73, 0x6d, 0xff]))
    );
}

#[test]
fn a_missing_optional_argument_is_none() {
    type Args = sites::action_structs::storeSys;
    let text = r#"{"path":"/index.html","contentType":"text/html","contentEncoding":null,"content":"3C703E"}"#;
    assert_eq!(
        reread::<Args>(r#"{"path":"/index.html","contentType":"text/html","content":"3c703e"}"#),
        text
    );
    assert_eq!(reread::<Args>(text), text);
    assert_eq!(
        reread::<Args>(r#"{"path":"/index.html","contentEncoding":null,"content":""}"#),
        r#"error: json: missing required member "contentType" of storeSys"#
    );
}

#[test]
fn text_forms_in_arguments() {
    // An account, a quantity, a memo: `tokens::credit`.
    type Args = tokens::action_structs::credit;
    let text = r#"{"token_id":1,"debitor":"bob","amount":{"value":"12345678901234567890"},"memo":"thanks"}"#;
    assert_eq!(reread::<Args>(text), text);
    // The memo is at most 80 bytes of UTF-8.
    let long = format!(
        r#"{{"token_id":1,"debitor":"bob","amount":{{"value":5}},"memo":"{}"}}"#,
        "m".repeat(81)
    );
    assert!(reread::<Args>(&long).starts_with("error: "));
}

// ── An action, a transaction ────────────────────────────────────────────────

#[test]
fn an_action_and_a_transaction() {
    let action = Action {
        sender: account("alice"),
        service: account("tokens"),
        method: MethodNumber::from("credit"),
        rawData: vec![1, 2, 0xab],
    };
    pinned(
        &action,
        r#"{"sender":"alice","service":"tokens","method":"credit","rawData":"0102AB"}"#,
    );
    // The null account is the empty string.
    assert_eq!(
        reread::<Action>(r#"{"sender":"","service":"tokens","method":"credit","rawData":""}"#),
        r#"{"sender":"","service":"tokens","method":"credit","rawData":""}"#
    );

    // `POST /common/pack/Transaction`: every member of `tapos` is required
    // and `expiration` is in whole seconds.
    let text = r#"{"tapos":{"expiration":"2023-11-14T22:13:20Z","refBlockSuffix":16909060,"flags":0,"refBlockIndex":7},"actions":[{"sender":"alice","service":"tokens","method":"credit","rawData":"0102AB"}],"claims":[{"service":"verify-sig","rawData":"00"}]}"#;
    assert_eq!(reread::<psibase::Transaction>(text), text);
    assert!(reread::<psibase::Transaction>(
        r#"{"tapos":{"expiration":"2023-11-14T22:13:20Z","refBlockSuffix":1,"refBlockIndex":7},"actions":[],"claims":[]}"#
    )
    .starts_with("error: "));

    // A signed transaction holds its transaction as an object, not as the
    // hex of the packed transaction; a missing `subjectiveData` is absent.
    let signed = format!(r#"{{"transaction":{text},"proofs":["0A0B"],"subjectiveData":null}}"#);
    assert_eq!(reread::<psibase::SignedTransaction>(&signed), signed);
    assert_eq!(
        reread::<psibase::SignedTransaction>(&format!(
            r#"{{"transaction":{text},"proofs":["0a0b"]}}"#
        )),
        signed
    );
    assert!(reread::<psibase::SignedTransaction>(r#"{"transaction":"0102","proofs":[]}"#)
        .starts_with("error: "));
    // Packed, the member is the canonical PSSZ of that object, which is
    // what is hashed and signed.
    let read: psibase::SignedTransaction = psio::from_ijson(&signed).unwrap();
    let transaction: psibase::Transaction = psio::from_ijson(text).unwrap();
    assert_eq!(read.transaction.bytes(), &psio::to_pssz(&transaction)[..]);
}

// ── A variant, enums ────────────────────────────────────────────────────────

#[test]
fn a_variant_is_an_object_of_one_member() {
    use psibase::{CftConsensus, ConsensusData, Producer};
    let consensus = ConsensusData::CftConsensus(CftConsensus {
        producers: vec![Producer {
            name: account("prod"),
            auth: psibase::Claim { service: account("verify-sig"), rawData: vec![0x30] },
        }],
    });
    let text = r#"{"CftConsensus":{"producers":[{"name":"prod","auth":{"service":"verify-sig","rawData":"30"}}]}}"#;
    pinned(&consensus, text);
    for wrong in [
        r#"{"cftConsensus":{"producers":[]}}"#,
        r#"{"CftConsensus":{"producers":[]},"BftConsensus":{"producers":[]}}"#,
        r#"{"producers":[]}"#,
        r#"[0,{"producers":[]}]"#,
    ] {
        assert!(reread::<ConsensusData>(wrong).starts_with("error: "), "{wrong}");
    }
}

#[test]
fn a_reflected_enum_is_its_cpp_name() {
    let names = [
        (DbId::Service, "service", 0u32),
        (DbId::WriteOnly, "writeOnly", 1),
        (DbId::Native, "native", 2),
        (DbId::BlockLog, "blockLog", 3),
        (DbId::BlockProof, "blockProof", 4),
        (DbId::PrevAuthServices, "prevAuthServices", 5),
        (DbId::Subjective, "subjective", 64),
        (DbId::NativeSubjective, "nativeSubjective", 65),
        (DbId::Session, "session", 66),
        (DbId::NativeSession, "nativeSession", 67),
        (DbId::Temporary, "temporary", 68),
    ];
    for (db, name, number) in names {
        pinned(&db, &format!("\"{name}\""));
        // Its bytes are a u32; the number is read too.
        assert_eq!(psio::to_pssz(&db), number.to_le_bytes());
        assert_eq!(reread::<DbId>(&number.to_string()), format!("\"{name}\""));
    }
    for wrong in [r#""numChainDatabases""#, r#""endPersistent""#, r#""Service""#, "6", "69"] {
        assert!(reread::<DbId>(wrong).starts_with("error: "), "{wrong}");
    }

    pinned(&NewAccountMode::KeepExisting, r#""keepExisting""#);
    pinned(&NewAccountMode::MatchExisting, r#""matchExisting""#);
    pinned(&NewAccountMode::RequireNew, r#""requireNew""#);
    assert_eq!(reread::<NewAccountMode>("2"), r#""requireNew""#);
    assert_eq!(psio::to_pssz(&NewAccountMode::RequireNew), [2]);
    assert!(reread::<NewAccountMode>(r#""other""#).starts_with("error: "));
    assert!(reread::<NewAccountMode>("3").starts_with("error: "));
    assert!(psio::from_pssz::<NewAccountMode>(&[3]).is_err());
}

// ── A trace ─────────────────────────────────────────────────────────────────

#[test]
fn a_transaction_trace() {
    // What a node answers a pushed transaction with. `totalTime` is in
    // nanoseconds and bare (it was a string); `error` and `console` are raw
    // strings; an inner trace is a variant.
    let text = r#"{"actionTraces":[{"action":{"sender":"alice","service":"tokens","method":"credit","rawData":"0102AB"},"rawRetval":"","innerTraces":[{"inner":{"ConsoleTrace":{"console":"hello"}}},{"inner":{"ActionTrace":{"action":{"sender":"tokens","service":"nft","method":"debit","rawData":""},"rawRetval":"01","innerTraces":[],"totalTime":1500,"error":null}}}],"totalTime":123456789,"error":null}],"error":"insufficient balance"}"#;
    let trace: TransactionTrace = serde_json::from_str(text).unwrap();
    pinned(&trace, text);
    assert_eq!(trace.error_text().as_deref(), Some("insufficient balance"));
    assert_eq!(trace.action_traces[0].total_time.ticks(), 123456789);

    // `totalTime` in either form of a 64-bit integer.
    let action = r#"{"action":{"sender":"a","service":"b","method":"m","rawData":""},"rawRetval":"","innerTraces":[],"totalTime":"1500","error":null}"#;
    assert_eq!(
        reread::<ActionTrace>(action),
        action.replace(r#""totalTime":"1500""#, r#""totalTime":1500"#)
    );
    let long = action.replace(r#""1500""#, r#""9007199254740993""#);
    assert_eq!(reread::<ActionTrace>(&long), long);
    // A missing optional member is absent.
    assert_eq!(
        reread::<TransactionTrace>(r#"{"actionTraces":[]}"#),
        r#"{"actionTraces":[],"error":null}"#
    );
}

// ── Time ────────────────────────────────────────────────────────────────────

#[test]
fn time_values() {
    // A time point is RFC 3339 in UTC with exactly the unit's fraction
    // digits; a duration is its tick count.
    pinned(&TimePointSec::from_ticks(1795342530), r#""2026-11-22T10:15:30Z""#);
    pinned(
        &TimePointUSec::from_ticks(1795342530123456),
        r#""2026-11-22T10:15:30.123456Z""#,
    );
    pinned(
        &TimePointUSec::from_ticks(1795342530000000),
        r#""2026-11-22T10:15:30.000000Z""#,
    );
    pinned(&psibase::Seconds::from_ticks(5), "5");
    pinned(&psibase::MicroSeconds::from_ticks(1 << 60), r#""1152921504606846976""#);
    // An offset is converted; zero fraction digits beyond the unit are
    // accepted; a finer fraction, a missing offset and a number are not.
    assert_eq!(
        reread::<TimePointSec>(r#""2026-11-22T12:15:30+02:00""#),
        r#""2026-11-22T10:15:30Z""#
    );
    assert_eq!(
        reread::<TimePointSec>(r#""2026-11-22T10:15:30.000Z""#),
        r#""2026-11-22T10:15:30Z""#
    );
    for wrong in [
        r#""2026-11-22T10:15:30.5Z""#,
        r#""2026-11-22T10:15:30""#,
        "1795342530",
    ] {
        assert!(reread::<TimePointSec>(wrong).starts_with("error: "), "{wrong}");
    }
}

// ── A table row ─────────────────────────────────────────────────────────────

#[test]
fn a_table_row() {
    use psibase::services::accounts::Account;
    // The row of the accounts table, as the Accounts service's queries
    // return it.
    let row = Account {
        accountNum: account("alice"),
        authService: account("auth-sig"),
        authSequence: 3,
    };
    pinned(&row, r#"{"accountNum":"alice","authService":"auth-sig","authSequence":3}"#);
    assert_eq!(
        reread::<Account>(r#"{"accountNum":"alice","authService":"auth-sig","authSequence":"3"}"#),
        r#"{"accountNum":"alice","authService":"auth-sig","authSequence":3}"#
    );

    // A row with a digest and a time: a staged transaction's header.
    use psibase::services::staged_tx::service::StagedTx;
    let text = format!(
        r#"{{"id":7,"txid":"{}","propose_block":12,"propose_date":"2026-11-22T10:15:30.000000Z","proposer":"alice","action_list":{{"actions":[]}},"auto_exec":true}}"#,
        "AB".repeat(32)
    );
    let row: StagedTx = psio::from_ijson(&text).unwrap();
    assert_eq!(row.txid, [0xab; 32]);
    assert_eq!(psio::to_ijson(&row), text);
    assert_eq!(serde_json::to_string(&row).unwrap(), text);
}

// ── A public key ────────────────────────────────────────────────────────────

const PUBLIC_KEY_PEM: &str = "-----BEGIN PUBLIC KEY-----\n\
MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEWdALpn+cGuD1klsSRXTdapYlG5mu\n\
WgoALofZYufL838GRUo43UuoGzxu/mW5T6r9Ix4/qc4gH2B+Zc6VYw/pKQ==\n\
-----END PUBLIC KEY-----\n";

#[test]
fn a_public_key_is_its_pem_text() {
    // The cases of the C++ test "json: a public key is its PEM text".
    let key: SubjectPublicKeyInfo = PUBLIC_KEY_PEM.parse().unwrap();
    assert_eq!(key.0.len(), 91);
    assert_eq!(key.to_string(), PUBLIC_KEY_PEM);
    let json = psio::to_ijson(&PUBLIC_KEY_PEM.to_string());
    pinned(&key, &json);
    // White space around the armor and inside the body is not significant.
    assert_eq!(
        psio::from_ijson::<SubjectPublicKeyInfo>(concat!(
            r#""  -----BEGIN PUBLIC KEY-----MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEWdALpn+cGuD1klsSRXTdapYlG5mu\r\n"#,
            r#"WgoALofZYufL838GRUo43UuoGzxu/mW5T6r9Ix4/qc4gH2B+Zc6VYw/pKQ==-----END PUBLIC KEY-----""#
        ))
        .unwrap(),
        key
    );
    // Packed, it is its DER bytes, whatever they are.
    assert_eq!(psio::to_pssz(&key), psio::to_pssz(&key.0));

    let rejected = |text: &str| reread::<SubjectPublicKeyInfo>(text).starts_with("error: ");
    assert!(rejected(r#""""#));
    assert!(rejected(r#""garbage""#));
    assert!(rejected(r#""-----BEGIN PUBLIC KEY-----""#));
    assert!(rejected(r#""-----BEGIN PRIVATE KEY-----\nMFkw\n-----END PRIVATE KEY-----\n""#));
    assert!(rejected(r#""-----BEGIN PUBLIC KEY-----\n!!!!\n-----END PUBLIC KEY-----\n""#));
    assert!(rejected(r#""-----BEGIN PUBLIC KEY-----\nMFkw\n-----END PUBLIC KEY-----\ntrailing""#));
    // The hex of the DER bytes (the JSON of the wire type) is not the text.
    assert!(rejected(r#""3059""#));
    // Valid armor around bytes that are not SEQUENCE { SEQUENCE { OID … }, BIT STRING }.
    assert!(rejected(r#""-----BEGIN PUBLIC KEY-----\nAQID\n-----END PUBLIC KEY-----\n""#));
    let reencode = |bytes: Vec<u8>| psio::to_ijson(&SubjectPublicKeyInfo(bytes).to_string());
    let mut truncated = key.0.clone();
    truncated.pop();
    assert!(rejected(&reencode(truncated)));
    let mut extended = key.0.clone();
    extended.push(0);
    assert!(rejected(&reencode(extended)));
    let mut no_bit_string = key.0.clone();
    no_bit_string[23] = 0x04; // the key as an OCTET STRING
    assert!(rejected(&reencode(no_bit_string)));
}

// ── Package files ───────────────────────────────────────────────────────────

#[test]
fn package_files() {
    // `meta.json`: every member is required.
    let meta = r#"{"name":"Tokens","version":"1.0.0","scope":"network","description":"","depends":[{"name":"Nft","version":"^1.0.0"}],"accounts":["tokens"],"services":["tokens"],"exports":[{"name":"tokens.wit","service":"tokens"}]}"#;
    assert_eq!(reread::<psibase::Meta>(meta), meta);
    assert_eq!(
        reread::<psibase::Meta>(
            r#"{"name":"Tokens","version":"1.0.0","scope":"network","description":"","depends":[],"accounts":[],"exports":[]}"#
        ),
        r#"error: json: missing required member "services" of Meta"#
    );
    // `service/<acct>.json`: `server` and `schema` may be left out.
    assert_eq!(
        reread::<psibase::ServiceInfo>(r#"{"flags":["isPrivileged"]}"#),
        r#"{"flags":["isPrivileged"],"server":null,"schema":null}"#
    );
    assert!(reread::<psibase::ServiceInfo>(r#"{"server":"r-tokens"}"#).starts_with("error: "));
    // An entry of `index.json`.
    let info = format!(
        r#"{{"name":"Tokens","version":"1.0.0","scope":"network","description":"","depends":[],"accounts":[],"services":[],"exports":[],"sha256":"{}","file":"Tokens.psi"}}"#,
        "0F".repeat(32)
    );
    assert_eq!(reread::<psibase::PackageInfo>(&info), info);
    // The digest is read in either case.
    assert_eq!(reread::<psibase::PackageInfo>(&info.replace("0F", "0f")), info);
    // `script/postinstall.json`: `data` is any JSON, kept as written;
    // `rawData` is hex.
    let action = r#"{"sender":"tokens","service":"tokens","method":"init","rawData":null,"data":{"big":18446744073709551616,"n":1.50}}"#;
    assert_eq!(reread::<psibase::PrettyAction>(action), action);
    assert_eq!(
        reread::<psibase::PrettyAction>(r#"{"sender":"tokens","service":"tokens","method":"init","data":{}}"#),
        r#"{"sender":"tokens","service":"tokens","method":"init","rawData":null,"data":{}}"#
    );
    assert_eq!(
        reread::<psibase::PrettyAction>(r#"{"sender":"tokens","service":"tokens","method":"init","rawData":"00"}"#),
        r#"{"sender":"tokens","service":"tokens","method":"init","rawData":"00","data":null}"#
    );
    assert!(reread::<psibase::PrettyAction>(r#"{"sender":"Tokens","service":"tokens","method":"init"}"#)
        .starts_with("error: "));
    // The install manifest: services by account, an object.
    let manifest = r#"{"services":{"tokens":{"flags":[],"server":"r-tokens","schema":null}},"data":[{"account":"tokens","filename":"/index.html"}]}"#;
    assert_eq!(reread::<psibase::PackageManifest>(manifest), manifest);
}

// ── IP addresses and socket endpoints ───────────────────────────────────────

#[test]
fn an_ip_address_is_one_string() {
    use psibase::{IPAddress, IPV4Address, IPV6Address};
    // The cases of the C++ test "json: an IP address is one string".
    let v4 = IPAddress::IPV4Address(IPV4Address { bytes: [127, 0, 0, 1] });
    let mut one = [0u8; 16];
    one[15] = 1;
    let v6 = IPAddress::IPV6Address(IPV6Address { bytes: one, zone: 0 });
    pinned(&v4, r#""127.0.0.1""#);
    pinned(&v6, r#""::1""#);
    assert_eq!(psio::from_ijson::<IPAddress>(r#""127.0.0.1""#).unwrap(), v4);
    assert_eq!(psio::from_ijson::<IPAddress>(r#""::1""#).unwrap(), v6);
    assert_eq!(reread::<IPAddress>(r#""10.1.2.3""#), r#""10.1.2.3""#);
    for wrong in [
        r#""300.1.1.1""#,
        r#""localhost""#,
        r#""""#,
        r#""127.0.0.1:80""#,
        // The variant's own text is not accepted: the text form replaces it.
        r#"{"IPV4Address":{"bytes":"7F000001"}}"#,
        "2130706433",
    ] {
        assert!(reread::<IPAddress>(wrong).starts_with("error: "), "{wrong}");
    }
    // On the wire it stays the variant.
    assert_eq!(psio::to_pssz(&v4)[0], 0);
    assert_eq!(psio::from_pssz::<IPAddress>(&psio::to_pssz(&v6)).unwrap(), v6);

    // The printer and the parser of C++ `SocketInfo.cpp`.
    let v6 = |text: &str| -> IPAddress { text.parse().unwrap_or_else(|e| panic!("{text}: {e}")) };
    let bytes = |address: &IPAddress| match address {
        IPAddress::IPV6Address(a) => a.bytes,
        IPAddress::IPV4Address(_) => panic!("not IPv6"),
    };
    for (text, written) in [
        ("::", "::"),
        ("::1", "::1"),
        ("1::", "1::"),
        ("2001:db8::1", "2001:db8::1"),
        ("2001:0DB8:0000:0000:0000:0000:0000:0001", "2001:db8::1"),
        // The first longest run of zero groups is elided; one group is not.
        ("1:0:0:2:0:0:0:3", "1:0:0:2::3"),
        ("1:0:0:2:0:0:3:4", "1::2:0:0:3:4"),
        ("1:0:2:3:4:5:6:7", "1:0:2:3:4:5:6:7"),
        ("fe80::1%3", "fe80::1%3"),
        ("ff02::1:ff00:42", "ff02::1:ff00:42"),
        // IPv4-mapped.
        ("::ffff:192.168.1.2", "::ffff:192.168.1.2"),
        ("::ffff:c0a8:102", "::ffff:192.168.1.2"),
    ] {
        assert_eq!(v6(text).to_string(), written, "{text}");
        assert_eq!(v6(written), v6(text), "{text}");
    }
    assert_eq!(bytes(&v6("2001:db8::1"))[..4], [0x20, 0x01, 0x0d, 0xb8]);
    assert_eq!(bytes(&v6("1::2"))[..2], [0, 1]);
    assert_eq!(bytes(&v6("1::2"))[14..], [0, 2]);
    for wrong in [
        ":", ":::", "1:2", "1:2:3:4:5:6:7", "1:2:3:4:5:6:7:8:9", "1::2::3", "12345::", "g::",
        "1:2:3:4:5:6:7:8%", "::1%x", "1.2.3", "1.2.3.4.5", "1.2.3.256", " 1.2.3.4", "1.2.3.4 ",
        "+1.2.3.4", "::1]", "[::1]",
    ] {
        assert!(wrong.parse::<IPAddress>().is_err(), "{wrong}");
    }
    // Digits as `std::from_chars` reads them: leading zeros are digits.
    assert_eq!("001.2.3.4".parse::<IPAddress>().unwrap().to_string(), "1.2.3.4");
}

#[test]
fn a_socket_endpoint_is_one_string() {
    use psibase::{IPV4Address, IPV4Endpoint, LocalEndpoint, SocketEndpoint};
    // The cases of the C++ test "json: a socket endpoint is one string".
    let v4 = SocketEndpoint::IPV4Endpoint(IPV4Endpoint {
        address: IPV4Address { bytes: [127, 0, 0, 1] },
        port: 8080,
    });
    let v6: SocketEndpoint = "[::1]:8080".parse().unwrap();
    assert!(matches!(&v6, SocketEndpoint::IPV6Endpoint(e) if e.port == 8080 && e.address.bytes[15] == 1));
    let local = |path: &str| SocketEndpoint::LocalEndpoint(LocalEndpoint { path: path.into() });
    pinned(&v4, r#""127.0.0.1:8080""#);
    pinned(&v6, r#""[::1]:8080""#);
    pinned(&local("/run/psinode.sock"), r#""/run/psinode.sock""#);
    assert_eq!(psio::from_ijson::<SocketEndpoint>(r#""127.0.0.1:8080""#).unwrap(), v4);
    // Text that is not an IP endpoint is the path of a local socket: no
    // string is refused.
    assert_eq!(psio::from_ijson::<SocketEndpoint>(r#""127.0.0.1""#).unwrap(), local("127.0.0.1"));
    assert_eq!(
        psio::from_ijson::<SocketEndpoint>(r#""127.0.0.1:99999""#).unwrap(),
        local("127.0.0.1:99999")
    );
    assert_eq!(psio::from_ijson::<SocketEndpoint>(r#""[::1]""#).unwrap(), local("[::1]"));
    // Anything but a string is.
    assert!(reread::<SocketEndpoint>("8080").starts_with("error: "));
    assert!(reread::<SocketEndpoint>(r#"{"LocalEndpoint":{"path":"x"}}"#).starts_with("error: "));
    // A path without a '/' is written so that it is not read as an address.
    assert_eq!(psio::to_ijson(&local("sock")), r#""./sock""#);
    assert_eq!(psio::to_ijson(&local("")), r#""""#);
    assert_eq!("[fe80::1%2]:443".parse::<SocketEndpoint>().unwrap().to_string(), "[fe80::1%2]:443");
    // As a member, the optional one null or left out: `x-http::sendRequest`.
    type Args = psibase::services::x_http::action_structs::sendRequest;
    let text = r#"{"request":{"host":"h","method":"GET","target":"/","contentType":"","headers":[],"body":""},"tls":null,"endpoint":"127.0.0.1:8080"}"#;
    assert_eq!(reread::<Args>(text), text);
    assert_eq!(
        reread::<Args>(&text.replace(r#","endpoint":"127.0.0.1:8080""#, "")),
        text.replace(r#""127.0.0.1:8080""#, "null")
    );
    // On the wire it stays the variant.
    assert_eq!(psio::to_pssz(&v4)[0], 0);
}
