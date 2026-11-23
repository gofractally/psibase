# Flip interop: every format that crosses the C++ / Rust boundary

Maintained by the C++ side of the PSIO flip (branch `claude/pssz-flip-cpp`).
For each artifact: who produces it, who consumes it, the format today
(legacy `psio1` / fracpack) and the format after the flip (the PSIO type and
the C++ file that defines it). The Rust side (`cargo-psibase`, the `psibase`
CLI, Rust services and plugins) must produce and accept exactly the "after"
column.

Status of this file: sections 0 and 1 are **definitive** (keys flipped in
section 1.18, the binary wire in section 1.19 of `doc/pssz-conversion.md`).
In sections 2–6, rows marked *(proposed)* state the intended format; they
become definitive when the corresponding C++ stage (S2–S5) lands. Line
numbers in those sections are from the survey at `bc71f6bb0` and were read,
not re-checked one by one.

PSIO pin for both languages: `0e6a1b7216a47620b9eafc69c2556b124f3796b0`
(`cmake/PsibaseDependencies.cmake`).

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
  the C++ side applies it (string kind only, no size caps).
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
| Events | C++ `Actor.hpp` `EventEmitter`; Rust event macro | `Events` service (index and SQL), history queries | An action to `events::event` whose `rawData` is the PSSZ of `std::tuple{EventDb db, MethodNumber type, bytes payload}`, where `payload` is the PSSZ of `method_arg_tuple<I>` of the events struct (a byte list: the same bytes as a nested value). **Schema stage:** the `Events` service still walks the payload with the legacy schema decoder until schemas flip |
| Table rows | C++ `psibase/Table.hpp` `put`; Rust table macro | same service; foreign readers; `Events`, `Packages`, tester | PSSZ of the row record. A secondary-index entry's value is the primary key as the table's handle sees it (`00` + key). `Table.hpp` reads its rows without validating (a service's own rows) |
| Table keys | C++ `psibase/Table.hpp`; native tables `nativeTables.hpp`; Rust `ToKey` | native KV store; every reader of a table | Every key is `psio::key` (`external/psio/cpp/docs/key-spec.md`, `psio/key.hpp`): `psio::to_key`. Layout of a `DbTables` row key, as bytes: `service` (u64, big-endian) · `table` (u16, big-endian) · `index` (one byte: 0 = primary, 1…255 = secondary, in declaration order) · `psio::key` of the index's key. The first two are `psibase::tablePrefix(service, table)` = `psio::to_key(std::tuple{service, table})`; a record or tuple key is its members concatenated, so a query by the first *n* components is a byte prefix (`psio::key_prefix<Key>(e0, …)`), and the end of a prefix range is `psio::key_prefix_upper_bound`. `ExternTables` (a handle already opened on a service prefix) uses `table` · `index` · key. Native tables: `psio::to_key` of `std::tuple{u16 table, u8 index, …}` (`nativeTables.hpp`). Bytes are the same as before the flip for integers, bool, enums, floats, strings, `vector<u8>` / `vector<i8>`, optionals of multi-byte types, lists of those, tuples, records, `AccountNumber`, `MethodNumber`, time, digests. **They differ** for: a bare `char` and `std::array<char, N>` where `char` is signed; `optional` of any one-byte type; `vector<bool>`; `vector` of a one-byte enum; `vector<optional<one-byte>>`; `vector<char>` with signed `char`. None of these shapes occurs in a key in the C++ tree. One exception to "every key": the per-column part of an `Events` secondary-index key is still written by the legacy schema walker (flips with schemas) |
| Transaction (`psibase::Transaction`) and its id | clients, C++ tester, Rust | Transact, the node | PSSZ of `Transaction {tapos, actions, claims}`. **The id is SHA-256 of exactly those bytes**: the content of `SignedTransaction::transaction`, without the length that frames it inside the signed transaction (`sha256(signedTrx.transaction.data(), signedTrx.transaction.size())` = `sha256(transaction)`). Signatures (proofs) sign that id. Transact refuses a transaction that is not valid PSSZ or that has members it does not know |
| `SignedTransaction` | clients, C++ tester, Rust | the node (`pushTransaction`), Transact, RTransact (`/push_transaction`, `/login`) | PSSZ of `SignedTransaction {transaction, proofs: list<bytes>, subjectiveData: optional<list<bytes>>}`. `transaction` is declared `psio::shared_pssz<Transaction>`: on the wire **a byte list holding the PSSZ of the transaction** — the same bytes as a `std::vector<char>` member holding `to_pssz(transaction)`, or a `psio::nested<Transaction>` (pinned in `methods.cpp`, "a signed transaction holds its transaction packed"). Every checking reader of a signed transaction validates those bytes as a `Transaction`. `ProcessTransactionArgs::transaction` is the same |
| Genesis transaction (first boot transaction) | C++ `DefaultTestChain.cpp` `pushGenesisTransaction`, `libraries/net/test/test_util.cpp` `makeBoot`; Rust `boot.rs` `genesis_transaction` | native transaction context (psinode, psitest) | PSSZ `SignedTransaction` whose transaction has exactly one action; its `rawData` is the PSSZ of `GenesisActionData` (`nativeTables.hpp`), checked with `psio::validate_strict` (no unknown members, canonical) |
| Boot transactions | C++ `DefaultTestChain.cpp` (`getInitialActions`, `makeTransactions`, `TestChain::boot`), `test_util.cpp` `makeBoot`; Rust `boot.rs` | `Transact::startBoot(list<Checksum256>)`, then each service | PSSZ. `startBoot` is given the ids of the boot transactions: each is SHA-256 of the PSSZ `Transaction`. C++ and Rust must produce identical bytes for identical input. The C++ builders put actions built by `transactor<Service>` (argument rule above) into transactions of about 1 MiB of action data |
| Block header, block id, signatures | C++ only (`BlockContext`, `ForkDb.hpp`) | C++; Rust mirrors of `BlockHeader` / `SignedBlock` | PSSZ of `BlockHeader` / `Block` / `SignedBlock`. **Block id** (`BlockInfo`): SHA-256 of the PSSZ of the `BlockHeader` with `authCode` cleared, then the block number written big-endian over the first four bytes of the digest (unchanged rule; the hashed bytes are PSSZ now). A producer signs `BlockSignatureInfo`: the four bytes `00 CE A8 42` followed by the block id (unchanged). |
| Merkle roots (transaction / event Merkle trees, `psibase::Merkle`, `crypto.hpp`) | the node | light validators, Rust tools | A leaf is SHA-256 of `00` followed by the PSSZ of the value; an inner node is SHA-256 of `01` · left · right (unchanged rule; leaves hash PSSZ now). `psibase::sha256(const T&)` is SHA-256 of `psio::to_pssz(value)` |
| P2P messages, snapshots | C++ only (`libraries/net`, `programs/snapshot`) | C++ only | One byte for the message type, then the PSSZ of the message. `SignedMessage<M>::data`, `BlockMessage::block` and `BlockHeaderMessage::block` are `psio::shared_pssz` members (a byte list holding the PSSZ of the message / block); a signature signs the type byte followed by the PSSZ of the message. Snapshot rows are the PSSZ rows of the tables they copy |
| Host calls with packed arguments (`socketOpen`, `exportHandles` / `importHandles`, `kvPut` of native rows, `call`) | services | the node | PSSZ of the documented argument (`std::tuple{HttpRequest, optional<TLSInfo>, optional<SocketEndpoint>}` for `socketOpen`, `std::vector<KvHandle>` for handles, the native row records of `nativeTables.hpp`). The node validates what a service writes to a native table (`psio::validate_strict` for status, code, config and socket rows) |
| `Packages::setSchema` argument and `InstalledSchemaTable` row | C++ `package.cpp` `setSchema`; Rust `package.rs` `set_schema`, `main.rs` `deploy` | `Packages.cpp`; `Events/src/SchemaCache.cpp`; testers | **Schema stage.** Until schemas flip, `psibase::ServiceSchema` is a PSSZ record whose legacy members (`types`, each action's `FunctionType`, each event's type) are opaque payloads holding their fracpack form (temporary glue in `psio1/schema.hpp`); the schema-driven packers (`package.cpp`, `trace.cpp`, `/pack_action` through a schema) still emit fracpack. After: PSSZ of the new `psibase::ServiceSchema` record (section 2). The C++ declaration of `setSchema` now names its one parameter (`schema`); it listed two names before |
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

Status in C++: the header still holds the legacy (`psio1`) definition
until the rest of stage S2 lands; the record above is what it becomes,
member for member.

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

Two schemas of one service built by C++ and by Rust must be *equivalent*;
PSIO C++ has no runtime schema comparison (gap G33), so this cannot be
checked from C++ yet.

| Artifact | Path / endpoint | Producer | Consumers | Today | After |
|---|---|---|---|---|---|
| C++ service schema file | `<build>/<Target>-schema.json` | `libraries/psibase/sdk/pack_service.cmake` `psibase_schema`: runs `psitest <target>-schema-gen.wasm --schema`; emitter `psibase/dispatch.hpp` `serviceMain` | `psibase_package(… SCHEMA <file>)` → `generate_service_info.cmake` (text splice, no parsing); Rust `psibase deploy` (`rust/psibase/src/main.rs`) | JSON of legacy `ServiceSchema` | I-JSON (`psio::ijson`) of `ServiceSchema` above |
| Rust service schema file | `<target-dir>/wasm32-wasip1/release/<crate>.schema.json` | `rust/cargo-psibase/src/main.rs` `build_service` (runs `psitest <wrapper>.wasm`, `rust/psibase/src/schema.rs` `print_schema_impl`) | `cargo-psibase/src/package.rs` | JSON of Rust `psibase::Schema` (same shape as C++) | the same I-JSON document as the C++ row |
| Schema of the schema | `doc/src/specifications/data-formats/schema-schema.json` | hand-maintained | `packages/psibase_tests/test/test_schema.cpp` | legacy schema JSON | regenerated from the new record |
| Schema endpoint | `GET <packages>/schema?service=<acct>` | `packages/user/Packages/src/RPackages.cpp` `serveSchema` | Rust CLI and `rpc.rs` `HttpSchemaFetcher`, Packages plugin, EthBridge relayer; Python `programs/psinode/tests/psinode.py` | JSON `ServiceSchema` | the new I-JSON |

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

## 3. Package files

Container and layout do not change.

| Artifact | Path | Producer | Consumers | Format (today = after unless said) |
|---|---|---|---|---|
| Package archive | `<build>/share/psibase/packages/<Name>.psi` | `pack_service.cmake` `psibase_package`; Rust `cargo-psibase/src/package.rs`; `rust/reserved-names` | C++ `libraries/psibase/common/src/package.cpp` `PackagedService` (tester, `psinode` init / precompile); Rust `rust/psibase/src/package.rs` | zip: `meta.json`, `service/<acct>.wasm`, `service/<acct>.json`, `data/<acct>/<path>`, `script/postinstall.json`; sub-account `a+1` is `service/a/1.*` |
| `meta.json` | in zip | `pack_service.cmake` `write_meta`; cargo-psibase; reserved-names | C++ `package.cpp` → `PackageMeta` (`Packages.hpp`); Rust `Meta`; `make_package_index.sh` (text) | JSON `{name, version, scope, description, depends:[{name,version}], accounts, services, exports:[{name,service}]}`. **Every member must be present** in both languages: C++ reads it with PSIO's JSON reader and Rust's `package::Meta` requires every member too |
| Service info | `service/<acct>.json` | `generate_service_info.cmake`; cargo-psibase | C++ `package.cpp` → `ServiceInfo` (`psibase/package.hpp`); Rust `ServiceInfo` | JSON `{flags:[string], server?: account, schema?: ServiceSchema}`; flags `isPrivileged`, `isVerify`, `isReplacement`. After: `schema` is the new I-JSON |
| Postinstall script | `script/postinstall.json` | `pack_service.cmake` (generated for `INIT` services, or a hand-written file); cargo-psibase | C++ `package.cpp` (`readPostinstall`, `to_action`); Rust `package.rs` | JSON array of `{sender, service, method, rawData?: hex, data?: JSON}`. After: `data` is packed to PSSZ with the target service's schema (action arguments as an object keyed by parameter name, or an array). The CMake-generated `"rawData":"0000"` (fracpack of no arguments) is replaced by `"data":{}`; any hand-written `rawData` hex must be re-encoded |
| Package index | `<dir>/index.json` | `make_package_index.sh`; Rust registries | C++ `package.cpp` `DirectoryRegistry` → `PackageInfo`; Rust registries | JSON array of `meta.json` objects plus `file`, `sha256` (every hash changes) |
| Install manifest | argument of `Packages::postinstall`; `GET packages/manifest?package=&owner=` | C++ `package.cpp` `manifest`; Rust `package.rs` | `RPackages.cpp`; Rust CLI; Packages plugin; XAdmin UI | gzip of JSON `{"services":{<acct>:ServiceInfo},"data":[{account, filename}]}`; after: new-format schemas inside |
| Local package registration | `POST x-packages/postinstall` (`/preinstall`, `/prerm`, `/postrm`) | `programs/psinode/init.cpp`; C++ tester; `psibase install --local` | `packages/local/XPackages/src/XPackages.cpp` | JSON `LocalPackage`, every member present: the Rust CLI sends `exports` from the flip on (it does not today) |

## 4. HTTP endpoints that pack

| Endpoint | Producer | Consumers | Today | After |
|---|---|---|---|---|
| `POST <service>/pack_action/<method>` | C++ `psibase/servePackAction.hpp`; Rust `rust/psibase/src/serve_http.rs` | `common-lib/src/rpc.ts` `packAction`, `SimpleUI.mjs` | JSON object in; fracpack of the argument tuple out | JSON in (object keyed by parameter name, or positional array; a missing required argument is an error, an unknown one is skipped); PSSZ of `method_arg_tuple` out |
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
