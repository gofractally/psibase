# Flip interop: every format that crosses the C++ / Rust boundary

Maintained by the C++ side of the PSIO flip (branch `claude/pssz-flip-cpp`).
For each artifact: who produces it, who consumes it, the format today
(legacy `psio1` / fracpack) and the format after the flip (the PSIO type and
the C++ file that defines it). The Rust side (`cargo-psibase`, the `psibase`
CLI, Rust services and plugins) must produce and accept exactly the "after"
column.

Status of this file: sections 0, 0.1, 1, 2, 2.1 and 2.2 are
**definitive**: keys flipped in section 1.18 and the binary wire in
section 1.19 of `doc/pssz-conversion.md`; string kinds were applied in its
section 1.20; schemas flipped in its section 1.21 (stage S2), which
implements the `ServiceSchema` record of section 2. Everything
schema-related in sections 3 and 4 is definitive too (each row says so);
the rest of sections 3–6 states the intended formats and is still to be
confirmed by the C++ stages: S4 (JSON) for sections 3, 4 and 5, S5 for
section 6 (GraphQL). Line numbers in those
sections are from the survey at `bc71f6bb0` and were read, not re-checked
one by one.

PSIO pin for both languages: `e12e4f6df7a2422f893d609848ab06194b75e082`
(`cmake/PsibaseDependencies.cmake`; PSIO `main`, its C++ identical to
`3bf2b94b`, where gaps G42–G45 closed).

## 0. Already in force with the pin (before any flip commit)

**Method numbers.** `psibase::MethodNumber` (C++) is
`psio::detail::method_to_number` (`psio/compress_name.hpp`). At this pin a
name that does not round-trip through the compressed form is its hash
(`#…` form). Eight names used by C++ changed number with the pin move
alone:

| Name | Declared in | Before (`c6d99404`) | Now (`b5cea0d4`) |
|---|---|---|---|
| `checkFirstAuth` | `Transact.hpp` | `0x02865743c9374c7c` | `0xcd29c38cde224f8e` |
| `cpu_min_unit` | `VirtualServer.hpp` | `0x0e7af790922c457d` | `0x13fb233a1d98cbd8` |
| `frozenAccounts` | `RAccounts.cpp` (query field) | `0xda8039f811aaaad5` | `0x27303f52c1c094da` |
| `get_resources` | `VirtualServer.hpp` | `0xb2a0545cdfc9f9c0` | `0xd5137f98107c0181` |
| `getSymbolType` | `Symbol.hpp` | `0x7ea96086faa7f7c0` | `0xd55df3070b8758eb` |
| `regEvIdx` | `Transact.hpp` | `0x0040b0a625283b52` | `0x413db64868a8ec0f` |
| `removeCallback` | `Transact.hpp`, `XTransact.hpp` | `0x8a0905b7cb153252` | `0x978d530fdfe275cb` |
| `rowsBySecondary` | `serveGraphQL.hpp` (comment only) | `0xf0817995f79ba054` | `0x83a92f4d480665a6` |

(Computed by a probe over the 426 method names in the C++ tree; Rust and JS
names were not checked.) **Rust must compute the same numbers**: its
`psibase_names` method coder has to be PSIO's (`psio::compress_name`). Until
it does, every Rust client of a C++ service that calls one of these fails;
in particular the Rust CLI's boot (`psibase boot`) and the Rust tester call
`transact::regEvIdx` and get "unknown service action: regevidzts". This is
what fails in the baseline test run on this pin (section 1.17 of
`doc/pssz-conversion.md`).

**Exact spelling.** A hashed method name is the hash of its exact bytes
(the coder is case-sensitive on the hash path). Wherever a `method` string
appears in JSON — `postinstall.json`, client requests, test scripts — it
must be spelled exactly as the service declares it (`regEvIdx`, not
`regevidx`). Since the merge of `7ae0dde70` Rust's `MethodNumber`, the
service macros and Python's `name.py` follow the same rule, and the method
half of `rust/psibase_names` is gone.

## 0.1 Division of labour and cross-language rules

* **Parameter names.** Action arguments in JSON are keyed by the
  *implementation's* parameter names: for a service implemented in Rust,
  the Rust names verbatim. The Rust side renames the parameters in the C++
  mirror headers of Rust services (about 60 places) and removes
  leading-underscore public names in Rust. The C++ side does not edit
  parameter names in mirror headers of Rust services.
* **Variants.** C++ labels the alternatives of a variant `"0"`, `"1"`, …
  with an `ijsonName` attribute; Rust labels them by the enum variant's
  identifier. Until PSIO settles one rule, a comparison of a C++ schema
  with a Rust schema uses `psio::pssz_ir::compare::wire` (bytes only); a
  comparison within one language — `Packages::setSchema` of a service's
  installed schema against its new one, `CHECK_SCHEMA` — uses
  `psio::pssz_ir::compare::contract`.
* **Strings.** Twins must agree on UTF-8 or raw: a Rust `String` is UTF-8,
  a C++ `std::string` is raw unless the member says `attr(m, utf8)`. The
  Rust side sends the list of C++ members that must gain `attr(m, utf8)`;
  the C++ side applies it (string kind only, no size caps). **Applied** in
  commit `45e2318d25fd9ad02d3850f3a3148d0df5da0721` ("String kinds: the
  listed members and parameters are UTF-8"): the list is
  `~/psibase-pssz-build.cpp-utf8-members.tsv` (84 rows: 40 record members,
  44 action / event parameters); 83 were applied and one was already
  annotated (`Memo::contents`); the per-row result is
  `~/psibase-flip-cpp-scratch/utf8/applied.txt`, and
  `doc/pssz-conversion.md` section 1.20 has the counts and consequences.
  Six rows spell a `Tokens` parameter `subAccount` where the mirror header
  says `sub_account`: annotated, not renamed. A value of such a member
  that is not UTF-8 is refused by every validating reader and by the
  packer, in both languages. `libraries/psibase/common/tests/rust-twins.json`
  was regenerated in that commit (13 members of 9 types say `utf8` in
  `schema_ir`; no value's bytes changed): the Rust test has to follow it.
* **`Memo`** is UTF-8, at most 80 bytes: `transparent()` over `std::string`
  with `attr(contents, utf8 | max<80>)`
  (`libraries/psibase/common/include/psibase/Memo.hpp`). It is the one
  bounded type; a record or argument list holding a `Memo` gets a narrower
  inferred pSSZ offset width than one holding a `std::string`.
* **Time** has no psibase-specific form in either language: it is PSIO's
  (`psio/time.hpp`, `docs/time.md`). A time point is its tick count
  (`int64`) in PSSZ, sign-flipped big-endian in a key, and in JSON an
  RFC 3339 `date-time` in UTC written with exactly the unit's fraction
  digits (`"2026-11-22T10:15:30Z"` for seconds, `"…30.123456Z"` for
  microseconds); a reader accepts `Z` or a numeric offset (converted to
  UTC) and extra *zero* fraction digits, and rejects a finer fraction, a
  missing offset and a number. A duration is its tick count everywhere (in
  JSON a number, a decimal string beyond 2^53 − 1).

**Rust status, as relayed by the coordinator** (not checked from this
worktree):

* Rust is pinned to the same PSIO commit as C++.
* Time in Rust is `psio::time`: JSON `…Z`, durations as tick counts, and
  the GraphQL scalars `DateTimeSeconds` / `DateTimeMicroseconds`.
* 20 Rust actions lost the leading underscore of a parameter: the JSON
  name of those arguments changes (the parameter-name rule above).
* The consensus variants use the C++ names.

## 1. Binary values

**Definitive since S1 (the binary wire of C++ flipped; section 1.19 of
`doc/pssz-conversion.md`), except the two rows marked "schema stage".**
Every value below is PSSZ in its automatic profile (`psio::to_pssz`): offset
widths are inferred from the declared types; psibase declares no
`maxDynamicData` cap and no bound except `Memo` (UTF-8, at most 80 bytes).

| Artifact | Producer | Consumers | Format |
|---|---|---|---|
| Action (`psibase::Action`, `block.hpp`) | every caller; the node hands the current action to a service packed (`getCurrentAction`) | services, the node (`call`) | PSSZ of `Action {sender: AccountNumber, service: AccountNumber, method: MethodNumber, rawData: bytes}`. Example (`methods.cpp`, "the bytes of an action"): sender 1, service 2, method 3, rawData `010203` is `1C000000` `0100000000000000` `0200000000000000` `0300000000000000` `1C000000` `010203`. A service checks the action it is handed with `psio::validate_pssz_compatible` and refuses unknown members; the node checks the argument of `call` with `psio::validate_strict` |
| Action arguments (`Action::rawData`) | C++ `psibase/Actor.hpp` (`packMethodArgs`, used by `Actor`, `transactor`, `ActionViewBuilder`, the tester); Rust service wrappers; JS through `/pack_action` | `psibase/dispatch.hpp` (C++ services), Rust dispatch | PSSZ of `psio::reflect<Service>::method_arg_tuple<I>`: the tuple of the parameters' **wire types**, in declaration order. A parameter declared `psio::pssz_view<X>` / `psio::pssz_view<const X>` is an `X`; `std::string_view` is a `std::string`; `std::span<const char>` is a `std::vector<char>`; `const X&` / `X&&` / `X` is an `X`. No method declares a cap or a parameter annotation, so the bytes are those of the plain `std::tuple` of those types (`psio::to_pssz(std::tuple{...})`); a method with no parameters has the bytes of the empty tuple. A caller may pass a view, a `std::string_view`, a span or a value convertible to the parameter: the bytes are the same. The dispatcher validates the bytes (`psio::validate_method_args`; unknown trailing optional members of a record are accepted, as PSSZ's compatible rule says) and aborts with `invalid argument encoding for <method>: <reason>` |
| Return values | C++ `dispatch.hpp` (`psio::call_method_pssz` → `setRetval`); Rust | C++ `Actor.hpp` (`fraccall`), Rust | PSSZ of the result's wire type (a method that returns a view of `X` returns an `X`); nothing is set for `void`. The caller validates what it receives (`value returned from <method> was not serialized as expected`). A result with a `psibaseExport` (table handles) is the PSSZ of the exported value, with the handle list passed beside it as the PSSZ of `std::vector<KvHandle>` |
| Method numbers | `MethodNumber{"name"}` | dispatch | `psio::compress_name` method coder (section 0) |
| Events | C++ `Actor.hpp` `EventEmitter`; Rust event macro | `Events` service (index and SQL), history queries | An action to `events::event` whose `rawData` is the PSSZ of `std::tuple{EventDb db, MethodNumber type, bytes payload}`, where `payload` is the PSSZ of `method_arg_tuple<I>` of the events struct (a byte list: the same bytes as a nested value). The `Events` service validates and reads the payload with the service's schema (`psio::pssz_ir::decode_auto` over `history[name].type` / `merkle[name].type`); a payload that is not a value of that type is not indexed and its SQL columns are errors |
| Table rows | C++ `psibase/Table.hpp` `put`; Rust table macro | same service; foreign readers; `Events`, `Packages`, tester | PSSZ of the row record. A secondary-index entry's value is the primary key as the table's handle sees it (`00` + key). `Table.hpp` reads its rows without validating (a service's own rows) |
| Table keys | C++ `psibase/Table.hpp`; native tables `nativeTables.hpp`; Rust `ToKey` | native KV store; every reader of a table | Every key is `psio::key` (`external/psio/cpp/docs/key-spec.md`, `psio/key.hpp`): `psio::to_key`. Layout of a `DbTables` row key, as bytes: `service` (u64, big-endian) · `table` (u16, big-endian) · `index` (one byte: 0 = primary, 1…255 = secondary, in declaration order) · `psio::key` of the index's key. The first two are `psibase::tablePrefix(service, table)` = `psio::to_key(std::tuple{service, table})`; a record or tuple key is its members concatenated, so a query by the first *n* components is a byte prefix (`psio::key_prefix<Key>(e0, …)`), and the end of a prefix range is `psio::key_prefix_upper_bound`. `ExternTables` (a handle already opened on a service prefix) uses `table` · `index` · key. Native tables: `psio::to_key` of `std::tuple{u16 table, u8 index, …}` (`nativeTables.hpp`). Bytes are the same as before the flip for integers, bool, enums, floats, strings, `vector<u8>` / `vector<i8>`, optionals of multi-byte types, lists of those, tuples, records, `AccountNumber`, `MethodNumber`, time, digests. **They differ** for: a bare `char` and `std::array<char, N>` where `char` is signed; `optional` of any one-byte type; `vector<bool>`; `vector` of a one-byte enum; `vector<optional<one-byte>>`; `vector<char>` with signed `char`. None of these shapes occurs in a key in the C++ tree. The per-column part of an `Events` secondary-index key (internal to that service) is `psio::key` too since S2: `psio::pssz_ir::to_key` of the column's value by its schema type |
| Transaction (`psibase::Transaction`) and its id | clients, C++ tester, Rust | Transact, the node | PSSZ of `Transaction {tapos, actions, claims}`. **The id is SHA-256 of exactly those bytes**: the content of `SignedTransaction::transaction`, without the length that frames it inside the signed transaction (`sha256(signedTrx.transaction.data(), signedTrx.transaction.size())` = `sha256(transaction)`). Signatures (proofs) sign that id. Transact refuses a transaction that is not valid PSSZ or that has members it does not know |
| `SignedTransaction` | clients, C++ tester, Rust | the node (`pushTransaction`), Transact, RTransact (`/push_transaction`, `/login`) | PSSZ of `SignedTransaction {transaction, proofs: list<bytes>, subjectiveData: optional<list<bytes>>}`. `transaction` is declared `psio::shared_pssz<Transaction>`: on the wire **a byte list holding the PSSZ of the transaction** — the same bytes as a `std::vector<char>` member holding `to_pssz(transaction)`, or a `psio::nested<Transaction>` (pinned in `methods.cpp`, "a signed transaction holds its transaction packed"). Every checking reader of a signed transaction validates those bytes as a `Transaction`. `ProcessTransactionArgs::transaction` is the same |
| Genesis transaction (first boot transaction) | C++ `DefaultTestChain.cpp` `pushGenesisTransaction`, `libraries/net/test/test_util.cpp` `makeBoot`; Rust `boot.rs` `genesis_transaction` | native transaction context (psinode, psitest) | PSSZ `SignedTransaction` whose transaction has exactly one action; its `rawData` is the PSSZ of `GenesisActionData` (`nativeTables.hpp`), checked with `psio::validate_strict` (no unknown members, canonical) |
| Boot transactions | C++ `DefaultTestChain.cpp` (`getInitialActions`, `makeTransactions`, `TestChain::boot`), `test_util.cpp` `makeBoot`; Rust `boot.rs` | `Transact::startBoot(list<Checksum256>)`, then each service | PSSZ. `startBoot` is given the ids of the boot transactions: each is SHA-256 of the PSSZ `Transaction`. C++ and Rust must produce identical bytes for identical input. The C++ builders put actions built by `transactor<Service>` (argument rule above) into transactions of about 1 MiB of action data |
| Block header, block id, signatures | C++ only (`BlockContext`, `ForkDb.hpp`) | C++; Rust mirrors of `BlockHeader` / `SignedBlock` | PSSZ of `BlockHeader` / `Block` / `SignedBlock`. **Block id** (`BlockInfo`): SHA-256 of the PSSZ of the `BlockHeader` with `authCode` cleared, then the block number written big-endian over the first four bytes of the digest (unchanged rule; the hashed bytes are PSSZ now). A producer signs `BlockSignatureInfo`: the four bytes `00 CE A8 42` followed by the block id (unchanged). |
| Merkle roots (transaction / event Merkle trees, `psibase::Merkle`, `crypto.hpp`) | the node | light validators, Rust tools | A leaf is SHA-256 of `00` followed by the PSSZ of the value; an inner node is SHA-256 of `01` · left · right (unchanged rule; leaves hash PSSZ now). `psibase::sha256(const T&)` is SHA-256 of `psio::to_pssz(value)` |
| P2P messages, snapshots | C++ only (`libraries/net`, `programs/snapshot`) | C++ only | One byte for the message type, then the PSSZ of the message. `SignedMessage<M>::data`, `BlockMessage::block` and `BlockHeaderMessage::block` are `psio::shared_pssz` members (a byte list holding the PSSZ of the message / block); a signature signs the type byte followed by the PSSZ of the message. Snapshot rows are the PSSZ rows of the tables they copy |
| Host calls with packed arguments (`socketOpen`, `exportHandles` / `importHandles`, `kvPut` of native rows, `call`) | services | the node | PSSZ of the documented argument (`std::tuple{HttpRequest, optional<TLSInfo>, optional<SocketEndpoint>}` for `socketOpen`, `std::vector<KvHandle>` for handles, the native row records of `nativeTables.hpp`). The node validates what a service writes to a native table (`psio::validate_strict` for status, code, config and socket rows) |
| `Packages::setSchema` argument and `InstalledSchemaTable` row | C++ `package.cpp` `setSchema`; Rust `package.rs` `set_schema`, `main.rs` `deploy` | `Packages.cpp`; `Events/src/SchemaCache.cpp`; testers | PSSZ of the `psibase::ServiceSchema` record of section 2 (`psio::to_pssz`), as the one argument `schema` of `setSchema` and as the `schema` member of the row `InstalledSchema{account, schema}`. `setSchema` refuses a schema that is not well-formed (`checkValid`: `pssz_ir::validate_schema`, every node the record names is a type of `types`, event access is `public` / `private`, index paths resolve) and one that is not an upgrade of the installed one (section 2, "Compatibility") |
| `Packages::postinstall(PackageMeta, manifest)` | C++ `package.cpp` `commitInstall`; Rust `package.rs` | `Packages` service | PSSZ of the argument tuple; `PackageMeta` is `packages/user/Packages/include/services/user/Packages.hpp`; the manifest is unchanged (gzip of JSON, section 3) |
| Guest abort on a failed decode | PSIO, in a guest | the node (the action's error message) | Guests are compiled with `-DPSIO_CODEC_ABORT_HANDLER=psibase_psio_codec_abort` (set on the `psio` CMake target for wasm and in the SDK's `psibase-config.cmake`; defined once in `libpsibase`, `common/src/codecAbort.cpp`). A checked decode of invalid bytes (`psio::from_pssz<T>(bytes)`), a value with no encoding, or an overrun aborts the action with the message `<format>: <reason> (at byte <offset>)`, for example `pssz: offset out of range (at byte 12)`. A Rust guest reports its own decode errors |
| Hand-written packed bytes in JS | `common-lib/src/key-conversions.ts` (`publicKeyPairToFracpack`, `signatureToFracpack`) | none in the tree | delete |

## 2. Service schema

One document, in two encodings: I-JSON (files, HTTP) and PSSZ (the
`setSchema` action, the stored row).

**Settled** (PSIO pin `3bf2b94b9f6f2aa3a468d10bb0782edfe8f1b07b`; the C++
definition is `libraries/psibase/common/include/psibase/schema.hpp`,
namespace `psibase`; a probe that builds, writes, reads and packs exactly
this record is `~/psibase-flip-cpp-scratch/schema/service_schema_record.cpp`).
psibase keeps its own record; its members are PSIO Schema IR types
(`psio/schema_ir.hpp`, namespace `psio::schema_types`). PSIO's own
`Interface` / `Func` envelope is **not** used (`types.interfaces` stays
empty): it has no place for tables, keys or event access.

```cpp
struct FieldId {                                   // one component of an index key
   std::vector<std::uint32_t>                   path;       // member indexes from the row type down
   std::optional<std::string>                   transform;  // name of a key transform, if any
   std::optional<psio::schema_types::AnyType>   type;       // the transform's result type, if any
};
PSIO_REFLECT(FieldId, path, attr(transform, utf8), type)

struct TableInfo {
   std::optional<std::string>          name;      // table type name ("AccountTable")
   std::uint16_t                       table;     // table number
   psio::schema_types::AnyType         type;      // row type
   std::vector<std::vector<FieldId>>   indexes;   // [0] is the primary key
};
PSIO_REFLECT(TableInfo, attr(name, utf8), table, type, indexes)

struct EventType {
   psio::schema_types::AnyType type;              // the event's argument list (see below)
   std::string                 access;            // "public" | "private"
};
PSIO_REFLECT(EventType, type, attr(access, utf8))

struct ServiceSchema {
   psibase::AccountNumber                                     service;   // the service's account
   psio::schema_types::Schema                                 types;     // the Schema IR document
   std::map<std::string, psio::schema_types::FunctionType>    actions;   // by action name as declared
   std::map<std::string, EventType>                           history;   // by event name as declared
   std::map<std::string, EventType>                           merkle;
   std::optional<std::map<std::string, std::vector<TableInfo>>> database; // "service" | "writeOnly" | "subjective" | "session"
};
PSIO_REFLECT(ServiceSchema, service, types, attr(actions, keys(utf8)), attr(history, keys(utf8)),
             attr(merkle, keys(utf8)), attr(database, keys(utf8)))
```

Rules:

* Member order is as written; none of the four records is
  `definitionWillNotChange`; no caps or bounds. **Every string of these
  records is UTF-8** (they are identifiers): the keys of the four maps
  (`keys(utf8)`), `EventType.access`, `FieldId.transform`,
  `TableInfo.name`; Rust declares them `String`. (The annotation changes
  no byte of a valid value; it makes readers reject text that is not
  UTF-8, and the schema of the record itself says `utf8` for them.) Rust:
  `BTreeMap<String, _>` for the maps, `Option` where C++ says
  `std::optional`.
* **Order.** The maps are ordered by name (PSIO's map order: the byte
  order of the names). Until the flip C++ ordered `actions`, `history` and
  `merkle` by method number.
* `actions[name]` is `FunctionType{ params, result }`. `params` is the
  Schema IR node of the action's **wire argument list**: what
  `SchemaBuilder::insert<psio::reflect<Service>::method_arg_tuple<I>>()`
  returns — a reference (`Type{"@N"}`) to an `Object` whose members are the
  parameters in order, named by the reflected parameter names, with the
  attribute `tuple=named`; when the reflection names no parameters the
  members are `"0"`, `"1"`, … and the attribute is `tuple=positional`. A
  view / `string_view` / span parameter appears as the type it carries on
  the wire. `result` is absent for `void`, else the node of the result
  type. An action with no parameters has the empty named object.
* `history[name].type` / `merkle[name].type` are the same kind of node for
  the event's parameters. `access` is `"private"` unless the service
  declares the event public.
* The key of `actions` / `history` / `merkle` is the name exactly as
  declared (it is what `MethodNumber{name}` is computed from). Lookup by
  number compares `MethodNumber{key}`.
* `types` is built by one `psio::SchemaBuilder` for the whole service;
  every node referenced from the other members resolves in it.
  `types.package`, `types.interfaces`, `types.worlds`, `types.uses` are
  left empty.
* Custom ids psibase's readers know: `AccountNumber`, `MethodNumber`
  (text adapters), `Action` and `ServiceMethod` (objects presented by
  psibase's schema handlers), and PSIO's own (`string`, `hex`, `char`,
  `json`, time ids, `Memo`, `Precision`, `Decimal`, …).
* **Encodings.** In files and over HTTP (`<Target>-schema.json`,
  `<crate>.schema.json`, `service/<acct>.json`'s `schema` member, the
  install manifest, `GET …/schema`): `psio::to_ijson(schema)`, read with
  `psio::from_ijson<ServiceSchema>` (every member present, `database` may
  be `null`). As the argument of `Packages::setSchema(schema)` and in the
  `InstalledSchemaTable` row (`InstalledSchema{account, schema}`): PSSZ of
  the record (`psio::to_pssz`), like any other argument / row — no JSON
  inside bytes.
* **Compatibility.** `Packages::setSchema` and `CHECK_SCHEMA` compare with
  `psio::pssz_ir::evolves_from` / `equivalent` (`psio/pssz_ir_compare.hpp`):
  `compare::contract` within one language, `compare::wire` across C++ and
  Rust (section 0.1).

Example (a service with `credit(to, amount, memo)`, `getRow(AccountNumber)`
with an unnamed parameter returning `optional<Row>`, `init()`, and one
table), exactly as `psio::to_ijson` writes it at the pin, line breaks
added:

```json
{"service":"svc",
 "types":{"package":{"name":"","version":"","attributes":[]},"interfaces":[],"worlds":[],"uses":[],
  "types":[
   {"name":"@0","type":{"value":{"Object":{"members":[
      {"name":"to","type":{"value":{"Type":{"type":"AccountNumber"}}},"attributes":[]},
      {"name":"amount","type":{"value":{"Type":{"type":"@2"}}},"attributes":[]},
      {"name":"memo","type":{"value":{"Type":{"type":"@3"}}},"attributes":[]}],
     "attributes":[{"name":"tuple","value":"named"}]}}},"attributes":[]},
   {"name":"AccountNumber","type":{"value":{"Custom":{"type":{"value":{"Object":{"members":[
      {"name":"value","type":{"value":{"Type":{"type":"@2"}}},"attributes":[]}],
     "attributes":[{"name":"definitionWillNotChange","value":""}]}}},"id":"AccountNumber"}}},"attributes":[]},
   {"name":"@2","type":{"value":{"Int":{"bits":64,"isSigned":false}}},"attributes":[]},
   {"name":"@3","type":{"value":{"Option":{"type":{"value":{"Type":{"type":"@4"}}}}}},"attributes":[]},
   {"name":"@4","type":{"value":{"Custom":{"type":{"value":{"List":{"type":{"value":{"Type":{"type":"@5"}}}}}},"id":"string"}}},"attributes":[]},
   {"name":"@5","type":{"value":{"Int":{"bits":8,"isSigned":false}}},"attributes":[]},
   {"name":"@6","type":{"value":{"Object":{"members":[
      {"name":"0","type":{"value":{"Type":{"type":"AccountNumber"}}},"attributes":[]}],
     "attributes":[{"name":"tuple","value":"positional"}]}}},"attributes":[]},
   {"name":"@7","type":{"value":{"Option":{"type":{"value":{"Type":{"type":"Row"}}}}}},"attributes":[]},
   {"name":"Row","type":{"value":{"Object":{"members":[
      {"name":"owner","type":{"value":{"Type":{"type":"AccountNumber"}}},"attributes":[]},
      {"name":"n","type":{"value":{"Type":{"type":"@2"}}},"attributes":[]}],"attributes":[]}}},"attributes":[]},
   {"name":"@9","type":{"value":{"Object":{"members":[],"attributes":[{"name":"tuple","value":"named"}]}}},"attributes":[]}],
  "ir_version":1},
 "actions":{
  "credit":{"params":{"value":{"Type":{"type":"@0"}}},"result":null},
  "getRow":{"params":{"value":{"Type":{"type":"@6"}}},"result":{"value":{"Type":{"type":"@7"}}}},
  "init":{"params":{"value":{"Type":{"type":"@9"}}},"result":null}},
 "history":{},"merkle":{},
 "database":{"service":[{"name":"RowTable","table":0,"type":{"value":{"Type":{"type":"Row"}}},
   "indexes":[[{"path":[0],"transform":null,"type":null}]]}]}}
```

The PSSZ of this example is 1336 bytes and validates as `ServiceSchema`;
reading the JSON back and packing gives the same bytes. (Re-run with the UTF-8 annotations: same JSON, same 1336 bytes.) The `@N` names
are the builder's and are not part of the contract: two schemas are
compared with `pssz_ir::equivalent`, not by text.

Status in C++: implemented, member for member, by commit `597441828`
("S2 part 1: ServiceSchema over the PSIO Schema IR") in
`libraries/psibase/common/include/psibase/schema.hpp`; no deviation from
the record above. The example below is pinned as a test
(`libraries/psibase/common/tests/schema.cpp`, "the I-JSON of a service
schema": the same text, natively and in a guest). Two additions that the
record's text did not say, both observed while implementing:

* A method whose result carries table handles (`psibaseExport`, e.g.
  `x-db::open` returning `UniqueKvHandle`) has as `result` the node of what
  it exports (`uint32`: the index into the handle list passed beside the
  return value), as section 1 "Return values" says of the bytes.
* The empty argument list packs to **one byte, `00`** (PSSZ of the empty
  tuple), not to no bytes: `"data":{}` gives `rawData` = `00`.

Differences from today's JSON that every reader will see (observed by
encoding a `psio::schema_types::Schema` with `psio::encode(psio::ijson{}, …)`
at the pin):

* `types` is the Schema IR document: `{"package":…,"interfaces":[],"worlds":[],"uses":[],"types":[{"name","type","attributes"}…],"ir_version":1}`; today it is an object keyed by `@N`;
* every type node is wrapped: `{"value":{"Object":{…}}}`;
* reflected records carry their own (unqualified) name; anonymous types are `@N`;
* variant members are labelled `"0"`, `"1"`, … with an `ijsonName` attribute holding the alternative's text name;
* `std::vector<char>` is `Custom{List{Custom{Int8 unsigned,"char"}},"hex"}`; Rust `Vec<u8>` is `hex` over `Int8` directly (decision D41 still open);
* `AccountNumber` is `Custom{Object{value: u64}[definitionWillNotChange], "AccountNumber"}`;
* a packed member is `Nested{T}` (legacy `FracPack`);
* an unnamed action parameter was `c0`, `c1` in an object; it is positional now and its JSON is an array.

Two schemas of one service built by C++ and by Rust must be *equivalent*
(`psio::pssz_ir::equivalent` with `compare::wire`, section 0.1; gap G33 is
closed). C++ compares schemas in three places, all with
`compare::contract` (they compare a service with itself):
`Packages::setSchema` (rows and event argument lists: `evolves_from`;
index key types: `equivalent`), `CHECK_SCHEMA` in the tester (a C++
service against the schema in its package; if that package was built by
Rust the check would need `compare::wire` — the tester does not know the
language of a package, so `CHECK_SCHEMA` of a C++ mirror of a Rust service
reports variant label and custom id differences), and `test_schema.cpp`
(`schema-schema.json`). A consequence of `evolves_from` every service
author meets: **no offset width may move**. A row or event whose members
are all fixed-size or bounded has a 1- or 2-byte offset width, and
appending an unbounded member (`optional<string>`) to it would make it 4:
refused (`width-changed`). Appending an optional fixed-size member is
accepted; a row that already has an unbounded member (width 4) accepts
any appended optional member.

| Artifact | Path / endpoint | Producer | Consumers | Today | After |
|---|---|---|---|---|---|
| C++ service schema file | `<build>/<Target>-schema.json` | `libraries/psibase/sdk/pack_service.cmake` `psibase_schema`: runs `psitest <target>-schema-gen.wasm --schema`; emitter `psibase/dispatch.hpp` `serviceMain` | `psibase_package(… SCHEMA <file>)` → `generate_service_info.cmake` (text splice, no parsing); Rust `psibase deploy` (`rust/psibase/src/main.rs`) | JSON of legacy `ServiceSchema` | **Done (S2):** `psio::to_ijson(ServiceSchema::make<Service>(service))`, compact, no trailing newline. Generation fails (exit 1, message on stderr) when two types of the service have one unqualified name. The one hand-written file, `packages/user/Nop/src/Nop-schema.json`, was rewritten |
| Rust service schema file | `<target-dir>/wasm32-wasip1/release/<crate>.schema.json` | `rust/cargo-psibase/src/main.rs` `build_service` (runs `psitest <wrapper>.wasm`, `rust/psibase/src/schema.rs` `print_schema_impl`) | `cargo-psibase/src/package.rs` | JSON of Rust `psibase::Schema` (same shape as C++) | the same I-JSON document as the C++ row |
| Schema of the schema | `doc/src/specifications/data-formats/schema-schema.json` | hand-maintained | `packages/psibase_tests/test/test_schema.cpp` | legacy schema JSON | **Done (S2):** the Schema IR (`psio::schema_types::Schema`, I-JSON, pretty-printed) built by `psio::SchemaBuilder().insert<ServiceSchema>("ServiceSchema")`; the test compares it with `pssz_ir::equivalent` (contract) |
| Schema endpoint | `GET <packages>/schema?service=<acct>` | `packages/user/Packages/src/RPackages.cpp` `serveSchema` | Rust CLI and `rpc.rs` `HttpSchemaFetcher`, Packages plugin, EthBridge relayer; Python `programs/psinode/tests/psinode.py` | JSON `ServiceSchema` | **Done (S2):** `psio::to_ijson` of the installed row's schema, `application/json`; 404 with a text body when the service has none |

## 2.1 `DbId`

`psibase::DbId` (`libraries/psibase/common/include/psibase/db.hpp`,
`enum class DbId : uint32_t`; C++ is the authority) is its `u32` in PSSZ
and in a key, unchanged. In JSON it becomes its **name** in both languages
(PSIO's enum rule: the name is written, the name or the number is read);
C++ wrote the number until the JSON flip. The named values, C++ spelling
(Rust's identifiers differ by case convention only):

| Value | C++ name | Rust |
|---|---|---|
| 0 | `service` | `Service` |
| 1 | `writeOnly` | `WriteOnly` |
| 2 | `native` | `Native` |
| 3 | `blockLog` | `BlockLog` |
| 4 | `blockProof` | `BlockProof` |
| 5 | `prevAuthServices` | `PrevAuthServices` |
| 64 | `subjective` | `Subjective` |
| 65 | `nativeSubjective` | `NativeSubjective` |
| 66 | `session` | `Session` |
| 67 | `nativeSession` | `NativeSession` |
| 68 | `temporary` | `Temporary` |

Not named values: `numChainDatabases` (6) is the count of the chain
databases, and `beginIndependent` (64), `endPersistent` (66),
`endIndependent` (68) are range markers that alias `subjective`,
`session` and `temporary`. They stay C++ constants and are not reflected;
**Rust should drop `NumChainDatabases` from its enum** (keep it as a
constant if it needs the count). No C++ database lacks a Rust name and no
name differs in substance.

## 2.2 Custom ids and schema-driven JSON (definitive, S2)

Schema-driven conversion is `psio::pssz_ir` (`json_to_pssz`,
`pssz_to_json`, `validate_pssz`, `decode_auto`, `to_key`) with a
`psio::pssz_ir::CustomHandlers` registry. psibase has two
(`psibase/schema.hpp`, implemented in `common/src/schema.cpp` and
`common/src/trace.cpp`):

* `psibase_types()`: `AccountNumber`, `MethodNumber` — text form and
  invariant from the C++ type (`handlers.add<T>()`).
* `action_types(schemas, onAction)`: the above plus the two ids that are
  presented as JSON **objects**, in both directions:

| Custom id | Wire type | JSON written | JSON read |
|---|---|---|---|
| `Action` | `Object{sender: AccountNumber, service: AccountNumber, method: MethodNumber, rawData: hex}` | `{"sender":"alice","service":"svc","method":"credit","data":{"to":"bob","amount":5,"memo":null}}`: `method` is the action's name as the schema of `service` declares it and `data` its arguments decoded with that schema (through the same registry, so actions nest). When there is no schema for `service`, the action is not in it or the bytes are not its arguments: `"method"` is the text of the number and `"rawData":"<HEX>"` replaces `data` | an object with `sender` (`""` is the null account), `service`, `method` (exactly as declared), and `data` (object keyed by parameter name, or the positional array; packed with the schema of `service`) or `rawData` (hex); `data` wins when both are given. Errors: `invalid account: …`, `Invalid service account …`, `Missing field rawData`, `Cannot find schema for <service>`, `Action not found: <service>::<method>`, `<service>::<method>: <codec error>` |
| `ServiceMethod` | `Object{service: AccountNumber, method: MethodNumber}` | `{"service":"svc","method":"credit"}` (the declared name when the schema of `service` has the method) | the same object |

Both ids are declared in C++ with `PSIO_INVARIANT(Type, fn, "Id")` over a
check that accepts every value (PSIO has no other way to name a record's
schema node); no byte of an `Action` changes. In a schema they are
`Custom{Object{…}, "Action"}` / `Custom{…, "ServiceMethod"}`: **the Rust
declarations must produce the same nodes** for a `contract` comparison
(`wire` ignores custom ids), and `rust-twins.json` `schema_ir` changed
accordingly (one line; no value's bytes). Every other custom id of a
service's own types — `Decimal`, `Precision`, `Memo`, any type with a
text adapter or an invariant — is visible in its schema under the type's
name; a reader without a handler for it reads the wire type (for
`Decimal`: the object of its members, not the decimal string).

## 3. Package files

Container and layout do not change.

| Artifact | Path | Producer | Consumers | Format (today = after unless said) |
|---|---|---|---|---|
| Package archive | `<build>/share/psibase/packages/<Name>.psi` | `pack_service.cmake` `psibase_package`; Rust `cargo-psibase/src/package.rs`; `rust/reserved-names` | C++ `libraries/psibase/common/src/package.cpp` `PackagedService` (tester, `psinode` init / precompile); Rust `rust/psibase/src/package.rs` | zip: `meta.json`, `service/<acct>.wasm`, `service/<acct>.json`, `data/<acct>/<path>`, `script/postinstall.json`; sub-account `a+1` is `service/a/1.*` |
| `meta.json` | in zip | `pack_service.cmake` `write_meta`; cargo-psibase; reserved-names | C++ `package.cpp` → `PackageMeta` (`Packages.hpp`); Rust `Meta`; `make_package_index.sh` (text) | JSON `{name, version, scope, description, depends:[{name,version}], accounts, services, exports:[{name,service}]}`. **Every member must be present** in both languages: C++ reads it with PSIO's JSON reader and Rust's `package::Meta` requires every member too |
| Service info | `service/<acct>.json` | `generate_service_info.cmake`; cargo-psibase | C++ `package.cpp` → `ServiceInfo` (`psibase/package.hpp`); Rust `ServiceInfo` | JSON `{flags:[string], server?: account, schema?: ServiceSchema}`; flags `isPrivileged`, `isVerify`, `isReplacement`. **Done (S2):** `schema` is the I-JSON of section 2; C++ reads the whole file with `psio::from_ijson`-rules (`flags` required; `server` and `schema` may be absent or `null`; unknown members skipped). A file holding a legacy schema is refused: the package does not load |
| Postinstall script | `script/postinstall.json` | `pack_service.cmake` (generated for `INIT` services, or a hand-written file); cargo-psibase | C++ `package.cpp` (`readPostinstall`, `psibase::toAction`); Rust `package.rs` | **Done (S2), definitive.** I-JSON array of `{sender, service, method, rawData?: hex, data?: JSON}` — the `Action` presentation of section 2.2 (`sender`, `service`, `method` are strings and required; `method` exactly as declared). `data` is packed to PSSZ with the schema of `service`, looked up among the packages being installed: `pssz_ir::json_to_pssz(schema.types, actions[name].params, psio::ijson{}, data, …)` with `action_types`, so `data` is an object keyed by parameter name or the positional array (an action whose parameters are unnamed takes the array only), a missing optional argument is absent, a missing required one is an error, and an `Action` nested anywhere in the arguments is again `{sender, service, method, data \| rawData}` packed with the schema of *its* service. A top-level entry with neither `data` nor `rawData` has the arguments `{}`; a nested action must have one of them. `rawData` (hex of PSSZ) is used as it is. The CMake-generated script of an `INIT` service is `[{"sender":"<svc>","service":"<svc>","method":"init","data":{}}]` (no `rawData`: format-neutral). The accounts a script needs are collected by packing it (`onAction`) |
| Package index | `<dir>/index.json` | `make_package_index.sh`; Rust registries | C++ `package.cpp` `DirectoryRegistry` → `PackageInfo`; Rust registries | JSON array of `meta.json` objects plus `file`, `sha256` (every hash changes) |
| Install manifest | argument of `Packages::postinstall`; `GET packages/manifest?package=&owner=` | C++ `package.cpp` `manifest`; Rust `package.rs` | `RPackages.cpp`; Rust CLI; Packages plugin; XAdmin UI | gzip of JSON `{"services":{<acct>:ServiceInfo},"data":[{account, filename}]}`. **Done (S2):** each `ServiceInfo.schema` is the I-JSON of section 2 (the rest of the document is still written by the legacy JSON writer until S4; same text) |
| Local package registration | `POST x-packages/postinstall` (`/preinstall`, `/prerm`, `/postrm`) | `programs/psinode/init.cpp`; C++ tester; `psibase install --local` | `packages/local/XPackages/src/XPackages.cpp` | JSON `LocalPackage`, every member present: the Rust CLI sends `exports` from the flip on (it does not today) |

## 4. HTTP endpoints that pack

| Endpoint | Producer | Consumers | Today | After |
|---|---|---|---|---|
| `POST <service>/pack_action/<method>` | C++ `psibase/servePackAction.hpp`; Rust `rust/psibase/src/serve_http.rs` | `common-lib/src/rpc.ts` `packAction`, `SimpleUI.mjs` | JSON object in; fracpack of the argument tuple out | JSON in (object keyed by parameter name, or positional array; a missing required argument is an error, an unknown one is skipped); PSSZ of `method_arg_tuple` out. Not touched by S2 (typed, no schema involved; its JSON reader is still the legacy one until S4). One consequence of S2: `packages/pack_action/setSchema` cannot read its `schema` argument through the legacy reader and aborts with a message; it works after S4 |
| `GET <service>/action_templates` | C++ `psibase/serveActionTemplates.hpp`; Rust `action_template.rs` | `SimpleUI.mjs` | JSON `{<method>: {<param>: <sample>}}` | same JSON |
| `POST /common/pack/Transaction`, `/common/pack/SignedTransaction` | `packages/user/CommonApi/src/CommonApi.cpp` | `rpc.ts` (`packTransaction`, `packSignedTransaction`, `packAndDigestTransaction`, `signTransaction`) | JSON → fracpack | I-JSON → PSSZ; digests and signatures are over the PSSZ `Transaction`. `Tapos.flags` is omitted by today's clients (`SimpleUI.mjs`); under I-JSON the client must send it |

## 5. JSON conventions (I-JSON, `psio::to_ijson` / `psio::from_ijson`)

Observed at the pin:

* 64-bit integers: bare when |n| ≤ 2^53 − 1, a decimal string beyond; readers accept both for 64-bit; a quoted number for a 32-bit (or smaller) integer is **rejected**;
* bytes (`std::vector<char>`, `std::vector<uint8_t>`, `std::array<uint8_t, N>`): upper-case hex written, either case read;
* `std::optional`: `null` or the value; a missing optional member reads as empty;
* a missing required member is an error; unknown members are skipped; a repeated key: last wins;
* variants: `{"AlternativeTypeName": value}`;
* an unreflected enum is its number; a `PSIO_REFLECT_ENUM` enum is its name (reads the name or the number);
* `std::map<std::string, T>`: an object; other maps: an array of `[key, value]`;
* tuples and pairs: arrays;
* time points: RFC 3339 UTC with exactly the unit's fraction digits (`"2026-11-22T10:15:30Z"`, `"…30.123456Z"`); durations: the tick count;
* `psio::nested<T>`: the inner value's own JSON (legacy `shared_view_ptr<T>` was hex) — this changes the JSON of `SignedTransaction.transaction`;
* types with a text form (`AccountNumber`, `MethodNumber`, `Decimal`, …): one string; `AccountNumber` text is strict;
* NaN and infinities have no text.

## 6. GraphQL (C++ services after S5; names observed with PSIO's engine)

* scalars: `uint32` → `Int`; 64-bit → `UInt64` / `Int64` (bare up to 2^53 − 1); bytes and digests → `Bytes`; time points → `DateTimeSeconds` / `DateTimeMicroseconds`; `AccountNumber`, `MethodNumber`, `Decimal`, `Memo`, `Precision` → named scalars;
* input objects are `<Type>Input` (legacy `<Type>_Input`);
* connections: `<Node>Connection` / `<Node>Edge`; cursors are upper-case hex of the key (as today); `startCursor` / `endCursor` are `null` on an empty page (legacy `""`); `first` together with `last` and a malformed cursor are errors;
* errors: `{"data":…,"errors":[{"message","locations","path"}]}`.

Rust services keep their own GraphQL engine; where a client reads both a C++
and a Rust service, the scalar names above are what C++ will expose.
