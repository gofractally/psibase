# Flip interop: every format that crosses the C++ / Rust boundary

Maintained by the C++ side of the PSIO flip (branch `claude/pssz-flip-cpp`).
For each artifact: who produces it, who consumes it, the format today
(legacy `psio1` / fracpack) and the format after the flip (the PSIO type and
the C++ file that defines it). The Rust side (`cargo-psibase`, the `psibase`
CLI, Rust services and plugins) must produce and accept exactly the "after"
column.

Status of this file: **first version, written from a survey before any flip
commit.** Rows marked *(proposed)* state the intended format; they become
definitive when the corresponding C++ stage (S1–S5) lands. Line numbers are
from the survey at `bc71f6bb0` and were read, not re-checked one by one.
Definitive so far: section 0 and the "Table keys" row of section 1 (keys
flipped, section 1.18 of `doc/pssz-conversion.md`).

PSIO pin for both languages: `b5cea0d44613740f75fd5c3a428e406908ea9afc`
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

| Artifact | Producer | Consumers | Today | After the flip |
|---|---|---|---|---|
| Genesis transaction (first boot transaction) | C++ `libraries/psibase/tester/src/DefaultTestChain.cpp` `pushGenesisTransaction`; Rust `rust/psibase/src/boot.rs` `genesis_transaction` (`psibase boot`, XAdmin UI wasm) | native transaction context (psinode, psitest) | fracpack `SignedTransaction` → `Transaction` → `Action.rawData` = fracpack `GenesisActionData` | PSSZ of the same records: `psibase::SignedTransaction`, `Transaction`, `Action` (`libraries/psibase/common/include/psibase/block.hpp`), `GenesisActionData` (`nativeTables.hpp`). `SignedTransaction::transaction` is `psio::nested<Transaction>` (a byte list holding the PSSZ of the transaction) *(proposed; PSIO gap G26)* |
| Boot transactions | C++ `DefaultTestChain.cpp` (`getInitialActions`, `makeTransactions`, `TestChain::boot`), `libraries/net/test/test_util.cpp` `makeBoot`; Rust `boot.rs` (`get_initial_actions`, `create_boot_transactions`) | `Transact::startBoot`, then each service | fracpack; transaction id = SHA-256 of the packed `Transaction` | PSSZ; id = SHA-256 of the PSSZ `Transaction`. C++ and Rust must produce identical bytes for identical input |
| Action arguments (`Action::rawData`) | every caller: C++ `psibase/Actor.hpp` proxies; Rust service wrappers; JS through `/pack_action` | `psibase/dispatch.hpp` (C++ services), Rust dispatch | fracpack of the tuple of parameter types (a `view<T>` parameter is packed as `T`) | PSSZ of `psio::reflect<Service>::method_arg_tuple<I>`, with a view parameter replaced by the type it views (`psibase/MethodArgs.hpp`) *(proposed; PSIO gap G29)*. No caps declared, so the tuple's offset width is the inferred one |
| Return values | C++ `dispatch.hpp` `setRetval`; Rust | C++ `Actor.hpp` (`fraccall`), Rust | fracpack of the result type | PSSZ of the result type |
| Method numbers | `MethodNumber{"name"}` | dispatch | psibase legacy coder | `psio::compress_name` method coder (section 0) |
| Table rows | C++ `psibase/Table.hpp` `put`; Rust table macro | same service; foreign readers; `Events`, `Packages`, tester | fracpack of the row record | PSSZ of the row record |
| Table keys | C++ `psibase/Table.hpp`; native tables `nativeTables.hpp`; Rust `ToKey` | native KV store; every reader of a table (same service, foreign readers, `Events`, tester, snapshot tools) | `psio1::convert_to_key` | **Definitive (done in C++, section 1.18 of `doc/pssz-conversion.md`).** Every key is `psio::key` (`external/psio/cpp/docs/key-spec.md`, `psio/key.hpp`): `psio::to_key`. Layout of a `DbTables` row key, as bytes: `service` (u64, big-endian) · `table` (u16, big-endian) · `index` (one byte: 0 = primary, 1…255 = secondary, in declaration order) · `psio::key` of the index's key. The first two are `psibase::tablePrefix(service, table)` = `psio::to_key(std::tuple{service, table})`; a record or tuple key is its members concatenated, so a query by the first *n* components is a byte prefix (`psio::key_prefix<Key>(e0, …)`), and the end of a prefix range is `psio::key_prefix_upper_bound`. A secondary-index entry's value is the primary-index key as `Table.hpp` writes it through the table's handle: `00`, then the primary key (the handle supplies `service` · `table`). `ExternTables` (a handle already opened on a service prefix) uses `table` · `index` · key. Native tables: `psio::to_key` of `std::tuple{u16 table, u8 index, …}` (`nativeTables.hpp`). Bytes are the same as before the flip for integers, bool, enums, floats, strings, `vector<u8>` / `vector<i8>`, optionals of multi-byte types, lists of those, tuples, records, `AccountNumber`, `MethodNumber`, time, digests. **They differ** for: a bare `char` and `std::array<char, N>` where `char` is signed (legacy flipped the sign bit, PSIO writes the byte); `optional` of any one-byte type (`bool`, `u8`, `i8`, `char`, a one-byte enum: legacy folded presence into the byte, PSIO writes `00` / `01` + value); `vector<bool>`; `vector` of a one-byte enum; `vector<optional<one-byte>>`; `vector<char>` with signed `char`. **None of these shapes occurs in a key in the C++ tree**: a compile-time probe over every key type that reaches `Table.hpp`, `kvPut` / `kvGet` / … of `api.hpp` and the tester found no instance in any service, test or tool, and the native keys are tuples of `u16`, `u8`, `u64`, `i32`, `u32`, `AccountNumber`, `Checksum256`, a one-byte enum (not optional) and `std::string`. So no C++ table changed its key bytes; Rust must still use the PSIO forms above if a Rust table has such a key. One exception to "every key": the per-column part of an `Events` secondary-index key is still written by the legacy schema walker (`psio1/schema.hpp`, flips with schemas); it is internal to `Events` (written by `EventIndex.cpp`, queried by `REvents.cpp`) |
| Events | C++ `Actor.hpp` `EventEmitter`; Rust event macro | `Events` service (index and SQL), history queries | fracpack of the event's parameter tuple | PSSZ of `method_arg_tuple<I>` of the events struct |
| `Packages::setSchema` argument and `InstalledSchemaTable` row | C++ `libraries/psibase/common/src/package.cpp` `setSchema`; Rust `package.rs` `set_schema`, `main.rs` `deploy` | `Packages.cpp` `setSchema` / `getSchema`; `Events/src/SchemaCache.cpp`; C++ tester; Rust tester `ChainSchemaFetcher` | fracpack of `psibase::ServiceSchema` | PSSZ of the new `psibase::ServiceSchema` record (section 2) *(proposed)* |
| `Packages::postinstall(PackageMeta, manifest)` | C++ `package.cpp` `commitInstall`; Rust `package.rs` | `Packages` service | fracpack; manifest is gzip of JSON | PSSZ of `PackageMeta` (`packages/user/Packages/include/services/user/Packages.hpp`); manifest unchanged (gzip of JSON, section 3) |
| Blocks, P2P messages, snapshots | C++ only (`libraries/net`, `ForkDb.hpp`, `programs/snapshot`) | C++ only | fracpack | PSSZ. Not a Rust concern, except `SignedBlock` / `BlockHeader` mirrors read by Rust tools |
| Hand-written packed bytes in JS | `common-lib/src/key-conversions.ts` (`publicKeyPairToFracpack`, `signatureToFracpack`) | none in the tree | fracpack by hand | delete |

## 2. Service schema

One document, in two encodings: I-JSON (files, HTTP) and PSSZ (the
`setSchema` action, the stored row).

*(proposed — the C++ definition will be `libraries/psibase/common/include/psibase/schema.hpp`)*

```
ServiceSchema {
   service  : AccountNumber                       // the service's account
   types    : psio::schema_types::Schema          // PSIO Schema IR
   actions  : map<string, psio::schema_types::FunctionType>
                                                  // params = the Schema IR node of method_arg_tuple<I>
                                                  //   (Object, attribute tuple=named; unnamed parameters:
                                                  //    members "0","1",…, attribute tuple=positional)
   history  : map<string, EventType{ type: psio::schema_types::AnyType, access: string }>
   merkle   : map<string, EventType>
   database : optional<map<string, vector<TableInfo>>>   // "service" | "writeOnly" | "subjective" | "session"
}
TableInfo { name: string, table: u16, type: AnyType, indexes: vector<vector<FieldId>> }
FieldId   { path: vector<u32>, transform: optional<string>, type: optional<AnyType> }
```

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

## 3. Package files

Container and layout do not change.

| Artifact | Path | Producer | Consumers | Format (today = after unless said) |
|---|---|---|---|---|
| Package archive | `<build>/share/psibase/packages/<Name>.psi` | `pack_service.cmake` `psibase_package`; Rust `cargo-psibase/src/package.rs`; `rust/reserved-names` | C++ `libraries/psibase/common/src/package.cpp` `PackagedService` (tester, `psinode` init / precompile); Rust `rust/psibase/src/package.rs` | zip: `meta.json`, `service/<acct>.wasm`, `service/<acct>.json`, `data/<acct>/<path>`, `script/postinstall.json`; sub-account `a+1` is `service/a/1.*` |
| `meta.json` | in zip | `pack_service.cmake` `write_meta`; cargo-psibase; reserved-names | C++ `package.cpp` → `PackageMeta` (`Packages.hpp`); Rust `Meta`; `make_package_index.sh` (text) | JSON `{name, version, scope, description, depends:[{name,version}], accounts, services, exports:[{name,service}]}`. Read by C++ with PSIO's JSON reader: **every member must be present** (a missing required member is an error) |
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
