# Converting psibase from fracpack to PSIO / PSSZ

This document records the first three slices of the conversion, slices 4a,
2b and 4b and the follow-up to them on a newer PSIO (sections 1.13, 1.14)
(branch `claude/pssz`), the pattern they established, everything that
remains, a proposed order for the remaining slices, the decisions that need
the owner's confirmation, and the places where PSIO lacks something psibase
needs. Section 6.25 is the handover: the current state and how to verify it. Section 6 is the Rust side: the survey, the plan in slices R1–R9, the
old → new mapping, what PSIO's Rust crate lacks, slice R1 (6.10), what of
slices R2 and R3 could be done and what waits (6.13, 6.14) and the
C++ ↔ Rust cross-check (6.15); sections 6.11 and 6.12 are JavaScript and
Python.

End state: one serialization library, [gofractally/psio](https://github.com/gofractally/psio).
No in-tree copy, no fracpack, no compatibility layer. PSSZ on the wire, PSIO's
`key` format for database keys, I-JSON (`psio::ijson`) for clients, PSIO's
Schema IR for schemas. No chain data is migrated (fresh genesis).

## 0. Where the tree is after slices 1–3, 4a, 2b, 4b and the follow-up

| | |
|---|---|
| Legacy library | `libraries/psio1`: include prefix `<psio1/…>`, namespace `psio1`, macros `PSIO1_…`, CMake target `psio1`, archive `libpsio1.a`. It is deleted at the end of the conversion. |
| PSIO | **Now `0e6a1b7216a47620b9eafc69c2556b124f3796b0` (sections 6.23, 6.25).** Before: `gofractally/psio` at `c6d9940441463c7ba3b6087595770a765f5fffac` (section 1.16; before that `415ea1a6`), pinned in `cmake/PsibaseDependencies.cmake`, fetched to `external/psio`. (Slices 1–4a were built on `e6901feb`; slices 2b and 4b on `86cf8c0f` / `868e37bb`, whose `cpp/`, `cmake/` and `CMakeLists.txt` are identical; the follow-up of section 1.13 on `dfd0db17`, a topic branch; the pin moved to `main` in section 1.14, `224f80de`, and along it in section 1.15.) |
| Since (sections 1.16, 6.16–6.20) | The integration head `44c57f739` is merged and the pin is `c6d99404`; ctest's baseline is 93. Rust: `Hex<T>` is `transparent` (D29 revised) and 44 of the 78 core records are declared; the stale Rust mirrors of D36 are corrected; the service macro can declare a service's actions as a PSIO interface (`psio = true`, three services); the C++ ↔ Rust fixture has 50 types, 115 values, legacy bytes for each, two service interfaces and 18 calls. |
| Rust | The `psio` crate is a path dependency into the pinned checkout (`external/psio/rust/psio`). Declared with the official PSIO derives beside the legacy ones, which still write every byte: `AccountNumber`, `MethodNumber` (R1, 6.10); `Memo`, `tokens::Precision`, `Quantity`, `Decimal` (R2, 6.13); 20 core records of `rust/psibase/src` (R3, 6.14). 26 types are proved equal to their C++ twins through one fixture (6.15). Waiting, each for a stated reason: the time types and `Hex<T>` / `Checksum256` and every record that holds one (the JSON flip), 56 core records in all. Two behaviour changes: the name parsers no longer panic on malformed text (D30), and `Quantity::from_str` rejects a quantity over 2^64 − 1 (D17) and a fraction of 256 or more digits (D38). |
| Native | `libraries/CMakeLists.txt` calls `psibase_acquire_dependency(psio)`; `psibase` and `psio1` link `psio::psio`. PSIO fetches simdjson 5.2.0 by URL and SHA-256; configuration fails if any other simdjson target exists first. PSIO's own install rules are excluded from psibase's install tree. |
| Guests | The `wasm/` project defines an INTERFACE target `psio` (`psio::psio`) over the same source tree: `PSIO_EXCEPTIONS_ENABLED=0`, `PSIO_HAVE_SIMDJSON=0`. The SDK installs PSIO's headers (`include/psio`, `include/psio/external/xxhash.h`); `psibase-config.cmake{,.build}` define the same target for SDK consumers. |
| Slice 1: leaf types | `AccountNumber`, `MethodNumber`; `Seconds`, `MicroSeconds`, `TimePointSec`, `TimePointUSec`; `Checksum160/256/512` (sections 1.1–1.3). |
| Slice 2: data records | 416 records moved from `PSIO1_REFLECT` to `PSIO_REFLECT` in 106 files. With slice 1's and the tests' own, the tree has 422 data declarations with `PSIO_REFLECT` in 111 files (`libraries/psibase` 107, `libraries/net` 33, `libraries/psibase_http` 1, `programs/*` 20, `packages/system` 75, `packages/user` 105, `packages/local` 37, `packages/psibase_tests` 43, `tests/cmake` 1); 122 table names declared with `PSIO_REFLECT_TYPENAME` in 37 files. 10 records deferred (section 1.9). |
| Slice 3: services | 124 `PSIO_REFLECT` declarations with methods in 108 files (every C++ service, its events, the query roots and the interfaces), 528 `method(...)` items, plus 15 `PSIBASE_REFLECT_{HISTORY,MERKLE}_EVENTS` sites (28 items), which now expand to `PSIO_REFLECT`. No service is deferred. |
| Slice 4a: method consumers | Everything psibase derives from a class's methods reads `psio::reflect<T>` directly: the call proxies (`Actor`, `transactor`, `EventEmitter`, `ActionViewBuilder`, the tester's `ServiceUser`) are `psio::reflect<T>::proxy<P>`; `dispatch` finds the action with `index_of_method_hash` and calls it with `invoke_method`; the action and event part of the service schema, `/pack_action`, `/action_templates` use `for_each_method` and `method_param_names<I>` (section 1.10). GraphQL still reads methods through `psio1` (slice 9). |
| Slice 2b: the deferred records | 15 declarations: `Memo` and `Precision` are `transparent()` wrappers with an `invariant`; `Decimal` is a record with a text adapter; `XAdmin::Auth::Account`, `LocalUsername` and `AuthSig::PrivateKeyInfo` are `transparent()` wrappers; `TimerRow`, `UrlRow`, `TimerQueueRow`, `ServiceSchema`, `DynDepGroups`, `PsinodeServiceConfig`, `TypedAction<T>` and the two records of `debug_eos_vm` changed macro only (section 1.11). |
| Slice 4b: data-member consumers | Everything psibase derives from a record's data members reads `psio::reflect<T>` directly: table keys and views (`Table.hpp`), table and key schemas (`schema.hpp`), `zip.cpp`, query strings (`Rpc.hpp`), `jwt.hpp`, XAdmin's option names, the data-member parts of `serveGraphQL.hpp` (section 1.12). Nothing outside `libraries/psio1` names `psio1::reflect`, `psio1::Reflected`, `MemberList`, `MemberPtrType`, `for_each_member`, `get_data_member` or `psio1::get_type_name`. |
| Follow-up on PSIO `dfd0db17` | Section 1.13. `Precision`'s rejection names the value again (G21): no behaviour change of slice 2b is left. GraphQL names are `psio::fixed_string` (G19), key member lookup and key flattening use `index_of_member` / `member_types` (G20), `flatten_key` asks `psio::Reflected<T>` alone (G22), keyword-only includes removed (G14); `psio1::reflected_name` deleted, `psio1::FixedString` no longer named outside `psio1`. One owner-approved behaviour change: `Decimal::fromStr` rejects a quantity over 2^64 − 1 instead of wrapping (D17). |
| Still declared with the legacy macro | 5 `PSIO1_REFLECT` sites and 1 `PSIO1_REFLECT_TYPENAME`, all in `rust/test_fracpack/tests/test.hpp` (the legacy library's own C++/Rust cross-check, deleted with it). Not reflected at all and still on legacy ADL hooks: `SubjectPublicKeyInfo`, `IPAddress`, `SocketEndpoint` (section 1.9). |
| Temporary glue | Only in `libraries/psio1` (section 1.5). Every block is marked `// TEMPORARY: removed when psio1 is deleted`. |
| Unchanged | Every wire, key, JSON and schema byte psibase produces (one text is no longer read: a `Decimal` whose quantity does not fit 64 bits, D17): everything is still packed, keyed, written as JSON, described and dispatched by `psio1`, which reads the PSIO declarations through the glue. Evidence: after every slice all 68 generated `*-schema.json` files are byte-identical to the build before it (slices 2b, 4b and the follow-up: to the build of 0167a3056); pinned bytes, keys, JSON, GraphQL and schemas in `canonical_glue_tests.cpp` (sections 1.8, 1.10–1.12). |
| Tests | ctest 92/92 after each slice, 2b, 4b, the earlier pin moves and the follow-up included; 92/92 again on the pin of 1.15 and after each of R1, R2 and R3. On the pin of section 1.14 no single run was clean (91/92 three times: an intermittent failure of `psinode_test_crash` in the storage engine; every test passed in some run; see there). `psio-tests`: 67 test cases natively, 26 in the guest (2 added in 2b: the legacy forms of the 2b types, pinned before they were re-declared). `psibase-psio-tests`: 37 test cases, native and guest (7 added in 2b, `wrappers.cpp`; 2 in 4b, `tables.cpp`; 1 in the follow-up, the `Decimal` boundary). |

## 1. The conversion pattern

A converted header includes only `<psio/…>` headers, declares the type with
PSIO's own macros, and contains nothing for the legacy library. (That is the
state of the leaf headers of slice 1. A header converted in slices 2–3 has
moved its declarations; whatever else it uses of the legacy library — packing
calls, views, JSON hooks — stays until the flips.) While the two
libraries coexist, `psio1` recognises PSIO-declared types by itself (1.5).

Tests for converted types are `libraries/psibase/common/tests/leaf_types.cpp`
(permanent; native and WASM guest, target `psibase-psio-tests`): exact PSSZ
bytes, key bytes and order, I-JSON in both directions, schema IR ids, the
schema-driven codecs, rejection of invalid input. `psio.cpp` beside it checks
the PSIO build profile itself in both environments.

### 1.1 A compressed name over a `u64` (`AccountNumber`, `MethodNumber`)

Before:

```cpp
#include <psio1/from_json.hpp>
#include <psio1/to_json.hpp>
struct AccountNumber {
   uint64_t value = 0;
   ...
   PSIO1_REFLECT(AccountNumber, definitionWillNotChange(), value)
};
template <typename S> void to_json(const AccountNumber& n, S& s) { to_json(n.str(), s); }
template <typename S> void from_json(AccountNumber& r, S& s) { r = AccountNumber{s.get_string()}; }
inline constexpr bool use_json_string_for_gql(AccountNumber*) { return true; }
inline constexpr bool psio_custom_schema(AccountNumber*) { return true; }
```

After:

```cpp
#include <psio/adapter.hpp>
#include <psio/reflect.hpp>
struct AccountNumber {
   uint64_t value = 0;
   ...
   PSIO_REFLECT(AccountNumber, definitionWillNotChange(), value)
};
struct AccountNumberText {                      // the text form
   static constexpr std::string_view schema_id = "AccountNumber";
   static std::size_t        packsize(const AccountNumber&);
   static void               encode(const AccountNumber&, std::string&);
   static AccountNumber      decode(std::span<const char>);
   static psio::codec_status validate(std::span<const char>) noexcept;
   static psio::codec_status validate_strict(std::span<const char>) noexcept;
};
// at global scope:
PSIO_ADAPTER(psibase::AccountNumber, psio::text_category, psibase::AccountNumberText)
```

What PSIO then defines, with no further code:

| | `AccountNumber{"alice"}` |
|---|---|
| PSSZ | the reflected record, fixed layout: the `u64`, little-endian, 8 bytes, no header: `00b82a1b83aedf04` |
| key | the record's key = its field's key: the `u64`, big-endian: `04dfae831b2ab800`. Byte order is `value` order. No `sortable_binary_category` adapter is needed. |
| ijson | the adapter's text as a JSON string: `"alice"` |
| schema IR | `Custom{ Object{value: Int{64, unsigned}} [definitionWillNotChange], id: "AccountNumber" }`; the schema-driven codecs present it through `pssz_ir::CustomHandlers::add<AccountNumber>()` |

Text is validated on read (PSIO's JSON reader calls `validate`, then `decode`):

* `AccountNumber`: strict. Exactly one text names each account, the one `str()`
  writes. Upper case, characters outside the alphabet, misplaced `-`, more
  than 10 characters, `+0`, `+07`, `+256` are rejected. (The legacy reader
  accepted all of these and mapped most to another account or to 0.)
* `MethodNumber`: every spelling that names a method is read — the written
  form, a source identifier (`setCode`; it compresses or falls back to its
  hash exactly as `MethodNumber{"setCode"}`), and the 17-character `#…` hash
  form. Text that names no method (a character outside the method alphabet,
  a malformed `#` form) is rejected. Three core services
  (Transact, StagedTx, VirtualServer) use `allowHashedMethods()`, and clients
  address actions by identifier, so "one text per value" is not available for
  methods without changing every client.

`MethodNumber` uses `psio::detail::method_to_number` / `number_to_method`
(`psio/compress_name.hpp`), byte-identical to the legacy tables.

### 1.2 Time (`Seconds`, `MicroSeconds`, `TimePointSec`, `TimePointUSec`)

These were already `std::chrono` aliases; they stay `std::chrono` types, which
is PSIO's own model of time (`docs/time.md`). The only change is that
`psibase/time.hpp` includes `<psio/time.hpp>` instead of `<psio1/chrono.hpp>`.

| | `TimePointSec` 2026-11-22T10:15:30Z | `Seconds{5}` |
|---|---|---|
| PSSZ | the `int64` tick count, LE: `c2c0026b00000000` | `0500000000000000` |
| key | sign-flipped big-endian (chronological): `800000006b02c0c2` | `8000000000000005` |
| ijson | RFC 3339 UTC, exactly the unit's fraction digits: `"2026-11-22T10:15:30Z"`; `TimePointUSec`: `"…30.123456Z"` | the tick count: `5` (a string beyond 2^53 − 1) |
| schema IR | `Custom{Int{64, signed}, "time-point-seconds"}` / `"time-point-micros"` | `"duration-seconds"` / `"duration-micros"` |

`MonotonicTimePointSec/USec` (`steady_clock`) remain declared but are not PSIO
values: see gap G2.

### 1.3 Digests and fixed byte arrays (`Checksum160/256/512`)

They remain `std::array<uint8_t, N>` aliases. PSIO treats an array of octets
as a byte sequence: PSSZ and key are the N bytes with no framing, ijson is one
hex string (upper case written, either case read, exactly 2N digits), schema
IR is `Custom{Array{u8, N}, "hex"}`. Nothing is declared in psibase.
(`psio::byte_array<N>` exists for types that must be distinct from
"array of integers"; it is not needed here: see decision D4.)

### 1.4 Kinds of type not converted in slice 1

| Kind | Examples | Canonical form | Why not now |
|---|---|---|---|
| Bounded, validated string | `Memo` (UTF-8, ≤ 80 bytes; 99 uses in 24 files) | `psio::utf8_string<80>` — PSIO enforces the bound and UTF-8 in PSSZ, key and JSON | It changes the member API (`.contents`) at every use and needs `psio1` to pack `utf8_string`; belongs with slice 2. Decision D5. |
| Transparent wrapper with validation and its own text | `SystemService::AuthSig::SubjectPublicKeyInfo` (DER bytes; PEM text; validated on unpack; 116 uses in 38 files) | none today | Gap G3. |
| `std::variant` with a text form | `IPAddress`, `SocketEndpoint` (`SocketInfo.hpp`) | none today | Gap G4. |
| Records | `Action`, `Claim`, `BlockHeader`, … | `PSIO_REFLECT` (in-class or after the type), `definitionWillNotChange()` where it is today, new members appended as `std::optional` | Done in slice 2 (1.6). |
| Record templates | `BasicHttpRequest<Body>`, `BasicHttpReply<Body>`, `Edge<Node, Name>`, `Connection<…>`, `WithBlockContext<T>`, `SqlRow<T>` | in-class `PSIO_REFLECT` inside the class template | Done in slice 2. |
| Services | 121 files with `method(...)` | `PSIO_REFLECT(Svc, method(name, args...)...)` | Done in slice 3 (1.7). `PSIO_INTERFACE(Svc)` is not added yet: decision D18. |
| Crypto signatures | none are typed today: claims and proofs are `std::vector<char>` | bytes | Nothing to convert. |

### 1.5 The temporary glue (all inside `libraries/psio1`)

| File | What | Why |
|---|---|---|
| `psio1/reflect.hpp` (lines 35–40 and 892–1042) | `psio1::reflection_impl::canonical_reflect<T>` and a constrained `psio_get_reflect_impl` overload: `psio1::reflect<T>` is derived from `psio::reflect<T>` for any type reflected with PSIO. Everything read from `psio1::reflect` is provided with the type the legacy macro gives it: `is_defined`, `is_struct`, `definitionWillNotChange`, `name` (a `psio1::FixedString`, built by `canonical_name`, lines 903–912; read only inside `psio1`), `data_members`, `data_member_names`, `member_functions`, `member_function_names`, and `proxy<P>`: the PSIO proxy over a projection that forwards `get<I, &T::field>()` to the legacy proxy object (the views). A PSIO `invariant` is bridged for a `transparent()` type only (static assertion). | fracpack, views, `to_key`, `to_bin`, the legacy schema builder, GraphQL and generic JSON, all inside `psio1`, read the data members; `psio1/graphql.hpp` also reads the methods. Since slice 4b nothing outside `psio1` reads `psio1::reflect`. Binary / key adapters are not bridged (static assertion). |
| `psio1/fracpack.hpp` (lines 11–29, 69–84) | `psio_unwrap_packable` for a PSIO `transparent()` type (its member), `psio_validate_packable` for its PSIO invariant, on an object and on a view; `packable_wrapped_t<T>`. A value that fails the invariant aborts with the invariant's own message. | Replaces the ADL hooks the 2b types no longer define: `Memo`, `Precision`, the XAdmin wrappers and `PrivateKeyInfo` pack, key and view exactly as before. |
| `psio1/to_json.hpp` (333–351), `psio1/from_json.hpp` (599–626) | `to_json` / `from_json` overloads for any type with a PSIO `text_category` adapter, and for a `transparent()` type without one (its member; the invariant is checked after reading). | Replaces the ADL `to_json` / `from_json` the converted headers no longer define. For a text adapter `from_json` calls only `decode`, so legacy JSON keeps its historical leniency. |
| `psio1/graphql.hpp` | `use_json_string_for_gql` is true for a type with a PSIO text adapter. | Replaces the ADL hook. |
| `psio1/schema.hpp` (1686–1709, 1841) | `psio_custom_schema` is true for a PSIO custom type whose text adapter states its `schema_id` (`AccountNumber`, `MethodNumber`); the wrapped type of a `PackableWrapper` is `packable_wrapped_t<T>`. | Replaces the ADL hook; the ids are the ones the legacy schemas already used. PSIO's Schema IR calls every type with a text adapter or an invariant `Custom` (so `Decimal`, `Memo`, `Precision` will be at the flip); the legacy schema never did, and narrowing the rule to the explicit ids keeps the generated schemas byte-identical. |
| `psio1/fracpack.hpp` (lines 1645–1648) | includes `psio1/chrono.hpp`. | `psibase/time.hpp` no longer includes a legacy header. |
| `libraries/psio1/CMakeLists.txt` | `psio1` links `psio::psio`. | The glue includes PSIO headers. |
| `libraries/psio1/tests/canonical_glue_tests.cpp` | Each PSIO-declared test type has a twin declared with `PSIO1_REFLECT`; fracpack bytes, views, JSON, keys, schema and GraphQL must be identical. psibase's own records (action, transaction, signed transaction, block header with and without trailing optionals, consensus variant, traces, native rows, an Nft row with its secondary keys, an event payload) are pinned to the bytes, keys, JSON and schemas the tree produced before slice 2. Service-like classes declared with PSIO have the legacy method metadata of their twins: names, parameter names, lookup by name and hashed name, dispatch over packed arguments, GraphQL (the proxy call recording twins went with the call glue in slice 4a). Native and guest. | Deleted with `psio1`. |
| `libraries/psio1/tests/CMakeLists.txt` | `psio-tests` links `psibase` natively (the guest build already did). | The pinned records are psibase's. |

Because of the glue, `psio1` headers need PSIO on the include path and C++23:
`rust/test_fracpack/build.rs`, `rust/gen-cpp-doc` and `demo/*/build.py` pass it.

### 1.6 Records (slice 2)

A record's declaration changes in one token:

```cpp
struct Tapos {
   TimePointSec expiration;
   uint32_t     refBlockSuffix = 0;
   uint16_t     flags          = 0;
   uint8_t      refBlockIndex  = 0;
   PSIO_REFLECT(Tapos, definitionWillNotChange(), expiration, refBlockSuffix, flags, refBlockIndex)
};
```

in the class body or after the type, as each was; `PSIO_REFLECT(TLSInfo)` for a
record without members; in the class body for a class template. A table's name
is `PSIO_REFLECT_TYPENAME(NftTable)` (`<psio/get_type_name.hpp>`, included by
`psibase/Table.hpp`). A header that includes `<psio1/reflect.hpp>` for the
macro includes `<psio/reflect.hpp>` instead (and `<psio/annotate.hpp>` if it
says `definitionWillNotChange()`: gap G14); most service headers get the macro
through `psibase/psibase.hpp` and do not change.

Nothing else moved in slice 2. In particular, by instruction: no
`maxDynamicData`, no length bounds, no `std::string` → `psio::utf8_string`.
Those select bytes and belong to the flip.

**Which records were converted.** A record is declared with PSIO when its
declaration is already what it will be at the end of the conversion. It is
deferred when the declaration itself must change once a PSIO gap is closed or a
decision is made: a member whose type has no PSIO value (`std::map`,
`psio1::nested<T>`, a monotonic time point), or a type that relies on a legacy
hook with no PSIO counterpart (transparent wrapper, validation, its own text).
A record is *not* deferred because

* a member is a legacy library type with a PSIO counterpart
  (`psio1::shared_view_ptr<T>` in `SignedTransaction`, `SignedMessage`,
  `BlockMessage`; `psio1::view<const T>` in two RTransact records;
  `psio1::json::any`; `psio1::Schema` in the schema records): the member's
  type changes at the flip, the reflection line does not;
* a member is itself a deferred type (`AuthRecord` holds a
  `SubjectPublicKeyInfo`, `TokenRecord` a `Precision`, `HttpSocketInfo` an
  optional `SocketEndpoint`): its declaration is final, and it encodes with
  PSIO as soon as its member does.

So "declared with PSIO" does not yet mean "encodes with PSIO today"; that is
established per type at the flip, by the compiler. Decision D16.

Legacy ADL hooks that sit next to converted records and still work unchanged:
`psio_custom_schema(Action*)`, `psio_custom_schema(ServiceMethod*)` (gap G13),
`get_gql_name(ConsensusData*)`, `get_gql_name(SocketEndpoint*)`,
`get_gql_name(SocketInfo*)`, the `to_json`/`from_json` of the enums
`HttpStatus` and `NewAccountMode` and of the variants `IPAddress` and
`SocketEndpoint` (gap G4), psinode's configuration types.

### 1.7 Services (slice 3)

```cpp
PSIO_REFLECT(Nft,
   method(init),
   method(mint, nftId),
   method(credit, nftId, receiver, memo),
   ...
   method(exists, nftId)
);
PSIBASE_REFLECT_HISTORY_EVENTS(Nft,
   method(ownerChange, nftId, action, account, counter_party, memo),
);
PSIBASE_REFLECT_TABLES(Nft, Nft::Tables)
```

The same line serves services, their `Events::History` / `Events::Merkle`
structs (through psibase's own `PSIBASE_REFLECT_*_EVENTS`, which now expand to
`PSIO_REFLECT` over the alias `Svc_EventsHistory`), interfaces
(`ServerInterface`, `AuthInterface`, …) and GraphQL query roots, which mix
data members and methods. PSIO accepts the trailing comma several sites have.

The consumers of method metadata read `psio::reflect<T>` directly since
slice 4a (section 1.10); only GraphQL still reads them through
`psio1::reflect<T>`, which the glue derives from `psio::reflect<T>`.

* **`allowHashedMethods()`** is gone. It was inert: the legacy macro places the
  check "every method name compresses" inside a member function,
  `requires_compressed_method_names()`, that nothing in the tree calls, so the
  check was never instantiated and the keyword silenced nothing. Proof: seven
  method names in six types that never said `allowHashedMethods()` do not
  compress either (`SetCode::defaultVmVersion`, `SetCode::setDefaultVmVersion`,
  `Credentials::get_expiry_date`, `SubjectiveCounterService::checkIncCallback`,
  and the query fields `actionsReceived`, `invitesByInviter`, `getDefaultCsp`).
  The three services that said it — `Transact` (3 such names:
  `setMaxBlockSize`, `isResMonitoring`, `endSkipBilling`), `StagedTxService`
  (`get_staged_tx`), `VirtualServer` (18, and its event `block_summary`) — are
  declared with `PSIO_REFLECT` like every other; their methods are addressed by
  the hash of the name exactly as before. The glue keeps the legacy function,
  with the check inside it and as lazy as it was. Whether psibase wants such a
  rule at all is decision D7.
* **Overloads.** No reflected class has an overloaded reflected method (PSIO
  names a method by `&T::name`, as the legacy macro did).
* **`PSIO_INTERFACE`** is not added (decision D18).

### 1.8 What was checked

| | after slice 2 | after slice 3 |
|---|---|---|
| Full build, `ctest -j4` | 92/92 | 92/92 |
| `psio-tests` test cases (native / guest; 52 / 11 before) | 60 / 19 | 66 / 25 |
| Generated `*-schema.json` (68 files: actions, parameter names, events, tables, keys, types of every service) vs. the build of 071fff6eb | byte-identical | byte-identical |
| Service and test WASM binaries (103) vs. the build of 071fff6eb | 102 byte-identical; `psio-tests.wasm` differs (its source changed) | 51 byte-identical, among them services that only receive calls (`SetCode`, `Producers`, `AuthSig`, `VerifySig`, `Events`, `Packages`): dispatch compiles to the same code. 52 differ: services and tests that call other services, emit events or build actions with non-trivial arguments. There the glue's proxy adds one move per argument (PSIO's proxy takes references, the legacy proxy values: G15); behaviour is covered by the proxy-recording twins and the service tests |
| Pinned records in `canonical_glue_tests.cpp` | unchanged | unchanged |

### 1.9 Deferred types

Every reflected type that slices 2 and 3 did not convert, and why. Slice 2b
converted most of them (section 1.11); the last column says what became of
each. Those still deferred work as before through the legacy hooks.

| Type | Where | Reason | Blocked by | After slice 2b |
|---|---|---|---|---|
| `Memo` | `psibase/Memo.hpp` | A string that packs as its `contents` (`psio_unwrap_packable`), validates UTF-8 and ≤ 80 bytes on unpack (`psio_validate_packable`) and in JSON. Its canonical form is `psio::utf8_string<80>`, which changes the member API and is a wire decision. | D5; G3, G5 | Done: `transparent()`, `invariant(wellFormed)`. D5, D25. |
| `Precision` | `Tokens/tokenTypes.hpp` | A `uint8_t` wrapper that packs as the integer and validates 0–8 on unpack and in JSON. | G3, G5 | Done: `transparent()`, `invariant(inRange)`; the message names the value (1.13). |
| `Decimal` | `Tokens/tokenTypes.hpp` | A record (`Quantity`, `Precision`) whose JSON is a decimal string. It needs a text adapter whose `validate` reports instead of aborting (`Decimal::fromStr` calls `psibase::check`), and a decision on which spellings name a value (`"1.50"` and `"1.5"` are different values; `".5"`, `"5."`, `""`?). | D17; holds a `Precision` | Done: `PSIO_REFLECT` + `PSIO_ADAPTER(…, text_category, DecimalText)`. D17. |
| `TypedAction<T>` | `psibase/Actor.hpp` | `psio1::nested<T>` member. | G7 | Done (macro). The member stays `psio1::nested<T>` until the flip, then `psio::nested<T>` (D16). |
| `TimerRow` | `psibase/nativeTables.hpp` | `MonotonicTimePointUSec` member. | G2 | Done (macro). |
| `UrlRow` | `XPeers.hpp` | `MonotonicTimePointUSec` member. | G2 | Done (macro). |
| `TimerQueueRow` | `XTimer.hpp` | `MonotonicTimePointUSec` member. | G2 | Done (macro). |
| `ServiceSchema` | `psibase/schema.hpp` | Four `std::map` members (`actions`, `history`, `merkle`, `database`); it is also the legacy schema format itself, replaced by the Schema IR. | G8, G1 | Done (macro). Still the legacy schema format; replaced by the Schema IR at the flip. |
| `DynDepGroups` | `DynLd.hpp` | `std::map<std::string, std::vector<DynDep>>` member. | G8 | Done (macro). |
| `PsinodeServiceConfig` | `programs/psinode/main.cpp` | `std::map<std::string, ExtraConfigField>` member. | G8 | Done (macro). |
| `SubjectPublicKeyInfo`, `PrivateKeyInfo` | `AuthSig/Spki.hpp`, `PrivateKeyInfo.hpp` | Not reflected at all: transparent wrappers over DER bytes with validation, PEM text and a key hook. | G3, G5 | `PrivateKeyInfo`: done, `transparent()`. `SubjectPublicKeyInfo`: **still deferred** — not a PSIO gap any more. Its validation (`Botan::BER_Decoder`) and its PEM parser abort (throw natively) on bad input; a PSIO `invariant` and a text adapter's `validate` must return a status. It needs a DER / PEM check that reports. D26. |
| `XAdmin::Auth::Account`, `LocalUsername` | `XAdmin.hpp` | Transparent wrappers named with `PSIO1_REFLECT_TYPENAME` (variant alternative names). | G3 | Done: `PSIO_REFLECT(…, transparent(), value)`. |
| `IPAddress`, `SocketEndpoint` | `psibase/SocketInfo.hpp` | Variant aliases with a text form; their alternatives are converted records. | G4 | **Still deferred.** PSIO can now give a variant a text adapter (G4 closed, verified), but (1) the adapter of a variant must name a `schema_id`, which the glue rule for the legacy schema would turn into a `Custom` node and change `XAdmin-schema.json` / `XHttp`-style schemas; (2) the legacy `to_json(std::variant)` overload is more specialized than the glue's text-adapter overload and would win; (3) the parsers abort on bad text. Convert at the JSON flip. |

Outside the scope of slices 2–3: `libraries/debug_eos_vm/dwarf.cpp` (2 sites;
the legacy `bin` format with custom `to_bin`/`from_bin` and a
`psio1::input_stream` member; declared with `PSIO_REFLECT` since slice 2b) and,
still on the legacy macro, `rust/test_fracpack/tests/test.hpp` (5 sites; the legacy library's own
C++/Rust cross-check, deleted with it). `demo/http-server-build/CookieProbe.cpp`
(2 sites, one service; built by its own script, not by the tree) and the C++
examples under `doc/src/development/services/cpp-service` (4 services and the
snippet in `reference/services-events.md`; compiled against the SDK by the
tree) moved to `PSIO_REFLECT` in slice 4a, because `PSIBASE_DISPATCH` reads
PSIO reflection now.

One declaration was wrong and was converted as it stood in slice 2:
`PSIO_REFLECT(RestartInfo, shouldRestart)` in `programs/psinode/main.cpp`
named a member the struct does not have. Nothing used it; slice 2b deleted it
(D19).

### 1.10 Method consumers (slice 4a)

Everything psibase derives from the methods of a reflected class reads
`psio::reflect<T>`:

| Consumer | Reads |
|---|---|
| `psibase/MethodArgs.hpp` (new) | `MethodArgs<M>`: the tuple a method's arguments are packed as, from `psio::method_traits<M>::params` with a view parameter replaced by the type it views (what `psio1::make_param_value_tuple` did; the view is still `psio1::view` until the flip). `MethodResult<M>`: the packed result type. |
| `Actor.hpp` | `Actor`, `transactor`, `EventEmitter`, `ActionViewBuilder` derive from `psio::reflect<T>::proxy<P>`; the five proxy objects implement `call<I, &T::method>(args...)`. The method's number is `methodNumber<I, MemberPtr>` = `MethodNumber{reflect<class>::method_name<I>}`, a constant. |
| `tester.hpp` | `ServiceUser` derives from `psio::reflect<Service>::proxy<PushTransactionProxy>`. |
| `dispatch.hpp` | `findAction<Service>(MethodNumber)` = `reflect<Service>::index_of_method_hash<MethodNumberOf>(number)`: PSIO's compile-time perfect hash over the method numbers of the reflected names. The index selects `callAction<Service, I>` from a constant table of function pointers; that validates the packed `MethodArgs`, reads them through a view and calls `reflect<Service>::invoke_method<I>`. |
| `schema.hpp` (actions, events) | `method_names`, `method_type<I>`, `method_pointer<I>` (as the template argument of the event-access hook), parameter names. Tables and keys still read `psio1::reflect` (slice 4b). |
| `servePackAction.hpp`, `serveActionTemplates.hpp` | `method_names`, `method_type<I>`, parameter names. |
| `libraries/net/test/test_util.cpp` | `MethodArgs<decltype(&Producers::setConsensus)>`. |

What changed in behaviour, all at compile time or inside one service call:

* **Arguments of a call proxy.** PSIO's proxy forwards references (G15). The
  proxy objects do not copy: `action_builder_proxy` and `EventEmitterProxy`
  construct the parameter tuple from the forwarded arguments, as before;
  `ActionViewProxy` decides per argument whether it can be packed as it is
  (`PackableAs`) from `std::decay_t` of its type — the type the legacy
  by-value proxy deduced — and takes it by `const&`. The packed bytes are the
  same; one copy or move per argument is gone. Decision D22.
* **Lookup.** The legacy dispatcher compared the action's number with the
  hash of each method name in turn, at run time, and took the first match. Now
  two reflected methods of one dispatched service whose names have the same
  `MethodNumber` do not compile ("psio: two names of one type collide under
  the supplied hash"). No service in the tree has such a pair. Decision D23.
* **A proxy inherits its proxy object.** `psio::reflect<T>::proxy<P>` derives
  from `P`, so a reflected method named like a member of the proxy object
  (`sender`, `receiver`, `flags`) hides that member in the proxy; psibase
  reaches those members through `psio_get_proxy()` only.

Two things PSIO lacks were found and are covered by 35 lines of temporary glue
at the end of `psio1/reflect.hpp` (gaps G16, G17): parameter names of a type
without methods, and a walk over the methods that does not odr-use them.
(Both are closed in PSIO since the pin moved; the glue is deleted and
`schema.hpp`, `servePackAction.hpp` and `serveActionTemplates.hpp` call
`psio::reflect<T>::for_each_method` and `method_param_names<I>` directly.)

Tests: `libraries/psibase/common/tests/methods.cpp` (permanent; part of
`psibase-psio-tests`, native and guest): the argument tuple and result types,
action lookup by number including a hashed name and a class without methods,
`transactor` and `ActionViewBuilder` bytes for lvalue, const, temporary and
convertible arguments, `/pack_action` from JSON, the action template text,
and the action and event part of a service schema (parameter names, unnamed
parameters, event access).

Checked after slice 4a:

| | |
|---|---|
| Full build | exit 0 (`~/psibase-pssz-build.build-slice4a.log`) |
| `ctest -j4` | 92/92 passed (`~/psibase-pssz-build.ctest-slice4a.log`) |
| `psibase-psio-tests` test cases (native / guest) | 27 / 27, 7 of them `[methods]` (20 / 20 before) |
| `psio-tests` test cases (native / guest) | 65 / 24 (66 / 25 before: the proxy call recording case is deleted) |
| Generated `*-schema.json` (68 files) vs. the build of a94bd5111 | byte-identical |
| Service and test WASM binaries (103 in the build root) vs. the build of a94bd5111 | 2 byte-identical (`Nop`, `VerifySig`: no dispatcher), 101 differ. Expected: every service's dispatcher is different code (table lookup and indirect call instead of a compare chain), and every caller's proxies no longer copy their arguments. Unlike slices 2 and 3, the binaries are therefore not evidence of wire neutrality here; the schemas, the pinned bytes in `methods.cpp` and `canonical_glue_tests.cpp`, and the service tests are. |

### 1.11 The deferred records (slice 2b)

PSIO at the new pin has what section 1.9 waited for. Verified in the pinned
headers, by compiling and running a probe against them and by the tests
below, not taken from the change list: time points of clocks other than
`system_clock` (G2), `transparent()` (G3), `invariant(fn)` (G5),
`psio::nested<T>` (G7), `std::pair` / `std::map` / `std::set` (G8), a text
adapter for a `std::variant` (G4), `psio::pssz_mutable_view` (G6), a Schema
as JSON (G1), the method metadata of a type without methods (G16) and
`for_each_method(fn(index, name))` (G17). G14 was not closed at that pin; it
is at `dfd0db17` (1.13).

**A wrapper that is its member, with a rule.**

```cpp
struct Memo {
   static constexpr uint8_t maxBytes = 80;
   std::string contents;
   Memo(const char* s);  Memo(const std::string& s);  Memo();   // abort on text that is not a memo
   static const char*        invalid(std::string_view) noexcept;    // why not, or null
   static bool               validate(std::string_view);            // aborts, as before
   static psio::codec_status wellFormed(const Memo&) noexcept;      // reports
   PSIO_REFLECT(Memo, transparent(), invariant(wellFormed), contents)
};
```

Nothing else: the `to_json`, `from_json`, two `psio_unwrap_packable` and two
`psio_validate_packable` overloads are deleted, and the header includes only
`<psio/reflect.hpp>` of PSIO. `Precision` is the same over a `uint8_t` (`invariant(inRange)`).
In PSIO a `Memo` is its string in PSSZ, key and I-JSON, and every checking
reader rejects text over 80 bytes or not UTF-8 with the invariant's message.
`XAdmin::Auth::Account`, `LocalUsername` and `AuthSig::PrivateKeyInfo` are
`transparent()` without an invariant.

**A record with a text form.** `Decimal` stays the record
`(quantity, precision)` and gets

```cpp
struct DecimalText {
   static std::size_t        packsize(const Decimal&);
   static void               encode(const Decimal&, std::string&);       // str()
   static Decimal            decode(std::span<const char>);               // fromStr()
   static psio::codec_status validate(std::span<const char>) noexcept;    // Decimal::parse reads it
   static psio::codec_status validate_strict(std::span<const char>) noexcept;  // == str() of what it reads
};
PSIO_ADAPTER(UserService::Decimal, psio::text_category, UserService::DecimalText)
```

`Decimal::parse(std::string_view) noexcept -> std::optional<Decimal>` is new: the
rules of `fromStr` without aborting (D17). Since 1.13 the two accept exactly
the same texts: `fromStr` no longer wraps a quantity that does not fit 64 bits.

**Macro only.** `TimerRow`, `UrlRow`, `TimerQueueRow`, `ServiceSchema`,
`DynDepGroups`, `PsinodeServiceConfig`, `TypedAction<T>`, `wasm_header`,
`wasm_section`.

What the glue does for these is in section 1.5. What changed in behaviour:

* **One error text — undone in 1.13.** A `Precision` above 8 read from packed
  data or JSON aborts with "Value 9 outside allowed Precision range: 0 to 8".
  Slice 2b had to make that a constant text ("Value outside allowed …"),
  because a PSIO invariant could only report a message of static storage
  (G21); with `psio::codec_fail_owned` the original text is back and the
  pinned expectation with it. `Memo`'s two messages are constant
  and unchanged (`test_memo.cpp` checks them through a service).
* **Newly reflected.** `Account`, `LocalUsername` and `PrivateKeyInfo` were
  not reflected; they are now, so `psio1` can also write them as JSON and
  gives their views a member accessor. Their packed bytes and the schema of
  `AuthResult` are pinned unchanged.

Tests:

* `libraries/psio1/tests/canonical_glue_tests.cpp`, two cases tagged
  `[deferred]` (temporary): fracpack bytes, keys, JSON, legacy schema, GraphQL
  shape, views, round trips and the abort messages of `Memo`, `Precision`,
  `Decimal`, a `TokenRecord`, `TimerRow`, `TimerQueueRow`, `UrlRow`,
  `DynDepGroups`, a `TypedAction`, `AuthResult` and `ServiceSchema`. The
  expected values were printed by the tree at 61d2e2b9f, before any of them
  was re-declared (kept in `~/psibase-pssz-snap-pre2b/pins.txt`), and pass
  unchanged after (the `Precision` message since 1.13).
* `libraries/psibase/common/tests/wrappers.cpp` (permanent, native and
  guest): the PSIO form of the same types — a `Memo` is its text in PSSZ, key
  and I-JSON and is rejected by `validate_pssz` and the JSON reader when it
  is not one, inside a record too; `Precision`; `Decimal` text, every spelling
  `fromStr` reads and what `parse` rejects; monotonic rows; a map member;
  the wrappers without an invariant.

Checked after slice 2b:

| | |
|---|---|
| Full build | exit 0 (`~/psibase-pssz-build.build-step1.log`) |
| `ctest -j4` | 92/92 (`~/psibase-pssz-build.ctest-step1.log`) |
| Generated `*-schema.json` (68) vs. the build of 0167a3056 | byte-identical (`~/psibase-pssz-build.compare-step1.log`) |
| Service and test WASM binaries (103 in the build root) | The pin move alone: 84 byte-identical to the build of 0167a3056, 19 differ (PSIO's own code changed). Slice 2b vs. the pin move: 91 byte-identical, 12 differ — the tests and the binaries that pack a `Memo`, a `Precision`, a `Decimal` or key material (`Invite`, `RInvite`, `CredResThief`, `TestMemo`, six service tests, the two psio test binaries). |

### 1.12 Data-member consumers (slice 4b)

| Consumer | Before | Now |
|---|---|---|
| `Table.hpp`, `flatten_key<T>` (the key type of an index with a record in it) | `psio1::get_struct_tuple_impl<psio1::reflect<T>::data_members>` | `flatten_key_t<psio::reflect<T>::member_types>` for `psio::Reflected<T>` (since 1.13) |
| `Table.hpp`, `detail::get_view_member` (a key read through a view of the packed row) | recursion over `psio1::MemberList<M...>` | recursion over `psio::reflect<C>::member_pointer<I>`; the view is still `psio1::view` |
| `schema.hpp`, key paths of a table index | `get_member_index` over `psio1::MemberList`; `psio1::MemberPtrType<…>::ReturnType` for a member-function key | `psio::reflect<T>::index_of_member(K)` (since 1.13; a member that is not reflected is a `static_assert`); `psio::method_traits<…>::result` |
| `schema.hpp`, table names | `psio1::get_type_name<T>()` | `psio::get_type_name<T>()` |
| `zip.cpp`, `readStruct` | `psio1::for_each_member` | `psio::reflect<T>::for_each_field` |
| `Rpc.hpp` (query string → record), `serveGraphQL.hpp` (`SqlRow` JSON) | `psio1::get_data_member<T>(name, fn)` | `psio::reflect<T>::visit_field_by_name(obj, name, fn)` |
| `XAdmin.cpp` (is this a host option name) | `psio1::get_data_member` with an empty callback | `psio::reflect<AdminOptionsRow>::index_of(name)` |
| `jwt.hpp` | `requires psio1::Reflected<T>` | `requires psio::Reflected<T>` |
| `serveGraphQL.hpp`, `has_block_member` | loop over `psio1::reflect<T>::data_member_names` | `psio::reflect<T>::index_of("block")` |
| `serveGraphQL.hpp`, `XPackages.cpp`, `RPackages.cpp`: connection and edge names | `psio1::reflect<T>::name + "Edge"`, `psio1::FixedString` template parameters | `psio::reflect<T>::fixed_name + "Edge"`, `psio::fixed_string` template parameters (since 1.13; slice 4b itself used a glue helper, `psio1::reflected_name<T>`, now deleted) |

`nativeTables.hpp` had nothing of its own to convert beyond `TimerRow`.
Ten files no longer include `<psio1/reflect.hpp>`.

Differences that matter to a reader of the code:

* `flatten_key` flattened every type `psio1` regards as reflected, which
  includes `std::pair` (the legacy library reflects it). It now flattens the
  types PSIO reflects. No table in the tree has a pair in a key.
* At the pin of slice 4b `psio::Reflected<T&>` did not compile (G22), PSIO had
  no index of a member given its pointer and no tuple of member types (G20),
  and no compile-time string (G19); slice 4b wrote a pre-check, two index
  sequences and a glue helper for them. All four are gone since 1.13.
* `get_view_member` (`Table.hpp:731`) still walks `member_pointer<I>` itself:
  the member pointer it is given is a run-time value and the view accessor
  needs the index as a constant, so `find_member_index` does not replace it.
  It goes when views flip (`psio::pssz_view<C>::get<I>()`).

Tests: `libraries/psibase/common/tests/tables.cpp` (permanent, native and
guest): flattened key types, a key read through a view (two members of one
type are told apart by pointer), `has_block_member`, connection / edge /
`WithBlockContext` names. Table keys and GraphQL are otherwise covered by
the generated schemas and the service tests (`TestTable`, `Events`, `Nft`,
`Tokens`, `Packages`, `XSites`, …).

Checked after slice 4b (on PSIO `868e37bb`):

| | |
|---|---|
| Full build | exit 0 (`~/psibase-pssz-build.build-step2.log`) |
| `ctest -j4` | 92/92 (`~/psibase-pssz-build.ctest-step2.log`) |
| Generated `*-schema.json` (68) vs. the build of 0167a3056 | byte-identical (`~/psibase-pssz-build.compare-step2.log`) |
| Service and test WASM binaries (103 in the build root) vs. slice 2b | 74 byte-identical, 29 differ: binaries with tables, GraphQL queries or query-string / JSON member lookups, where member lookup by name is now PSIO's generated perfect hash and the view member walk is different code, and the test binary that gained `tables.cpp`. Not examined one by one; as in slice 4a, the binaries are not the evidence of wire neutrality here — the schemas, the pinned forms and the service tests are. |

### 1.13 Follow-up on PSIO `dfd0db17` (G14, G19–G22; Decimal overflow)

The rule for this work: where PSIO lacks something, wait for PSIO and do not
work around it. PSIO at `dfd0db179c9cba1523f8c68ca10a81a1250ceec2` closes
five of the gaps slices 2b and 4b had to step around. Each was read in the
pinned headers and is exercised by the tree, not taken from the change list.

| Gap | PSIO now has | What psibase did with it |
|---|---|---|
| G21 | `psio::codec_fail_owned(text, byte_offset, format_name)` (`psio/error.hpp`): a status whose message is copied and travels with it. | `Precision::inRange` reports `Precision::outOfRange(value)`, the text the constructor aborts with: "Value 9 outside allowed Precision range: 0 to 8". `canonical_glue_tests.cpp` expects the text pinned before slice 2b again (`pins.txt`, reject e/f/g); `wrappers.cpp` checks the PSIO status carries it for 9 and for 200. |
| G14 | `<psio/reflect.hpp>` includes `annotate.hpp` last; every `PSIO_REFLECT` keyword compiles with it alone. | Removed: `<psio/annotate.hpp>` from `SocketInfo.hpp`, `Memo.hpp`, `tokenTypes.hpp`; `<psio/transparent.hpp>` from `Memo.hpp`, `tokenTypes.hpp`, `XAdmin.hpp`, `PrivateKeyInfo.hpp`; `<psio/invariant.hpp>` from `Memo.hpp`, `tokenTypes.hpp`. No psibase header outside `psio1` includes any of the three. |
| G19 | `psio::fixed_string<N>` (`psio/fixed_string.hpp`), `psio::reflect<T>::fixed_name`. | `Edge<Node, psio::fixed_string>`, `Connection<Node, psio::fixed_string, psio::fixed_string>` and `reflect<T>::fixed_name + "Connection"` in `serveGraphQL.hpp` (13 lines), `XPackages.cpp` (3), `RPackages.cpp` (2), `tests/tables.cpp` (2). `psio1::reflected_name<T>` is deleted. The legacy GraphQL engine reads these names through the `get_type_name` overloads in `serveGraphQL.hpp`, which return `const char*`, so nothing is converted at its boundary. `psio1::FixedString` remains inside `psio1` only (`psio1::reflect<T>::name`). |
| G20 | `reflect<T>::member_types`, `index_of_member(ptr)`, `find_member_index(ptr)`, `method_types`, `index_of_method_pointer(ptr)`, `find_method_pointer_index(ptr)`. | `schema.hpp`: `get_member_index` and `is_equal_member` deleted, `index_of_member(K)` instead. `Table.hpp`: `flatten_members` deleted, `flatten_key_t<reflect<T>::member_types>` instead. Nothing in psibase needed the method forms. |
| G22 | `psio::reflect<T>` / `psio::Reflected<T>` are well-formed and false for a reference, `void`, a function type; false for a cv-qualified type. | `flatten_key<T>` is constrained by `psio::Reflected<T>` alone (`Table.hpp:474`). No other pre-check of this kind existed. |

Also in the new pin and checked against the tree: `psio::view<T, Fmt,
storage::owning / shared / mut_borrow>` are compile errors — psibase names no
`psio::view` with a storage kind (it still uses `psio1::view`); `emit_wit`
writes `string` for a `utf8` string — psibase does not call `emit_wit`; the
`lengthBound` fix for a nested member behind an alias is in `pssz_ir.hpp`,
which psibase does not use yet. None of the three affects psibase today.

**The one behaviour change (owner's decision, D17).** `Decimal::fromStr`
added the fraction to the scaled integer part without a check, so a text
whose quantity is over 2^64 − 1 only by its fraction wrapped
(`"184467440737.09551616"` read as 0 at precision 8). It now aborts with
"Invalid number: overflow", the message the neighbouring overflow checks of
`fromStr` already used. `Decimal::parse` and `DecimalText::validate` already
rejected such text, so every reader agrees now: `fromStr`, the legacy JSON
reader (which calls `fromStr`), `parse`, and PSIO's checked JSON reader. The
packed form is not affected: every 64-bit quantity is a `Decimal`.

Tests added: `wrappers.cpp`, "Decimal: a quantity that does not fit 64 bits
is rejected, not wrapped" — at precisions 0, 1, 2, 4, 7 and 8 the text of
2^64 − 1 is read by `parse`, `fromStr`, `validate` and the I-JSON reader, and
the text of 2^64 is rejected by each (natively `fromStr` is checked for its
message; in the guest an abort cannot be observed), plus four texts further
out; `canonical_glue_tests.cpp`: the legacy JSON reader accepts
`"184467440737.09551615"` and aborts on `"184467440737.09551616"`.

The Rust parser (`rust/psibase/src/services/tokens/quantity.rs:50`,
`Quantity::from_str`, called by `Decimal::from_str`) was read, not changed
and not run: it rejects an integer part that overflows when scaled
(`checked_mul` → `TokensError::Overflow`) and a whole number over 2^64 − 1
(`InvalidNumber`), but adds the two parts with a plain `+` (line 78). That
is a panic where overflow checks are on (debug and test builds) and a silent
wrap where they are off (release builds; no profile in the tree sets
`overflow-checks`). So Rust has the wrap C++ had, for the same texts.

Checked after the follow-up:

| | |
|---|---|
| Full build | exit 0 (`~/psibase-pssz-build.build-g21.log`; the pin move alone: `~/psibase-pssz-build.build-g21-repin.log`, exit 0) |
| `ctest -j4` | 92/92 (`~/psibase-pssz-build.ctest-g21.log`) |
| Generated `*-schema.json` (68) vs. the build of 0167a3056 | byte-identical (`~/psibase-pssz-build.compare-g21.log`) |
| Service and test WASM binaries (103 in the build root) vs. slice 4b | 82 byte-identical, 21 differ: the binaries with GraphQL connections (the names are template arguments of another type now), with a `Precision` or `Decimal`, with key schemas or record keys, and the test binaries. Not examined one by one. |

### 1.14 Pin moved to PSIO `main` (`224f80de`)

The pin is `224f80de2563939d93de7b685e1d174fe278b070`, `main` of
gofractally/psio (it was `dfd0db17`, a topic branch); three files state it:
`cmake/PsibaseDependencies.cmake` and, under `tests/cmake/dependencies`,
`CMakeLists.txt` and `README.md`. No psibase source changed.

What differs in the C++ headers between the two commits
(`git diff dfd0db17..224f80de -- cpp/include`: three files, 111 lines), read
there:

| Change | Where | Effect on psibase |
|---|---|---|
| A `std::tuple`, a `std::pair` and a `std::variant` have an inferred size bound (a tuple: its header plus each element's payload and offset slot; a variant: one selector byte plus its widest alternative), so their automatic pSSZ width can be 1 or 2 where it was always 4. | `psio/max_size.hpp` (+62), and the same rule for the schema-driven codec in `psio/pssz_ir.hpp` | None today: psibase packs nothing with pSSZ outside its tests, and no psibase source asserts an automatic width (`auto_pssz_width` / `max_encoded_size` do not occur outside `libraries/psio1`). It decides bytes at the flip: `MethodArgs<M>` is a tuple, so an action whose arguments are all bounded gets a narrow argument frame. |
| The fail-fast `psio::decode` refuses a member outside its declared `length_bound`, as `validate` and the encoder already did. | `psio/pssz.hpp` (+9) | None: no psibase record declares a `length_bound` yet. |

The other changes named for this pin — `view<T, Fmt, storage::owning |
shared>` as compile errors, pSSZ decode / validate speed, SSZ without
exceptions, `emit_wit` writing `string` for a UTF-8 string — are not in this
diff: they were already in `dfd0db17` (section 1.13 lists the first and the
last). The rest of the 93 changed files are the Rust crate (66 files; section
6), JS, the conformance vectors and a benchmark.

Checked:

| | |
|---|---|
| Full build | exit 0 (`~/psibase-pssz-build.build-repin-main.log`). Rebuilt: four guest objects (`psio-tests`: `canonical_glue_tests`; `psibase-psio-tests`: `leaf_types`, `psio`, `wrappers`), four native objects (three in `libraries/psibase`, one in `libraries/psio1`) and what links them. |
| Generated `*-schema.json` (68) vs. the build of 0167a3056 | byte-identical (`~/psibase-pssz-build.compare-repin-main.log`); none was regenerated, because no service binary changed |
| wasm binaries (420 in the build directory) vs. the build on `dfd0db17` | 419 byte-identical; `psibase-psio-tests.wasm` differs (it encodes pSSZ) |
| `ctest -j4` | **No single clean run: 91 / 92 three times.** (1) On the pin move, `psinode_test_crash` failed (`~/psibase-pssz-build.ctest-repin-main.log`). (2) With the Rust slice R1 applied, `psinode_test_crash` passed and `rs-tests` failed for the reason in 6.10 (`…ctest-r1.log`). (3) On the committed tree, R1 removed, `rs-tests` passed and `psinode_test_crash` failed again (`…ctest-final.log`). Every one of the 92 tests has passed on this pin, in one run or another. |
| `psinode_test_crash` | Intermittent in a parallel run (2 of 3), not alone: run by itself it passed 4 of 4 (`…ctest-repin-main-rerun-crash.log`, `…ctest-crash-repeat.log`), also at a load average of 66. It passed in all eleven earlier logged full runs of this work. The failure: a node that was shut down does not start again (`test_shutdown_all_bft`; in run 3 also `test_unlock_bft`). In run 3 the node's log shows psinode aborting while it reopens its database: `std::runtime_error: reference count exceeded limits`, thrown by psitri (`external/psitri/libraries/sal/include/sal/control_block.hpp:141`); the log kept from run 1 does not contain the node's last line. The pin move recompiled four native objects, all of them test sources; psinode and its libraries were not recompiled, so the node is the code of the build of 25751d95e, which passed. This is the storage engine at restart, not serialization. Reported; not investigated further. |

### 1.15 Pin moved along PSIO `main` (`415ea1a6`)

The pin is `415ea1a61db6ee0667be7f41793e18c7e4d6ad9b` (21 commits after
`224f80de`; the same three files state it). No psibase C++ source changed.

What differs, read in the checkout (`git diff 224f80de..415ea1a6`: 95
files; `cpp/include` 14 files, the Rust crate 49, JS 8):

| Change | Where | Effect on psibase |
|---|---|---|
| Bounds by annotation at any depth: `attr(f, max<8> \| element(utf8 \| max<16>))`, `keys(...)`, `values(...)`, `at<I>(...)`; the annotated member is the bounded type on the wire, in the schema and in every check. `psio::bounded<T, N>` is a pSSZ list. The top-level `psio::utf8<N>` is gone: `utf8 \| max<N>`. | `psio/annotate.hpp`, `psio/detail/annotation_tree.hpp` (new), `pssz.hpp`, `max_size.hpp`, `schema_builder.hpp`, `wrappers.hpp`, `docs/psio-overview.md` ("Bounds by annotation") | None today: no psibase declaration has an `attr`, and `psio::utf8<` does not occur in the tree. It is the spelling for the bounds of the flip (a `Memo` is `attr(contents, utf8 \| max<80>)`, D37). |
| `method(name, params..., attr(p, ...), maxDynamicData(N), returns(...))`; `reflect<T>::method_arg_tuple<I>` is the argument tuple carrying those annotations. | `psio/reflect.hpp` | None today (no method declares one). At the flip `MethodArgs<M>` (`psibase/MethodArgs.hpp`) should be built from `method_arg_tuple<I>` so that an action's declared caps select its argument frame. |
| A faster sizing pass; number records validate in one compare. | `pssz.hpp` | None (performance). |
| Rust: the gaps RG1–RG9 and RG11 of 6.8 are closed (the table there has each). | `rust/psio`, `rust/psio-macros` | Unblocks the Rust slices. |

The task that asked for this pin names three documents, `docs/annotations.md`,
`tutorial-annotations.md` and `annotations-for-agents.md`. They are not in
the repository at this commit or on any of its branches; the annotations
are documented in `docs/psio-overview.md`, `docs/pssz-rust-profile.md`,
`docs/helpers.md` and `rust/psio/src/lib.rs`, which were read.

Checked:

| | |
|---|---|
| Full build | exit 0 (`~/psibase-pssz-build.build-r0.log`): PSIO's headers changed, so everything native and every guest that includes them was recompiled |
| `ctest -j4` | 92/92 (`~/psibase-pssz-build.ctest-r0.log`); `psinode_test_crash` passed |
| Generated `*-schema.json` (68) vs. the build of 0167a3056 | byte-identical (`~/psibase-pssz-build.compare-r0.log`) |
| wasm binaries in the build directory (472) vs. the build on `224f80de` | 471 byte-identical; `psibase-psio-tests.wasm` differs (it encodes pSSZ) |

(Homebrew's binaryen went from 129 to 133 on this machine at 18:49 on the
day of this work, between the R1 build and the R2 build. The comparison
above and the one of 6.10 were made before it, with one `wasm-opt`; from R2
on, wasm binaries are not compared with earlier builds at all.)

### 1.16 The integration head merged; pin moved to PSIO `c6d99404`

**Merge.** `bytemaster/head` at `44c57f739` is merged into `claude/pssz`
(merge commit `7014902a1`; the branch was based on `8fa03237f`). The head
brought WebAssembly wide arithmetic on by default, the psizam pin
`63b2ee3` (the checkout in `external/psizam` is moved by hand: the CMake
guard refuses a checkout whose head is not the pin), the requirement of
binaryen 133 or newer, the call profile and `t-TransferBench-test`. PSIO's
pin and the Rust services were not touched there.

Two files conflicted, both because this branch spells the legacy library
`psio1`:

| File | Resolution |
|---|---|
| `libraries/psibase/native/include/psibase/db.hpp` | The head's side (the new `kvContains`) with `psio::input_stream` written `psio1::input_stream`, as in the rest of the class. |
| `libraries/psibase/native/src/usePsitri.cpp` | The head's side (the per-database write counts, `kvContains`) with `psio1::input_stream`. |

Three new uses of the legacy library merged without a conflict and were
renamed the same way, or they would have named PSIO: `psio::convert_to_key`
in `ExecutionContext.cpp` and `ExecutionContextWasmtime.cpp`,
`psio::to_frac` in `packages/user/Tokens/test/src/TransferBench.cpp`. The
head touched no `PSIO_REFLECT` declaration, dispatch, `Actor`, schema or
table code, so nothing converted had to be converted again.

| | |
|---|---|
| Full build | exit 0 (`~/psibase-pssz-build.build-head.log`), `wasm-opt` 133 |
| `ctest -j4` | **93 / 93** (`~/psibase-pssz-build.ctest-head.log`). The baseline is 93 now: the 92 of before and the head's `t-TransferBench-test`. The head itself records 91 tests on this machine (`tests/timing/runs/*8b09a8776*`: 24 native, 38 end-to-end, 29 Rust); the two this branch adds are `n-psibase-psio-tests` and `t-psibase-psio-tests`. `psinode_test_crash` passed. |
| Generated `*-schema.json` (68) vs. the snapshot of 0167a3056 | byte-identical: the head changed no schema. The baseline for later steps is `~/psibase-pssz-snap-head/` (the same 68 files). |

**Pin.** `c6d9940441463c7ba3b6087595770a765f5fffac` (20 commits after
`415ea1a6`; commit `c8553bd3e`; the same three files state it). In it:
every type with offsets takes its own width (a bounded list of bounded
elements has a 1- or 2-byte offset table), a record's cap narrows the
containers beneath it (`docs/pssz-spec.md` 3.1, 3.2, 3.6), and
`docs/annotations.md`, `tutorial-annotations.md` and
`annotations-for-agents.md` exist. In Rust `PsszFormat` gained
`POSITION_CAP`, `type Free` and `type Under<const C>`, member views of a
capped record are typed by position, and `PsszError` / `KeyError` are not
`Copy`.

**What it cost psibase: nothing.** No psibase source changed. psibase
names none of the changed traits (it uses the derives, `psio::json::TextForm`
and the free functions), has no hand-written PSIO codec, declares no cap,
and its one bound (`Memo`, a bounded string, not a list) has no offset
table. The C++ ↔ Rust fixture was regenerated and is byte-identical; the
bytes pinned in `leaf_types.cpp`, `wrappers.cpp` and the Rust tests are
unchanged. RG13 is closed in this pin (6.8).

| | |
|---|---|
| Full build | exit 0 (`~/psibase-pssz-build.build-repin-c6d9.log`) |
| `ctest -j4` | 93 / 93 (`~/psibase-pssz-build.ctest-repin-c6d9.log`) |
| Generated `*-schema.json` (68) vs. `~/psibase-pssz-snap-head/` | byte-identical |
| The six unbuilt packages | exit 0 (`~/psibase-pssz-build.repin-c6d9-check-unbuilt.log`) |

## 2. Inventory of what remains

Counts are occurrences / files in the tree outside `libraries/psio1`,
`external/` and `doc/` (`git grep -P`). Section 2.1 is re-counted at the end
of slice 4b (the `FixedString` row and the table of `psio1::` names below
after the follow-up of 1.13); sections 2.2–2.9 are as counted at the end of slice 1 except
where a row says "now" (re-counted at the end of slice 4b; the differences
are small: slices 2–4b changed declarations and their consumers, not the
packing call sites).
`libraries/psio1` itself is 52 files, about 14,600 lines of headers and
sources, 20 test files.

### 2.1 C++: reflection

| Legacy | Sites / files | Canonical replacement |
|---|---|---|
| `PSIO1_REFLECT(` | was 569 / 176; now 5 / 1 (`rust/test_fracpack/tests/test.hpp`) | `PSIO_REFLECT`: now 577 / 182 |
| — remaining, by area | `rust/test_fracpack` 5 (deleted with the legacy library) | section 1.9 |
| `method(...)` items | 557 items (the text `method(` occurs 606 times in 121 files, 49 of them calls such as `action.method()`): 528 in `PSIO_REFLECT`, 28 in `PSIBASE_REFLECT_*_EVENTS` (which expand to `PSIO_REFLECT`), 1 in `demo/` on the legacy macro | done; consumers move to `reflect<T>::method_*`, `index_of_method_hash<Hash>` in slice 4 |
| `definitionWillNotChange()` | 25 / 13, all in `PSIO_REFLECT` now | same keyword |
| `allowHashedMethods()` | was 4 / 3; now 0 | removed: it was inert (1.7). Decision D7. |
| `PSIO1_REFLECT_TYPENAME` | was 125 / 38; now 1 / 1 (`rust/test_fracpack`) | `PSIO_REFLECT_TYPENAME`: 122 / 37 (table names) |
| `psio1::reflect<…>` used directly | was 42 / 9; after slice 4a 19 / 5; now 0 | done in slice 4b (1.12) |
| `psio1::MemberPtrType`, `MemberList`, `TypeList`, `apply_members`, `for_each_member`, `get_data_member`, `Reflected`, `get_type_name` | now 0 | done in slice 4b |
| `psio1::FixedString`, `psio1::reflected_name<T>` | were 6 / 2 and 13 / 3; now 0 | done in 1.13: `psio::fixed_string`, `psio::reflect<T>::fixed_name` |
| `transparent()` 7 / 4 (5 declarations), `invariant(…)` 2 declarations | | PSIO keywords, final |
| `PSIBASE_REFLECT_TABLES` 80, `…_HISTORY_EVENTS` 15, `…_KEY_TRANSFORM` 7, `…_MERKLE_EVENTS` 2 | 104 / 67 | psibase's own macros; they stay, re-implemented over `psio::reflect` |
| `psibase/dispatch.hpp` + `PSIBASE_DISPATCH` | 80 / 79 | done in slice 4a: dispatcher over `reflect<Svc>::invoke_method` / `index_of_method_hash` |
| `Actor<>` / `at<>` | 30 / 10 | done in slice 4a: `psio::reflect<Svc>::proxy<P>` (`P::call<I, &Svc::m>(args...)`) |
| Events (`EventEmitter`, `emit()`) | 39 / 8 | done in slice 4a: same proxy mechanism over the event structs |
| ADL hooks: `psio_unwrap_packable` now 4 / 2 (`Spki.hpp`, `rust/test_fracpack`), `psio_validate_packable` now 1 / 1 (`Spki.hpp`), `psio_custom_schema` 2 / 2, `use_json_string_for_gql` now 2 / 2 (`Spki.hpp`, `SocketInfo.hpp`), `get_gql_name` 3 / 2 | | `SubjectPublicKeyInfo` (D26), the socket variants, `Action` / `ServiceMethod` custom ids (G13 is closed in PSIO: a schema id through `PSIO_INVARIANT(Type, fn, "Id")` or a text adapter; psibase moves these with the schema path) |
| `#include <psio1/reflect.hpp>` | now 0 (was 15; the last 10 removed in slice 4b) | `<psio/reflect.hpp>` |

Every `psio1::` name used outside `libraries/psio1`, `external/` and `doc/`
after the follow-up of 1.13, by kind (`git grep -ohP
'psio1::\w+(::\w+)?'`): 1,605 occurrences in 161 files, and 105
`#include <psio1/…>` lines in 75 files. None of them is reflection.

| Kind | Uses | Names |
|---|---|---|
| reflection (`reflect`, `Reflected`, `FixedString`, `reflected_name`, member lists, `get_type_name`) | 0 | |
| fracpack packing, unpacking, validation | 296 | `to_frac` 88, `from_frac` 72, `convert_to_frac` 45, `prevalidated` 44, `fracpack_validate` 13, `fracpack_validate_strict` 11, `size_tag` 7, `nested` 6, `is_packable` 3, `PackableAs` 2, `from_frac_strict` 2, `unpack_numeric` 2, `fracpack_size` 1 |
| views and shared packed values | 200 | `view` 132, `shared_view_ptr` 60, `get` 3, `remove_view_t` 2, `get_view_data` 1, `const_view` 1, `visit` 1 |
| keys | 109 | `convert_to_key` 87, `composite_key` 12, `to_key` 10 |
| JSON | 246 | `convert_to_json` 62, `convert_from_json` 51, `json::any` 34, `to_json` 33, `json_token_stream` 17, `json::any_object` 16, `from_json` 11, `json::any_array` 5, `write_str` 3, `from_json_object` 2, `json_token_type::…` 4, `nested_json` 1, `detail::write_field_name` 1, `json::null_t` 1, `json::from_json` 1, `json::entry` 1, `from_json_skip_value` 1, `parse_system_time` 1, `format_json` 1 |
| the `bin` format | 279 | `to_bin` 145, `from_bin` 59, `varuint32_to_bin` 33, `varuint32_from_bin` 25, `sleb64_to_bin` 9, `sleb64_from_bin` 3, `varuint64_from_bin` 2, `convert_to_bin` 2, `convert_from_bin` 1 |
| streams | 247 | `input_stream` 158, `vector_stream` 66, `StreamBase` 8, `size_stream` 7, `string_stream` 5, `fast_buf_stream` 2, `fixed_buf_stream` 1 |
| schema | 130 | `schema_types::CompiledType` 23, `schema_types::AnyType` 21, `SchemaBuilder` 17, `FracStream` 16, `schema_types` 8, `schema_types::CustomTypes` 7, `schema_types::CompiledSchema` 7, `Schema` 5, `schema_types::Object` 5, `schema_types::matchCustomType` 4, `schema_types::FracParser` 4, `schema_types::CustomHandler` 3, `SchemaDifference::equivalent` 3, `schema_types::FunctionType` 2, `schema_types::TypeMatcher` 2, `schema_types::standard_types` 1, `schema_types::Struct` 1, `schema_types::Tuple` 1 |
| GraphQL | 8 | `gql_query`, `gql_query_inline`, `gql_stream`, `get_gql_schema`, `generate_gql_whole_name`, `generate_gql_partial_name`, `fill_gql_schema_members`, `make_field_resolver`, 1 each |
| hex | 17 | `to_hex` 6, `hex` 6, `from_hex` 3, `unhex` 2 |
| utilities | 73 | `check` 36, `finally` 33, `is_std_optional` 3, `is_std_optional_v` 1 |

(These are occurrences of the qualified name; sections 2.2–2.6 count call
sites with their own patterns, which also match unqualified uses, so the
numbers there differ.)

### 2.2 C++: binary (fracpack → PSSZ)

| Legacy | Sites / files | Canonical replacement |
|---|---|---|
| `psio1::to_frac(` | 93 / 38; now 87 / 37 | `psio::to_pssz(v)` / `psio::to_pssz(v, sink)` |
| `convert_to_frac` | 35 / 25; now 45 / 27 | `psio::to_pssz(v)` |
| `from_frac`, `from_frac_strict` | 75 / 37 | `psio::from_pssz<T>(bytes)` (validates, then decodes); `psio::from_pssz<T>(psio::trusted{bytes})` after an earlier `psio::validate_pssz<T>`; strict: `psio::validate_strict<T>(psio::pssz{}, bytes)` first |
| `fracpack_validate[_strict]` | 24 / 5 | `psio::validate_pssz<T>(bytes)` / `psio::validate_strict<T>(psio::pssz{}, bytes)` |
| `psio1::view<…>` | 134 / 38 (3 of them mutable); now 130 / 38 | read: `psio::pssz_view<T>` (`psio1::view<const T>` and `psio1::view<T>` that is only read); write: `psio::pssz_mutable_view<T>`, spelled out at the 3 mutating sites and made from mutable bytes only |
| `shared_view_ptr` | 64 / 32; now 67 / 33 | `psio::shared_pssz<T>` (shared, immutable) or `psio::pssz_buffer<T>` (owning) + `psio::as_view` |
| `prevalidated` | 43 / 16 | nothing: a PSIO view assumes validated bytes; a decode without validation is `psio::from_pssz<T>(psio::trusted{bytes})` |
| `psio1::nested<T>` | 4 / 3; now 6 / 3 (`Actor.hpp`, `Rpc.hpp`, XPeers) | `psio::nested<T>` (`psio/nested.hpp`): same role; `nested<T>::from(value)`, `.view()`, `.decode()` |
| `is_packable`, `PackableAs` | 5 / 4 | PSIO shape concepts; `pssz_evolves_from` for compatibility checks |
| `to_bin` / `convert_to_bin` 156/4, `from_bin` 70/5 | `debug_eos_vm/dwarf.cpp`, `psitest/main.cpp`, `TestKV.cpp` | `psio::bin` (`bin.hpp`), or plain stream reads in `dwarf.cpp` |
| Streams: `vector_stream` 66/25, `input_stream` 168/23, `size_stream` 7/4, `string_stream` 5/3, `fixed_buf_stream` 1/1 | | `psio/stream.hpp` sinks; most uses disappear with `encode(fmt, v)` |
| `psio1::to_hex` / `from_hex` / `hex` | 15 / 9 | `psio/to_hex.hpp` |
| `sha256(const T&)` and `Merkle` (hash of the packed form) | `crypto.hpp`; 146 / 76 call sites of `sha256(` | the same functions over PSSZ bytes. Every block, transaction and Merkle id changes at the flip. |

### 2.3 C++: keys

| Legacy | Sites / files | Canonical replacement |
|---|---|---|
| `convert_to_key` | 87 / 28 | `psio::to_key(v)` |
| `to_key(` overloads and calls | 82 / 27 | records and tuples need none; a custom key is a `sortable_binary_category` adapter |
| `composite_key` | 12 / 5 | `psio::key_prefix<Key>(e0, …)` + `psio::key_prefix_upper_bound` |
| `KeyView` | 19 / 4 (`Table.hpp`) | a byte span concatenated in front of `psio::to_key` output; decision D8 |
| `Table<>` / `TableIndex` users | 147 / 45 | unchanged API over the new key functions |
| `PSIBASE_REFLECT_KEY_TRANSFORM` | 7 / 2 | unchanged (psibase's own) |

The two key formats coincide for most types psibase uses as keys: integers
(big-endian, sign-flipped), strings and octet lists (`00` → `00 01`, terminator
`00 00`), lists (`01` + element … `00`), optionals (`00` / `01` + value),
tuples and records (concatenation), fixed arrays. For `AccountNumber`,
a 64-bit name record, the time types and digests they are byte-identical, and
so are composite keys of those with integers, strings, lists and optionals
(checked by `libraries/psio1/tests/canonical_glue_tests.cpp`, which also shows
that the fracpack and PSSZ bytes of those leaf shapes are identical).
Known differences: `optional<bool>` and `vector<bool>` (legacy packs the
presence byte and the value into one byte), `std::pair`, `std::set`,
`std::map`, `std::list`, `std::deque` (not PSIO key types), a variant index
above 127 (legacy varuint, PSIO one byte), and floats (to be compared). Before
the key slice, a temporary test in `psio1` should assert
`psio1::convert_to_key(v) == psio::to_key(v)` for every table key type in the
tree; where that holds the key change is wire-neutral.

### 2.4 C++: JSON

| Legacy | Sites / files | Canonical replacement |
|---|---|---|
| `convert_to_json` | 65 / 25; now 64 / 25 | `psio::to_ijson(v)` |
| `convert_from_json` | 53 / 29 | `psio::from_ijson<T>(text)` (aborts / throws on bad input) or `psio::decode_json_checked(psio::ijson{}, text, out)` (reports) |
| `to_json(` definitions and calls | 160 / 33 | none for records; a custom text form is `PSIO_ADAPTER(T, psio::text_category, …)` |
| `from_json(` / `from_json<` | 46 / 21 | as above |
| `json_token_stream` | 17 / 10 | `psio::JsonCursor` (`json_cursor.hpp`) where a hand-written walk is really needed |
| `psio1::json::any` | 55 / 4 (`package.cpp`, `trace.cpp`, `log.cpp`, `XAdmin.cpp`) | `psio/dynamic_json.hpp` / `dynamic_value.hpp` |
| JSON maps (`to_json/map.hpp`, `from_json/map.hpp`) | 2 includes; 4 `std::map`/`std::set` members in public headers | G8 |
| Hand-written JSON for config (`log.cpp`, `http.hpp`, `psinode/main.cpp`: `Timeout`, `ExtraConfigField`, listen specs, sinks) | ~25 functions | text adapters, or `JsonCursor`; node-local, no cross-language constraint |

I-JSON differs from the legacy JSON visibly to clients:

* a 64-bit integer is a bare number up to 2^53 − 1 and a string beyond (legacy:
  always a string); readers accept both forms;
* NaN and the infinities have no text (legacy: `"NaN"`, `"Infinity"`);
* a time point is RFC 3339 with exactly the unit's fraction digits;
* a missing non-optional member is an error; account names are strict (D2);
* variants are `{"Name": value}` in both (the legacy "untagged" alternative
  hook has no users outside `psio1`);
* byte sequences are upper-case hex in both.

### 2.5 C++: schema and GraphQL

| Legacy | Sites / files | Canonical replacement |
|---|---|---|
| `SchemaBuilder` | 57 / 12 | `psio::SchemaBuilder` → Schema IR |
| `psio1::Schema`, `schema_types::` | 83 / 13 | `psio::schema_types` (`schema_ir.hpp`) |
| `CompiledSchema` | 107 / 9 | `psio::pssz_ir` (`validate_pssz`, `auto_width`, `JsonNames` bound once per schema) |
| `FracParser` | 14 / 4 | `pssz_ir::pssz_to_json` / `json_to_pssz` / `value_to_json` with `CustomHandlers` |
| `psibase/schema.hpp` (`ServiceSchema`, per-service `*-schema.json`) | | Schema IR `Interface`s from `PSIO_INTERFACE`; JSON form: G1 |
| `psio1/graphql.hpp`, `gql_query` | 12 / 6; `serveGraphQL`, `makeConnection`, `TableIndex` users 89 / 23 | the PSIO GraphQL engine being built separately (not in the pinned commit) |

### 2.6 C++: utilities

| Legacy | Sites / files | Replacement |
|---|---|---|
| `psio1::finally` | 33 / 15 (`#include <psio1/finally.hpp>` ×15) | a psibase utility (`psibase/finally.hpp`) or `std::experimental::scope_exit`; PSIO has none. Decision D9. |
| `psio1::check` | 36 / 1 | `psibase::check` |
| `psio1/chrono.hpp` includes | 5 / 5 | `<psio/time.hpp>` |
| `MonotonicTimePoint*` | 8 / 6 (nativeTables, XTimer, XPeers, tests) | PSIO values since the pin move (G2 closed): ticks in PSSZ, key and I-JSON. Nothing to do. |
| `get_type_name` | 4 / 2 | `psio::get_type_name` |

### 2.7 Rust

Superseded by section 6: the exact inventory is in 6.1 (the counts below
matched single-line derive lists only: the tree has 331 `Pack` derives in 87
files, not 288 / 81), the replacements in 6.6, the plan in 6.4.

| Legacy | Sites / files | Canonical replacement |
|---|---|---|
| `rust/fracpack` crate | 4,369 lines (`fracpack.rs`, `view.rs`, `nested.rs`, `schema.rs`) | `psio` crate (`external/psio/rust/psio`, 0.1.0) |
| `psibase_macros` derives: `fracpack_macro.rs`, `to_key_macro.rs`, `schema_macro.rs`, `view_macro.rs`, `graphql_macro.rs`; service macro | | `psio-macros` derives; the service macro stays psibase's and emits PSIO items |
| `#[derive(… Pack …)]` 288 / 81, `Unpack` 285 / 78 | | PSIO PSSZ derive |
| `#[derive(… ToSchema …)]` 243 / 63 | | `ToPsszSchema` (`#[pssz(custom)]`, `#[pssz(transparent)]`) |
| `#[derive(… ToKey …)]` 9 / 4, `ToKey` / `.to_key()` 129 / 23 | | `psio::key` traits, `key_prefix` |
| `#[fracpack(...)]` attributes | 149 / 34 | `#[psio(...)]` / `#[pssz(...)]` |
| `fracpack::` paths | 235 / 108 | `psio::` |
| `.packed()` 223 / 70, `unpack(` / `unpacked(` 287 / 38 | | `psio::encode::<Pssz>` / `decode` |
| serde `Serialize`/`Deserialize` derives 487 / 129, `serde_json::` 517 / 106 | | `psio::JsonText` (I-JSON); decision D10 (plugins and CLI that only talk JSON to HTTP may keep serde, but the text they exchange must be I-JSON) |
| `async_graphql` | 217 / 88 | Rust GraphQL is independent of PSIO; it must emit I-JSON-shaped scalars |
| `#[psibase::service` 110 / 86 (72 crates: 57 user, 12 system, 3+ test), `#[action]` 809 / 115, `#[table(` 154 / 40, `#[event(` 81 / 34 | | unchanged surface; generated code changes |
| psibase types: `AccountNumber` 2036 / 218, `MethodNumber` 169 / 41, `TimePointSec/USec` 135 / 37, `Checksum256` 101 / 29, `Hex<` 68 / 26 | | same names; `TimePoint*` become `psio::time::TimePoint<U>`; `String` ⇔ `psio::utf8_string`, `RawString` ⇔ `std::string` |
| `rust/psibase/src/{to_bin,from_bin}.rs` | | `psio` bin format or removal |
| `rust/test_fracpack`, `rust/test_fracpack_macros` | | deleted with fracpack; PSIO's conformance corpus replaces the C++/Rust cross-check |

Rust is to acquire PSIO by a path dependency into the pinned checkout
(`external/psio/rust/psio`): decisions D11, D28. In the tree since R1.

### 2.8 JavaScript / TypeScript

The survey with counts, what PSIO's JS package offers and what is missing is
in section 6.11.

| Legacy | Where | Replacement |
|---|---|---|
| Pack endpoints: `packAction` (`/pack_action/<m>`), `packTransaction` (`/common/pack/Transaction`), `packSignedTransaction`, `packAndDigestTransaction` | `packages/user/CommonApi/common/packages/common-lib/src/rpc.ts` (399 lines) | same endpoints returning PSSZ (server side flips), or client-side packing with PSIO's JS package (`external/psio/js`: `pssz.ts`, `pssz-json.ts`, `pssz-key.ts`, `schema.ts`) — decision D12 |
| `publicKeyPairToFracpack`, `signatureToFracpack` | `common-lib/src/key-conversions.ts` (277 lines) | PSSZ forms of the same values |
| `SimpleUI.mjs`, `Explorer/ui/src/lib/types.ts` | | I-JSON shapes (variants as `{"Name": v}`, 64-bit numbers) |
| Every UI and plugin that reads service JSON | not counted here | I-JSON; inventory belongs to the JSON slice |

### 2.9 Python

The users of the codec, the tests that depend on it and the size of a
replacement are in section 6.12.

`programs/psinode/tests/fracpack.py` (1,246 lines: a schema-driven fracpack
codec) is imported by `psibase.py`, `psinode.py`, `services.py`,
`test_fracpack.py`, `test_psibase_types.py`, `test_shutdown.py`,
`test_subjective.py`; `packages/user/Exchange/test_math.py`, `test_stops.py`
use it too. Replacement: a PSSZ codec driven by the Schema IR. PSIO has no
Python implementation (G9).

## 3. Proposed order of the remaining slices

Principle: **declarations first, bytes last.** Because `psio1::reflect<T>` is
derived from `psio::reflect<T>` (1.5), a type can be re-declared with PSIO's
macros without changing a byte psibase produces. All ~560 declaration sites can
therefore move in small, green, wire-neutral commits; only then do the bytes
flip, for all languages at once.

| Slice | Content | Wire | Green by |
|---|---|---|---|
| 1 (done) | rename to `psio1`; acquire PSIO; leaf types; glue | unchanged | 90 legacy tests + new |
| 2 (done) | Data records declared with `PSIO_REFLECT`: 422 in 111 files across `libraries/psibase`, `libraries/net`, `libraries/psibase_http`, `programs/*`, `packages/**`; 122 table names with `PSIO_REFLECT_TYPENAME`. 10 records deferred (1.9). Glue: legacy `name` and `data_member_names` shapes. | unchanged (schemas and WASM binaries byte-identical) | pinned records + 92/92 |
| 3 (done) | Every C++ service, events struct, interface and query root declared with `PSIO_REFLECT(..., method(...))`: 124 declarations (528 items) + 15 event-macro sites (28 items). `allowHashedMethods()` removed (inert). Glue: methods bridged into `psio1::reflect` (`member_functions`, `member_function_names`, `proxy` calls). | unchanged | method-metadata twins + 92/92 |
| 2b (done) | Section 1.11. 15 declarations moved: `Memo`, `Precision` (transparent + invariant), `Decimal` (text adapter), `Account`, `LocalUsername`, `PrivateKeyInfo` (transparent), `TimerRow`, `UrlRow`, `TimerQueueRow`, `ServiceSchema`, `DynDepGroups`, `PsinodeServiceConfig`, `TypedAction<T>`, `debug_eos_vm` ×2; `RestartInfo`'s stale reflection deleted. Left: `SubjectPublicKeyInfo` (D26), `IPAddress` / `SocketEndpoint` (at the JSON flip), `rust/test_fracpack` (deleted with the legacy library). | unchanged (schemas byte-identical; pinned forms) | pinned legacy forms + PSIO forms + 92/92 |
| 4a (done) | Section 1.10. As planned: **Method consumers** read `psio::reflect` directly. Unblocked now: all 139 declarations with methods are PSIO. `Actor.hpp` (`Actor`, `transactor`, `EventEmitter`, `ActionViewBuilder`: 13 uses of `reflect<T>::proxy`) → `psio::reflect<T>::proxy<P>`; `dispatch.hpp` → `index_of_method_hash<MethodHash>` + `invoke_method<I>` (a perfect hash instead of a linear scan; two methods of one service whose names collide become a compile error); `schema.hpp` (actions, events), `servePackAction.hpp`, `serveActionTemplates.hpp`, the tester, `test_util.cpp` → `for_each_method`, `method_param_names<I>`, `method_params<I>`. Two things to settle first: PSIO's proxy forwards references where the legacy proxy passes by value (psibase's four proxy objects deduce parameter types from the arguments: decide by-value explicitly), and `make_param_value_tuple` (strips `psio1::view<>` from parameters) needs a psibase-side equivalent until views flip. GraphQL's use of methods stays in `psio1/graphql.hpp` until slice 9. | unchanged | existing; compare schemas and WASM binaries with the previous build |
| 4b (done) | Section 1.12. **Data-member consumers** read `psio::reflect` directly: `Table.hpp`, `schema.hpp` (tables, keys), `zip.cpp`, `Rpc.hpp`, `jwt.hpp`, `XAdmin.cpp`, the data-member parts of `serveGraphQL.hpp`. Nothing outside `psio1` names `psio1::reflect`. `psio1::FixedString` stayed in `psio1` with a helper, `psio1::reflected_name<T>` (G19; replaced in the follow-up). | unchanged (schemas byte-identical) | existing + `tables.cpp` + 92/92 |
| follow-up (done) | Section 1.13. PSIO pin `dfd0db17`. `Precision` message restored (G21); `psio::fixed_string`, `index_of_member`, `member_types`, `Reflected<T&>`, keyword includes (G19, G20, G22, G14); `Decimal::fromStr` rejects overflow (D17). | unchanged, except that a `Decimal` text over 2^64 − 1 is rejected | pinned forms + boundary tests + 92/92 |
| 5 | Rust: replaced by slices R1–R5 of section 6.4 (R1 done; R2 and R3 done as far as they can go before the JSON flip). The earlier idea here — the dying fracpack derive also emits the PSIO impls — is a macro wrapper and is ruled out; types gain the official derives beside the legacy ones instead (6.3). Python and JS: sections 6.11, 6.12. | unchanged | 6.4, 6.5 |
| 6 | **Keys**: C++ `to_key`/`composite_key`/`KeyView` → `psio::key`, `key_prefix`; Rust `ToKey` → PSIO key; native tables. First a test that the two formats agree on every key type in use (2.3); the types where they do not (if any are used) change in one commit for all languages. | unchanged where the formats agree | all tests |
| 7 | **Wire flip**: transactions, blocks, tables rows, actions, events, host/guest ABI structs, P2P messages, snapshots, packages, boot image. C++ `to_frac`/`from_frac`/`view`/`shared_view_ptr`/`nested` → `psio::pssz` APIs; schema generation and schema-driven codecs → Schema IR + `pssz_ir`; Rust derives switch to PSIO's; JS pack endpoints; Python codec; fixtures with packed bytes or ids regenerated. | everything binary changes | all tests; fresh genesis |
| 8 | **JSON flip**: `to_json`/`from_json` → `ijson` in C++; Rust services, CLI, plugins; JS UIs. Client-visible. Can be done before slice 7 as well; it is independent of the binary form. | JSON changes | all tests incl. UI builds |
| 9 | GraphQL onto PSIO's engine (needs that engine). | | |
| 10 | Delete `libraries/psio1`, `rust/fracpack`, `rust/test_fracpack*`, `tests/fracpack.py`, the glue; documentation (`doc/src/specifications/data-formats/*`). | none | |

**The flip point** is slice 7 (with slice 6 immediately before it; they may be
merged). C++, Rust, JS and Python must change in that one commit because a
transaction packed by a client, verified by psinode, dispatched to a C++ or
Rust service and reported through a schema-driven decoder crosses all four.
What must exist before it:

1. every type that crosses the wire declared with PSIO in C++ (slices 2–3
   done; the deferred types of 1.9 in slice 2b) and derivable with PSIO in
   Rust (slice 5). "Declared" is not yet "encodable": before the flip, a test
   in `psibase-psio-tests` should instantiate `psio::encode(psio::pssz{}, …)`,
   `psio::to_key` and `psio::encode(psio::ijson{}, …)` for every record that
   crosses the wire, so that members without a PSIO value (legacy library
   types, leftovers of 1.9) are found by the compiler before the flip commit,
   not in it;
2. the PSSZ decisions per type made explicit where they affect bytes:
   `definitionWillNotChange()` vs. evolvable, `maxDynamicData` caps (they select
   the offset width), length bounds, `utf8_string` vs. `std::string` for every
   string member (Rust `String` ⇔ `utf8_string`);
3. a schema path in all languages: `SchemaBuilder` IR for services (actions,
   events, tables), its serialized form (G1), `pssz_ir` + handlers for
   `AccountNumber`/`MethodNumber` in C++, the same handlers in Rust and JS;
4. a Python PSSZ codec (G9) and JS packing (D12);
5. PSIO resolutions for G1–G8, or psibase-side decisions that avoid them;
6. the conformance fixture of slice 5 extended to transactions and blocks, so
   that the flip is checked by byte equality across languages, not by
   round trips alone.

Working method for the wire-neutral slices (2b, 4a, 4b, the follow-up), as used in slices 2
and 3: snapshot the generated `*-schema.json` files and the md5 of every
`.wasm` in the build directory before the change, and compare after. A slice
that only moves declarations leaves both byte-identical (slice 2 did); a
difference is either explained or a bug.

Two properties of PSIO reflection to keep in mind when adding types:
`psio::reflect<T>` is a class template, so a `PSIO_REFLECT` at namespace scope
must come before the first use of `T` by any serialization code in the
translation unit (an earlier use fixes `T` as unreflected for the rest of it;
the legacy alias was re-evaluated at each use) — keep the macro directly after
the type or inside it; and a name may be listed once per type (a field and a
method may not share one).

**What the wire flip is, exactly, after slice 4b** (C++; names from
`psio/helpers.hpp`, `docs/helpers.md`):

1. Packing: `psio1::to_frac(v[, stream])`, `psio1::convert_to_frac(v)` →
   `psio::to_pssz(v[, sink])` (132 sites); sizes → `psio::pssz_size(v)`.
2. Unpacking: `psio1::from_frac<T>(bytes)` → `psio::from_pssz<T>(bytes)`
   (validating); `from_frac<T>(psio1::prevalidated{bytes})` →
   `psio::from_pssz<T>(psio::trusted{bytes})`; `fracpack_validate<T>` →
   `psio::validate_pssz<T>`; `fracpack_validate_strict<T>` →
   `psio::validate_strict<T>(psio::pssz{}, bytes)` (75 + 24 + 43 sites).
3. Views: `psio1::view<const T>` → `psio::pssz_view<T>` (read-only, about
   127 sites); the 3 sites that write through `psio1::view<T>` →
   `psio::pssz_mutable_view<T>` over mutable bytes, never obtained from a
   read-only view; `MethodArgs<M>` (`psibase/MethodArgs.hpp`) strips
   `psio::pssz_view` instead of `psio1::view`; `Table.hpp`'s
   `get_view_member` calls `psio::pssz_view<C>::get<I>()` and loses its
   legacy proxy call.
4. Shared packed values: `psio1::shared_view_ptr<T>` → `psio::shared_pssz<T>`
   (67 sites; members of `SignedTransaction`, `SignedMessage`, `BlockMessage`),
   read with `psio::as_view`.
5. Nested: `psio1::nested<T>` → `psio::nested<T>` (`TypedAction<T>::rawData`,
   `FracpackHttpReply`, XPeers messages; 6 sites); `psio1::nested_json` needs
   a decision (1 site).
6. Keys (slice 6, with or just before): `psio1::convert_to_key` →
   `psio::to_key` (87), `composite_key` → `psio::key_prefix` (12), `KeyView`
   (D8).
7. Schemas: `psio1::SchemaBuilder` / `psio1::Schema` / `CompiledSchema` /
   `FracParser` → `psio::SchemaBuilder`, the Schema IR and `pssz_ir`
   (`ServiceSchema` is rewritten over them); `Decimal`, `Memo`, `Precision`
   become `Custom` nodes there and need handlers or are left to their wire
   type; `Action` / `ServiceMethod` need their custom ids (G13 closed).
8. Hashes of packed forms (`sha256(const T&)`, Merkle) switch with item 1;
   every block, transaction and event id changes.
9. Delete the glue of section 1.5 that only serves packing:
   `psio1/fracpack.hpp` lines 11–29 and 69–84, `psio1/schema.hpp`
   1686–1709; the rest goes with the JSON flip (`to_json.hpp`,
   `from_json.hpp`), the GraphQL swap (`graphql.hpp`, `canonical_reflect`
   with its `FixedString` name) and the deletion of `psio1`.
10. Still to declare before it: `SubjectPublicKeyInfo` (D26); the per-type
    PSSZ decisions of item 2 of the list above (`definitionWillNotChange`,
    `maxDynamicData`, bounds, `utf8_string`); the "everything encodes" test
    of item 1 of the list above, which is now writable for every record
    except those holding a `SubjectPublicKeyInfo`, a socket variant or a
    legacy library member type.

How large the flip commit is depends on decision D1: either the legacy entry
points (`psio1::to_frac`, `from_frac`, `view`) are first redirected to PSSZ
inside `psio1` for PSIO-declared types (a small flip in C++, then wire-neutral
renames of ~500 call sites), or the call sites are rewritten in the flip
commit itself.

## 4. Decisions for the owner

| # | Decision made or needed | Default taken in slice 1 |
|---|---|---|
| D1 | Shape of the wire flip: redirect `psio1::to_frac/from_frac/view` to PSSZ inside `psio1` first (temporary, small flip, then wire-neutral call-site renames), or rewrite all call sites in the flip commit. | Not decided; the first is recommended. |
| D2 | `AccountNumber` text is strict (one text per value). Clients that send upper case or otherwise non-canonical names will be rejected once JSON flips. | Strict. |
| D3 | `MethodNumber` text accepts source identifiers and the hash form, rejects only text that names no method. Its text is therefore not one-per-value. The legacy mapping is kept exactly, including its oddities (`set_code` reads as `setqcode`, `a1` as `aa`). | Lenient as described. |
| D4 | Digests stay `std::array<uint8_t, N>` (hex in I-JSON by PSIO's rule) rather than `psio::byte_array<N>` or a named type with its own schema id. | `std::array`. |
| D5 | `Memo`: (a) no standard. (b) psibase: a struct with `.contents`, constructors that abort, packed as its string, validated on unpack. (c) PSIO offers two forms: `psio::utf8_string<80>` (a bounded string type; the bound is part of the type and may narrow the PSSZ length / offset width; no `.contents`) and a `transparent()` record with an `invariant` (the struct as it is; on the wire exactly a `std::string`). Taken in slice 2b: transparent + invariant, because it leaves the 99 uses and the API alone and is wire-neutral now. Open for the flip: whether `contents` becomes `psio::utf8_string<80>` (bound and UTF-8 enforced by PSIO, width chosen by the bound) — that changes PSSZ bytes and is the owner's call. | Transparent wrapper over `std::string`. |
| D6 | Any 64-bit value is a valid `AccountNumber` / `MethodNumber` in PSSZ and key (as today). An invalid value's text does not read back (`AccountNumber{~0}` writes `"+255"`). Rejecting such values on PSSZ decode needs a validation hook (G5). | Accept, as today. |
| D7 | `allowHashedMethods()` was inert and is removed (1.7): the check it switched off was never instantiated, and 30 method names in 10 types do not compress (23 in the three services and one events struct that said the keyword, 7 in six types that did not). Hashed method names work and are in use. Needed: does psibase want the rule "method names compress" at all? If yes, it belongs in psibase (a `static_assert` over `psio::reflect<Svc>::method_names` where a service or events struct is dispatched or emitted), the seven names above must be renamed or opt out, and the opt-out needs a psibase spelling (PSIO has no keyword; whether a psibase-defined spec can be attached with `PSIO_TYPE_ATTRS` was not established). | Removed; no rule enforced, as before. |
| D8 | `KeyView` (pre-encoded key prefix) has no PSIO type; psibase keeps a small own type that concatenates bytes with `psio::to_key` output. | — |
| D9 | `psio1::finally` is not serialization; it needs a home in psibase. | — |
| D10 | Rust code that only exchanges JSON over HTTP: keep serde with I-JSON-conforming impls for psibase types, or move to `psio::JsonText`. | — |
| D11 | Rust acquisition of PSIO: Cargo `git` dependency pinned to the CMake pin's commit (and a check that the two agree). | Superseded by D28 (a path dependency into the checkout CMake pins). |
| D12 | JS: keep server-side pack endpoints, or pack in the client with PSIO's JS package and the service's Schema IR. | — |
| D13 | PSIO's `-Werror=unused-result` (an INTERFACE option of `psio::psio`) now applies to every psibase native target. The tree builds clean with it. | Accepted. |
| D14 | `psio1` now requires PSIO headers and C++23 everywhere it is compiled (also `rust/test_fracpack`, previously `gnu++2a`). | Accepted (temporary). |
| D15 | `tests/cmake/dependencies/README.md` was rewritten where it described PSIO as dormant. | — |
| D16 | Which records count as convertible now (1.6): a record is declared with PSIO when its reflection line is final, even if a member's type is a legacy library type that changes at the flip (`shared_view_ptr`, `view`, `json::any`, `psio1::Schema`) or a deferred type. It is deferred only when its own declaration must change (a member with no PSIO value: `std::map`, `nested<T>`, monotonic time; or a legacy wrapper / validation / text hook on the type itself). The alternative — convert only records that already encode with PSIO — would have deferred `SignedTransaction`, the P2P block messages and everything holding a key, a `Precision` or a socket endpoint. | As described. |
| D17 | `Decimal` text. (a) No standard. (b) psibase `fromStr`: digits with at most one `.`; at least one digit; at most 8 fraction digits (the precision); accepts `.5`, `5.`, leading zeros; aborts otherwise; **and wraps silently** when integer part × 10^p + fraction exceeds 2^64 − 1 (`"184467440737.09551616"` reads as 0 at precision 8: `quantity_val += …` is unchecked). (c) PSIO: the JSON reader calls the adapter's `validate`, then `decode`; `validate_strict` is for strict readers. Taken: `validate` = what `fromStr` reads, minus the overflow case (rejected); `validate_strict` = only the spelling `str()` writes; `decode` = `fromStr`. **Decided by the owner: overflow is rejected.** Since 1.13 `fromStr` aborts with "Invalid number: overflow" instead of wrapping, so the legacy JSON path rejects it too and all readers accept the same texts. The Rust parser still wraps in release builds (1.13); it is to be changed with the Rust slice. `Precision` is done (transparent + invariant). | Overflow rejected everywhere in C++. |
| D18 | `PSIO_INTERFACE(Svc)` (the Schema IR's interface envelope) is not added to services in slice 3: nothing reads it until the schema path moves to the IR, and its item list (`types(…)`, `funcs(…)`) repeats what `PSIO_REFLECT` already states. Decide in the schema slice whether psibase derives interfaces from `psio::reflect<Svc>` methods (preferred: one declaration per service) or writes `PSIO_INTERFACE` 124 times. | Not added. |
| D19 | `PSIO_REFLECT(RestartInfo, shouldRestart)` in `programs/psinode/main.cpp` listed a member that does not exist; the reflection was unused. | Deleted in slice 2b. |
| D20 | The documentation examples (`doc/src/development/services/cpp-service`) and `demo/` taught and used `PSIO1_REFLECT`. | Converted in slice 4a (required: `PSIBASE_DISPATCH` no longer dispatches a legacy-declared service). The `demo/` service is built by its own script and was not rebuilt. |
| D22 | Call proxies and argument copies. (a) No standard applies. (b) psibase before: the legacy proxy took every argument by value and handed the proxy object rvalues of the decayed types; `ActionViewProxy` chose "pack as given" or "convert to the parameter type" from those types. (c) PSIO: the proxy forwards references and has no by-value mode (G15). Taken: the proxy objects keep the decision on the decayed type (same bytes, same accepted argument types) but no longer copy — an lvalue argument is read in place. The alternative is an explicit by-value hop in each proxy object, which reproduces the old code exactly at the cost of a copy or move per argument. | By reference, decayed types. |
| D23 | Two reflected methods of one service with the same `MethodNumber`. (a) No standard. (b) psibase before: accepted; the first one listed was called, the second was unreachable (and the schema kept only the first). (c) PSIO: `index_of_method_hash` makes it a compile error. Taken: PSIO's behaviour; no service in the tree is affected. The check applies to services that are dispatched (`PSIBASE_DISPATCH`), not to events structs or interfaces. | Compile error. |
| D24 | `EventEmitter::from(sender)` constructs `EventEmitter(sender, elog)`, a constructor `EventEmitter` does not have; it compiles only because nothing calls it. Not introduced by this work and left as found. Delete it or give `EventEmitter` the constructor. | Left. |
| D25 | Which PSIO custom types the legacy schema marks `Custom`. (a) No standard. (b) psibase: `AccountNumber`, `MethodNumber`, `Action`, `ServiceMethod` and the time points, by ADL hook. (c) PSIO: every type with a text adapter or an invariant is `Custom{wire type, id}` in the Schema IR. Taken for the legacy schema (glue): only a type whose text adapter states a `schema_id`; so `Decimal`, `Memo`, `Precision` are not `Custom` in today's schemas (byte-identical) and become `Custom` in the Schema IR at the flip. Needed at the flip: are those three meant to be custom nodes for schema-driven tools (Rust, JS, Python must then know the ids `Decimal`, `Memo`, `Precision`), or plain wire types? | Legacy schema unchanged. |
| D26 | `SubjectPublicKeyInfo` is the last wrapper on legacy hooks. Its canonical form is clear (`transparent()` over the DER bytes, an `invariant`, a PEM text adapter with `schema_id`), but both its validator and its PEM parser abort (Botan throws natively, aborts in a guest) and PSIO requires them to report (stated in `psio/invariant.hpp` and `psio/adapter.hpp` at `dfd0db17`). Needed: a reporting DER structure check and PEM check (in psibase; small), or a decision that key material is validated only where it is used. The owner leans to the second: opaque bytes on the wire, parsed where used. What that involves and who relies on the decode-time check today is in the note below this table. | Not converted. |
| D27 | The message of an out-of-range `Precision` read from packed data or JSON lost the offending value (1.11). | Resolved in 1.13 by PSIO (`codec_fail_owned`, G21): the message names the value again. |
| D28 | How Rust gets the `psio` crate. (a) PSIO: the crate is `rust/psio` in the repository, version 0.1.0, not published; its derives name `::psio`. (b) psibase: every Rust dependency of its own is a path dependency; `fracpack` is reached through `psibase`. (c) Proposed, and what the R1 patch does: `psio = { path = "../external/psio/rust/psio" }` in `rust/Cargo.toml` — the checkout CMake fetches and verifies against the one pin, so C++ and Rust cannot use different PSIO commits and no second copy exists. Cost: Cargo works only in a configured tree. Open: services built outside the tree (RG10). | Taken with R1: path into the pinned checkout. |
| D29 | `Hex<T>` and the PSIO declaration of records that hold it. (a) PSIO: `Vec<u8>` and `[u8; N]` are hex strings in I-JSON; no wrapper is needed. (b) psibase: `Hex<Vec<u8>>` / `Hex<[u8; 32]>` (65 uses) exist so that serde writes hex. (c) Recommended: the member type becomes `Vec<u8>` / `[u8; N]` when the record's serde derives become `psio::Serde` (R8); until then a record with a `Hex` member either waits with its PSIO derives or `Hex<T>` is given `#[psio(transparent)]` for the interval. The second adds a line that R8 deletes; the owner's call. **First decided: no interim workaround** (31 of the 76 core records waited, 6.14). **Revised by the coordinator and done (6.16):** `Hex<T>` is needed between the wire flip and the JSON flip in any case and PSIO will not change for it, so `#[psio(transparent)]` is its declaration for that period; 21 of the 31 are declared, the other 10 wait for other reasons. The earlier text follows. That is most of the core — `Action`, `Claim`, `SignedTransaction`, the consensus records, the HTTP request and reply, the traces — and it means the compiler and the shared vectors do not pass over them before the flips, which was the reason for declaring early (6.3). If the owner prefers that evidence to the purity of the interval, the cheapest form is `#[psio(transparent)]` plus the binary and schema derives on `Hex<T>` (one type, deleted at R8). | Done: `Hex<T>` is transparent (6.16). |
| D30 | `rust/psibase_names`: `account_number_from_str` panicked on a subaccount that is not a number from 0 to 255 (`"alice+"`), and the hash-form parser of `method_number_from_str` underflowed on a character outside the alphabet. (a) PSIO: a text form reports (`TextForm::from_text` returns `None`). (b) psibase: text that is not a name is value 0 for every other malformed input. (c) In the R1 patch: both return 0. Reachable today from any JSON that names an account or method. The fix does not depend on PSIO. | Fixed with R1 (6.10). |
| D31 | Rust additive declarations (6.3): types carry the official PSIO derives beside the legacy ones until the flip deletes the legacy names. The alternative is to change declarations and wire in one commit. | Taken: R1–R3 are written that way. |
| D32 | Rust text of `MethodNumber` and `AccountNumber` under PSIO is C++'s (D2, D3): strict account names, lenient method names. serde (what services and the CLI use today) stays lenient until R8; then `ExactAccountNumber` is deleted. | Taken with R1: as C++. |
| D33 | Which method coder is psibase's. (a) PSIO (`psio::compress_name`, Rust and C++, byte-identical to psibase's legacy C++): a name whose arithmetic code runs past 64 bits in its last partial byte keeps the truncated code — not marked as a hash, not reading back as the name (`getSymbolType` → `0x7ea96086faa7f7c0` → `getsymboltyp`); `#` text that is not 17 characters is `u64::MAX`. (b) psibase Rust (`rust/psibase_names`): such a name is its hash (`#hmlnslheseoypnnp`); such `#` text is 0. So psibase's C++ and Rust disagree today on 15 action and event names in the tree, 5 of them declared in both languages (`checkFirstAuth`, `removeCallback`, `getSymbolType`, `cpu_min_unit`, `get_resources`). (c) Not changed: `MethodNumber` keeps psibase's Rust coder, the difference is pinned by a test, and it is reported to PSIO as RG12. Recommended: PSIO adopts the Rust rule (a name that does not fit is hashed, whichever bit it overflows by), C++ follows through the pin, and then Rust deletes its method coder; the alternative is that Rust adopts the truncated codes, which changes the numbers of the Rust actions in the class and keeps a coder under which two names can share a number unnoticed. Either way the numbers of some existing methods change in one language, so it belongs to the flip. | Open. `psibase_names` unchanged. |
| D34 | Time in Rust. (a) PSIO: `psio::time::TimePoint<U>` / `Duration<U>`; text is RFC 3339 UTC with exactly the unit's fraction digits, a duration its tick count; GraphQL scalars `DateTimeSeconds`, … (b) psibase Rust: its own structs; JSON through chrono (`…+00:00`, fraction only when not zero, any offset read, excess fraction dropped), a duration `{"value":5}`; GraphQL scalars `TimePointSec`, `TimePointUSec`. (c) Not changed: replacing the types changes JSON and GraphQL, and before the wire flip would need legacy `Pack` impls for PSIO's types inside `rust/fracpack`. The types are replaced at R7 / R8; nothing is missing in PSIO for it (6.13). To confirm: that the GraphQL scalar names may change, and whether Rust should match C++'s single `DateTime`. | Waiting for R7 / R8. |
| D35 | Raw or UTF-8, per string member. A Rust `String` is UTF-8 and a C++ `std::string` raw; eight of the records declared in both languages differ in exactly that (6.14). Per member either C++ gains `utf8` or the Rust member becomes `RawString`; the audit has a recommendation for each. | Open; the cross-check lists the eight. |
| D36 | Rust declarations that are not the C++ ones today: `ConfigRow` (C++ has `maxBlockSize`), `LogMessage` (member order), `SocketInfo` (four alternatives against six, in another order) and `ProducerMultiCastSocketInfo` (name), `RunMode` (C++ an enum), `SignedBlock` (C++ has `auxConsensusData`). Found by reading the two declarations for the cross-check; not by a test, because nothing in Rust reads these rows from a node today as far as was seen. (c) Corrected in 6.17 (the owner's instruction), with who used each and what covers it; `RunMode` turned out not to be wrong on the wire. | Done (6.17); `SocketInfo` and `SignedBlock` have no test yet. |
| D37 | `Memo` in C++. The Rust PSIO declaration states the flip's form (UTF-8, at most 80 bytes, as a bound). C++ still says `transparent(), invariant(wellFormed)` over a raw string, which the legacy glue needs until the flip. The two give the same bytes and text for a memo, another schema node and possibly another width inside a record. At the flip C++ becomes `attr(contents, utf8 \| max<80>)`; whether the invariant stays beside it decides whether the schema calls the type `Custom{…, "Memo"}` — Rust must then say the same. | Open; the difference is pinned (6.15). |
| D38 | A second wrap in the Rust decimal parsers, fixed with the approved one: fraction digits were counted with `len() as u8`, so a fraction of 256 digits counted as none (`"5." + 255 zeros + "1"` read as 6 at precision 0). (a) No standard. (b) C++ `Decimal::parse` rejects more than 8 fraction digits by length. (c) Fixed to reject (`PrecisionOverflow`), with tests; not in the list of approved changes, so stated here. | Fixed with R2; revert `u8::try_from` in `quantity.rs` and `decimal.rs` if unwanted. |
| D39 | The alternatives of a variant. (a) PSIO: an alternative has a label (the member name in the Schema IR: in C++ its index, `"0"`, `"1"`, unless `psio::schema_variant_labels<V>::names` states labels; in Rust the enum variant's identifier) and a text name (the attribute `ijsonName`: in C++ the alternative's type name; in Rust the variant's identifier unless `#[psio(name = "...")]`). (b) psibase: C++ `ConsensusData` is `std::variant<CftConsensus, BftConsensus>` and its JSON is `{"CftConsensus": ...}`; Rust is `enum ConsensusData { CFT(..), BFT(..) }` and serde writes `{"CFT": ...}` — the two already disagree in JSON today. Same for `InnerTrace::inner`, `SocketInfo`, `SocketEndpoint`, `IPAddress` (there the Rust variants are named after the types). (c) Not changed; `ConsensusData` and the three records that hold it wait. Recommended: C++ states the labels (`schema_variant_labels`, an additive declaration) and they are the Rust variant identifiers; the text name is the C++ type name, so Rust says `#[psio(name = "CftConsensus")]` and, at R8, serde's name follows. | Open. |
| D40 | Enums on the wire. (a) PSIO: a C++ enum without `PSIO_REFLECT_ENUM` is its integer (schema `Int`, text a number, every value accepted); with it, and a Rust `#[repr(int)]` enum, it is an `Enum` node, its text is the enumerator's name and a value that is no enumerator is rejected. `docs/annotations-for-agents.md` D9: give an enum an explicit underlying type and reflect it. (b) psibase C++ reflects no enum: `RunMode`, `NewAccountMode`, `NotifyType`, `LogMessage::Severity`, `HttpStatus` are integers in pSSZ and, where they have JSON at all, numbers. Rust mirrors them as integers or one-member structs. (c) Taken: Rust says what C++ is today (`RunMode`, `NewAccountMode`: `#[psio(transparent)]` over `u8`; the others plain integers), and the fixture proves it. If C++ reflects an enum, its Rust twin becomes a `#[repr]` enum in the same commit; that changes JSON (names) and rejects unknown values, so it is a flip-time choice per enum. | As C++ today. |
| D41 | Bytes in C++: `std::vector<char>` or `std::vector<std::uint8_t>`. (a) PSIO: both are hex; the first is hex over `char`, the second over `u8`, and PSIO's guide says byte data is `std::vector<std::uint8_t>` (`annotations-for-agents.md` D4). Rust has only `Vec<u8>`. (b) psibase C++: 446 `std::vector<char>` in 143 files, among them `Action::rawData`, `Claim::rawData`, every code and signature member. (c) Not changed; the cross-check lists the 14 records that differ in this only. Either PSIO makes the two the same node (RG14), or psibase C++ moves its byte members to `std::uint8_t` at the flip (a wide, mechanical change), or the Schema IR of the two languages differs in the element id and schema-driven tools must treat `char` as `u8` (they already do: same bytes, same text). | Open. |
| D42 | A parameter name C++ reflects differently from how it declares it: `AuthDelegate::getOwner(AccountNumber account)` and `checkOwner` are reflected as `method(getOwner, owner)`. (a) PSIO: the reflected name is the parameter's name in JSON and in the schema. (b) psibase: clients and the generated schema say `owner` today; the Rust view said `account`. (c) Taken: Rust says `owner` (6.19). If the reflection is the mistake, correcting it in C++ changes `AuthDelegate-schema.json` and the JSON of the two actions' arguments, so it belongs to a flip. | Rust follows the reflection. |
| D43 | Names of generated interfaces. (a) PSIO: an interface has a name (C++ default: the class name; Rust default: the trait's identifier) and optionally a package. (b) psibase: a service is known by its account (`"setcode"`) in both languages; the class and module names differ (`SetCode`, `service`). (c) Taken for the three services of 6.19: the account name, in both languages. To decide with D18: that rule, a package name and version (the psibase package?), and what the two events interfaces of a service are called (`<account>.history`?) — until then the macro does not declare events. | Account name; events wait. |
| D21 | `psio-tests` now links `psibase` (and through it the service headers) so that the glue test can pin psibase's own records. Temporary, deleted with `psio1`. | Accepted. |

**Note on D26: `SubjectPublicKeyInfo` as opaque bytes.** Nothing was changed;
this is what the conversion would be and what it would change.

*The change.* In `packages/system/AuthSig/include/services/system/Spki.hpp`:
`PSIO_REFLECT(SubjectPublicKeyInfo, transparent(), data)` in the struct;
delete the two `psio_unwrap_packable` overloads (lines 29–36), `psio_validate_packable`
(37–40) and `to_key` (55–58) — the glue of 1.5 gives a `transparent()` type
its member's packed form, view and key, as it does for `PrivateKeyInfo`.
`SubjectPublicKeyInfo::validate` stays as an ordinary function for callers
that want the check. The PEM text form is a separate matter: the ADL
`to_json` / `from_json` / `use_json_string_for_gql` (lines 47–62) either stay
until the JSON flip (expected to keep winning over the glue's generic
overloads for a `transparent()` type, as the type's own non-template
overloads; not tried), or become a `text_category` adapter — whose
`validate` must report, so a PEM / DER check that does not throw is still
needed for the JSON side even without an invariant. Expected to be
wire-, key- and schema-neutral (bytes are the member's; the legacy schema of
a `PackableWrapper` is its wrapped type's); not built, so not verified.

*What would change in behaviour.* Today every unpack and every
`fracpack_validate` of a value containing a `SubjectPublicKeyInfo` runs
`Botan::BER_Decoder` over it (`Spki.cpp:13`: SEQUENCE { AlgorithmIdentifier,
BIT STRING }, nothing about the algorithm, the curve or the point) and
aborts on bytes that are not that. Without the invariant such bytes are
accepted at decode.

*Who relies on the decode-time check.* Only the entry points that store or
forward a key without looking at it:
`AuthSig::setKey` and `AuthSig::newAccount` (`AuthSig.cpp:54`, `:77`) put
the argument into `AuthTable` as it is; `Invite::createAccount`
(`Invite.cpp:207`) fingerprints it and forwards it to `newAccount`;
`XKeys::deleteKey` (`XKeys.cpp:92`) and `CredResThief::bill` hash it. For
these the action-argument validation is the only thing that keeps bytes that
are not a SubjectPublicKeyInfo out of `AuthTable`: an account could then set
a key no signature can satisfy (it can already do that today with a
well-formed structure holding an unusable key). Nothing that *uses* a key
relies on it: `AuthSig::checkAuthSys` (`AuthSig.cpp:26`) compares the stored
bytes with the claim's bytes; `VerifySig` (`VerifySig.cpp:25`) parses the
claim's bytes itself with `Botan::X509::load_key` and fails there on a
malformed key; `RAuthSig.cpp:36` and `parseSubjectPublicKeyInfoFromPem`
call the PEM parser and `validate` explicitly. The Rust side already treats
the type as opaque bytes: `SubjectPublicKeyInfo(pub Vec<u8>)`
(`rust/psibase/src/services/auth_sig.rs:9`) derives `Pack` / `Unpack` with no
structure check and checks only the PEM label in JSON. No test was found
that expects a malformed key to be rejected at decode (searched the AuthSig,
Invite, XKeys, Credentials and signature tests for such expectations; not an
exhaustive proof). If the owner wants `setKey` / `newAccount` to keep
refusing garbage, an explicit `SubjectPublicKeyInfo::validate(key.data)` in
those two actions preserves it without any decode-time hook.

## 5. Where PSIO lacks something psibase needs

C++ (G1–G23) below. What PSIO's Rust crate lacks is in section 6.8
(RG1–RG13; RG1–RG9 and RG11 are closed at `415ea1a6`); JavaScript in 6.11; Python is G9
and 6.12.

| # | Header | Missing | Why psibase needs it | At `dfd0db17` (G1–G13, G15–G18: as found at `868e37bb`, not re-checked) |
|---|---|---|---|---|
| G1 | `psio/json.hpp`, `schema_ir.hpp` | A `psio::schema_types::Schema` cannot be written or read as JSON: `psio::encode(psio::json{}, schema)` fails to compile (`Box<AnyType>`: "unsupported type in encode_value"). Only the PSSZ form (`emit_pssz`) exists. | psibase publishes service schemas as JSON (`*-schema.json` in packages, `/schema` queries, the CLI, UIs). Either PSIO defines the IR's JSON form, or psibase ships IR bytes and every consumer decodes them. | Closed, verified: `psio::to_json(schema)` of a built `schema_types::Schema` compiles and runs. |
| G2 | `psio/time.hpp` (static assertion, line 97) | Only `system_clock` time points are values. | `MonotonicTimePointSec/USec` are stored and passed by `nativeTables.hpp`, XTimer and XPeers (7 uses). Either PSIO accepts a caller-declared epoch-less clock (binary = ticks, JSON = ticks), or psibase stores these as durations. | Closed, verified and used: a time point of another clock is its tick count (`wrappers.cpp`). |
| G3 | `psio/adapter.hpp`, `schema_builder.hpp` | No transparent wrapper ("newtype") with (a) the inner type's wire and key form, (b) its own text form, (c) a validation hook, (d) a schema node. A `binary_category` adapter gives (a) but "a binary adapter is not expressible" in the IR, and `schema_custom_v` requires a reflected record or an enum. | `SubjectPublicKeyInfo` (DER bytes on the wire, PEM in JSON, validated when unpacked, keyed by its bytes). Reflecting it as a one-member record would add a level to the wire and JSON forms. Rust has `#[pssz(transparent)]` + `#[pssz(custom)]`; C++ has no equivalent. | Closed, verified and used: `transparent()` (`psio/transparent.hpp`). |
| G4 | `psio/adapter.hpp` (`schema_custom_v`) | A text presentation for a type that is not a reflected record or enum — e.g. a `std::variant` alias. | `IPAddress` and `SocketEndpoint` are variants written as one string (`"127.0.0.1:8080"`). | Closed, verified by a probe (a `std::variant` alias with a text adapter and `schema_id`); not used yet (1.9). |
| G5 | `psio/pssz.hpp`, `annotate.hpp` | No per-type semantic validation hook that `validate` / `validate_strict` call for a reflected record (the role of `psio_validate_packable`, 5 uses). | Rejecting invalid values at the wire boundary (names that are not names, D6; key material). | Closed, verified and used: `invariant(fn)` (`psio/invariant.hpp`). |
| G6 | `psio/mutable_view.hpp` | `mutable_view` is a forward declaration only. | 3 call sites mutate fixed-size fields through `psio1::view<T>` in place. They can be rewritten as decode–modify–encode. | Closed, verified by a probe: `psio::pssz_mutable_view<T>` overwrites a fixed-size member. Not used yet (flip). |
| G7 | `psio/wrappers.hpp` | No C++ `nested<T>` (a member that is the PSSZ bytes of a `T`, typed). Rust has `nested.rs`. | `Actor.hpp` (typed action arguments inside `Action::rawData`), `Rpc.hpp` (`FracpackHttpReply`), XPeers. | Closed, verified by a probe: `psio::nested<T>`. Not used yet (flip). |
| G8 | `psio/pssz.hpp`, `json.hpp`, `key.hpp` | `std::pair`, `std::map` and `std::set` are not values in PSSZ, JSON or key (`shapes.hpp` only detects them); there is no JSON object with dynamic keys. | 3 `std::pair` and 4 `std::map`/`std::set` members in public headers; `to_json/map.hpp` users (package metadata, config). Pairs become tuples and maps become sorted lists of records; both change bytes or JSON, so they change at the flips. | Closed, verified: `std::pair`, `std::map`, `std::set` encode in PSSZ, key and I-JSON; a string-keyed map is a JSON object, another map a list of pairs. Used (`DynDepGroups`). |
| G9 | — | No Python implementation. | `programs/psinode/tests/fracpack.py` drives the node tests. psibase must write a schema-driven PSSZ + I-JSON codec in Python, or drive the tests through server-side pack endpoints. | Open (not a C++ matter). Sized in section 6.12: 1,000–1,500 lines for what the tests use, 2,500–4,000 for a conformance-grade codec. |
| G10 | repository root | No `LICENSE` file at the pinned commit. | The SDK installs a licence file for every bundled dependency (`share/psibase/licenses`); PSIO's headers are now installed without one. | Not re-checked. |
| G11 | `psio/pssz.hpp:896` | `-Wall` warning (`unused type alias 'E'`) in every TU that encodes PSSZ. | psibase test targets build with `-Wall`; harmless, noisy. | Reported closed; not re-checked. |
| G12 | PSIO GraphQL | Not in the pinned commit. | `psio1/graphql.hpp` (1,704 lines) serves 23 files of GraphQL users. | A GraphQL engine is in the pin (`psio/graphql.hpp`, `psio/graphql/`); not evaluated here (slice 9). |
| G13 | `psio/adapter.hpp` (`schema_custom_v`), `schema_builder.hpp` | A custom schema id for a reflected record that has no text adapter. | `Action` and `ServiceMethod` are marked `psio_custom_schema` so that schema-driven tools recognise them (an action's `rawData` is decoded with the target service's schema). In PSIO a record is `Custom{…, id}` only when it has a text presentation. The legacy hooks still serve; the Schema IR path needs either this or name-based recognition in psibase's handlers. | Reported closed (a schema id through `PSIO_INVARIANT(Type, fn, "Id")`); not used or verified here. |
| G14 | `psio/reflect.hpp` | `PSIO_REFLECT(T, definitionWillNotChange(), …)` does not compile with `<psio/reflect.hpp>` alone: the keyword expands to `psio::definition_will_not_change`, declared in `<psio/annotate.hpp>`. | A header that only reflects records must know to include `annotate.hpp` (`SocketInfo.hpp` does). `reflect.hpp` should include what its own keywords need. | Closed, verified and used: `reflect.hpp` includes `annotate.hpp` at its end. The psibase headers that included `annotate.hpp` / `transparent.hpp` / `invariant.hpp` for the keywords no longer do, and the tree builds (1.13). (Was: `PSIO_REFLECT(A, definitionWillNotChange(), x)` after `reflect.hpp` alone → "no member named 'definition_will_not_change' in namespace 'psio'".) |
| G15 | `psio/reflect.hpp` (proxy) | The record proxy passes method arguments as forwarding references; there is no by-value mode. | psibase's call proxies deduce the packed parameter tuple and `PackableAs` checks from the argument types; the legacy proxy decays them first. Since slice 4a psibase's proxy objects decay the types themselves (D22) and the glue for it is deleted. Not a defect, a difference to design for. | By design; documented in `reflect.hpp`. |
| G16 | `psio/reflect.hpp` (`PSIO_REFLECT_METHODS_EMPTY_`) | A type that lists no method has `method_count`, `method_names`, `method_type<I>`, `method_pointer<I>`, `method_name<I>`, the lookups and `for_each_method`, but not `method_param_names<I>`, `method_traits<I>`, `method_result<I>`, `method_args<I>`, `method_params<I>`, `method_is_static<I>`, `method_is_const<I>`, `invoke_method<I>`. | Generic code that names `psio::reflect<T>::method_param_names<I>` inside a per-method callback does not compile for a class without methods (`EmptyService`, a service with no actions), although the callback is never called: once `T` is known the name is looked up in a class that does not have it. Reproduction: `generateActionJsonTemplate<psibase::EmptyService>()` with `reflect::template method_param_names<I>` in the callback fails with "no member named 'method_param_names' in 'psio::reflect<psibase::EmptyService>'". Glue: `psio1::canonical_method_param_names<T, I>` (`psio1/reflect.hpp`, end of file), used by `schema.hpp`, `servePackAction.hpp`, `serveActionTemplates.hpp`. Fix in PSIO: declare the same member templates in the empty case, as it already does for `method_type` / `method_pointer` / `method_name`. | Closed, verified; glue deleted. |
| G17 | `psio/reflect.hpp` (`for_each_method`) | `for_each_method(fn)` calls `fn(index, name, &T::method)`: the pointer is passed as a value, which odr-uses every reflected method. There is no walk that gives only the index (or the index and the name). | Code that describes a service without containing it — the `R*` query services that serve `/pack_action`, `/action_templates` and the schema of another service, and schema generation — would need every method's definition at link time. Reproduction: with `for_each_method` in `fracpackActionFromJson`, `RAccounts.wasm` fails to link: "wasm-ld: error: … RAccounts.cpp.obj: undefined symbol: SystemService::Accounts::init()" (and every other action). The legacy walk passed a null pointer of the method's type. Glue: `psio1::canonical_for_each_method_index<T>(fn)` (`psio1/reflect.hpp`, end of file), `fn(std::integral_constant<std::size_t, I>, name)`. Fix in PSIO: an index-only walk, or `for_each_method` passing the index and name only (the pointer is `method_pointer<I>`). | Closed, verified (`RAccounts.wasm` and the other query services link); glue deleted. |
| G18 | `psio/reflect.hpp` (proxy) | `Projection::call<I, &T::method>` is told the index and the member pointer but not the reflected type `T`. For a method `T` inherits, `&T::method` has the type `R (Base::*)(…)`, so the proxy object can only recover `Base`, in whose reflection `I` means something else (or nothing). | psibase's proxy objects turn `(I, MemberPtr)` into the method's name (`methodNumber<I, MemberPtr>`). The legacy proxy had the same limitation (it also derived the class from the member pointer), so behaviour is unchanged and nothing is worked around; whether any class in the tree reflects an inherited method was not searched for. Such a method would fail to compile or, if the base is reflected too, name the wrong method. A `call<T, I>` form (or passing `T`) would remove the trap. | Reported closed (`psio::proxied_class<I, MemberPtr>`); psibase's proxy objects were not changed to use it. |
| G19 | — | No compile-time string: a type usable as a template argument that holds text and concatenates in a constant expression. `psio::reflect<T>::name` is a `std::string_view`, which can be neither. | psibase names GraphQL types by concatenation in template arguments: `Connection<T, name<T> + "Connection", name<T> + "Edge">` (`serveGraphQL.hpp`, `XPackages.cpp`, `RPackages.cpp`). Reproduction: `template <auto Name> struct Edge {}; Edge<psio::reflect<T>::name> e;` does not compile (`std::string_view` is not a structural type), and there is no `operator+` to build "TEdge". Glue was: `psio1::FixedString` and `psio1::reflected_name<T>`. | Closed, verified and used: `psio::fixed_string<N>`, `psio::reflect<T>::fixed_name`; the helper is deleted (1.13). |
| G20 | `psio/reflect.hpp` | No "index of the data member this pointer names" (`reflect<T>::index_of_member<&T::field>`) and no tuple of the member types (`reflect<T>::member_types`). | Table key schemas map a key's member pointer to a field index; a key that contains a record is flattened to the tuple of its member types. Both are written in psibase with `std::index_sequence` over `member_pointer<I>` / `member_type<I>` (`schema.hpp` `get_member_index`, `Table.hpp` `flatten_members`). | Closed, verified and used: `index_of_member(ptr)`, `member_types`; both psibase helpers are deleted (1.13). The method forms (`method_types`, `index_of_method_pointer`) exist and are not needed by psibase. |
| G21 | `psio/error.hpp` (`codec_error::what` is a `std::string_view`) | An invariant cannot report a message computed from the value. | `Precision`'s legacy message named the offending value (1.11, D27). | Closed, verified and used: `psio::codec_fail_owned` (1.13). A text adapter's `validate` must still return a message of static storage (`psio/adapter.hpp`); `DecimalText::validate` reports literals. |
| G22 | `psio/reflect.hpp:228` | `psio::Reflected<T&>` is a hard error, not `false`: `reflect<T&>` forms `static_cast<T&*>`. Reproduction: `static_assert(!psio::Reflected<int&>);` → "'type' declared as a pointer to a reference of type 'int &'". | Constraints on generic code (`template <typename T> requires psio::Reflected<T>`) are tried with reference and cv-qualified types during partial-specialization matching (`flatten_key<T&>` in `Table.hpp`). psibase asked `std::is_class_v<T>` first. | Closed, verified and used: `Reflected<T&>` is `false`; the pre-check is deleted (1.13). |
| G23 | `psio/json.hpp:2124` (`decode_json_checked(Fmt, std::span<const char> text, T& out)`) | Nothing missing; a trap. A string literal converts to `std::span<const char>` *with its terminating NUL*, so `psio::decode_json_checked(psio::ijson{}, "200", out)` compiles and reads the four bytes `2 0 0 \0`. | Found while writing the `Precision` test of 1.13: for a `std::uint8_t` (or a `transparent()` wrapper of one) the call fails with "json: integer is not a canonical in-range decimal", which reads as if 200 were out of range for 8 bits. With `std::string_view{"200"}` the same call succeeds. Reproduction: `std::uint8_t v; auto s = psio::decode_json_checked(psio::ijson{}, "200", v);` → not ok; `…, std::string_view{"200"}, v)` → ok. | New, minor. No psibase code is affected (the tests pass a `std::string_view`). A `std::string_view` overload, or rejecting a `const char[N]` argument, would remove it. |

## 6. Rust, JavaScript and Python

Rust is the largest piece left before the wire flip: many user services
exist only in Rust, and `rust/psibase/src/services` restates the interface
of every C++ service for Rust callers. The owner's rules for it: one PSIO;
the official derives, no wrapper macros; no compatibility layer; code as if
PSIO had always been there; a Rust `String` is a C++ `psio::utf8_string` and
a Rust `psio::pssz::RawString` a C++ `std::string`; a service's own table
rows are trusted on read, action arguments and data from other services are
validated; where psibase would need its own alias or wrapper around a PSIO
thing, that is a PSIO gap to report (6.8), not something to add.

PSIO's Rust crate was first read at `224f80de`, where the plan below was
written, and again at `415ea1a6`, where slices R1–R3 were done (6.10,
6.13–6.15; what changed in the crate between the two is in the status column
of 6.8). It was read in `external/psio/rust/psio`,
`psio-macros` (`src/lib.rs`, `pssz.rs`, `key.rs`, `json.rs`, `time.rs`,
`pssz_schema_ir.rs`, `pssz_view.rs`, `buffer.rs`, `serde_attrs.rs`,
`serde_bridge.rs`, `attrs.rs`; `compress_name`, `interface.rs`,
`graphql_scalars.rs`, `pssz_bounds.rs` at the new pin) and exercised with a scratch crate outside the
tree (psibase-shaped types; what it showed is quoted where it matters).

### 6.1 Inventory

All counts are over tracked `*.rs` outside `external/` (596 files). Derive
lists were parsed whole; section 2.7's earlier counts matched single-line
lists only and were low.

| | Sites / files |
|---|---|
| `#[derive(… Pack …)]` | 331 / 87 |
| `#[derive(… Unpack …)]` | 328 / 84 |
| `#[derive(… ToSchema …)]` | 288 / 71 |
| `#[derive(… ToKey …)]` | 25 / 6 |
| `#[derive(… View …)]` (fracpack) | 18 / 2, all in `rust/test_fracpack` and the macro's documentation |
| `serde::Serialize` / `Deserialize` derives | 376 / 92, 522 / 136 |
| `async_graphql` `SimpleObject` / `InputObject` / `Union` / `Enum` derives | 147 / 53, 26 / 9, 2, 2 |
| `#[fracpack(...)]` | 149 / 34: `fracpack_mod` 134, `definition_will_not_change` 17, `custom = "…"` 3, `skip` 1, `view_name` 1 |
| `#[to_key(psibase_mod = "crate")]` | 25 / 6 |
| `#[serde(...)]` | 184 / 57: `rename_all` 65, `deserialize_with` 45, `deny_unknown_fields` 30, `default` 24, `rename` 15, `untagged` 2, `tag`+`content` 2, `borrow` 1 |
| `#[psibase::service]` / `#[psibase::service_tables]` | 76 / 72, 34 / 34 |
| `#[action]`, `#[table(`, `#[event(` | 809 / 115, 154 / 40, 81 / 34 |
| `#[primary_key]`, `#[secondary_key` | 151 / 39, 52 / 21 |
| Hand-written `impl Pack`, `impl Unpack`, `impl ToSchema`, `impl ToKey` outside `rust/fracpack` and its tests | 3, 4, 2, 16: `db.rs`, `hex.rs`, `memo.rs`, `tokens/precision.rs`, `Permissions/plugin/src/types.rs`; keys in `to_key.rs`, `hex.rs`, `table.rs` |
| Hand-written `impl Serialize` / `Deserialize` | 12 / 6, 9 / 8; `serialize_as_str!` for the name types; `async_graphql::scalar!` 6 / 5 |
| Calls, outside `rust/fracpack` and its tests: `.packed()` | 198 / 67 |
| — `T::unpacked(…)` | 62 / 25 |
| — `unpack(&mut FracInputStream)` (hand-written codecs) | 32 / 8 |
| — `verify(…)` | 23 / 12 |
| — `Pack` / `Unpack` / `UnpackOwned` as bounds of generic code | 41 bounds in `rust/psibase/src` and `rust/psibase_plugin` (`table.rs`, `service.rs`, `native.rs`, `tester.rs`, `db.rs`); `fracpack::Pack` is named by path 104 times, mostly imports |
| — `.to_key()` 31 / 13, `append_key` 47 / 7, `RawKey` 88 / 22, `KeyView` 6 / 2 | |
| — `SchemaBuilder` 17 / 6, `AnyType` 170 / 8, `CompiledSchema` 100 / 5 | |
| — `serde_json::to_*` 101 / 39, `from_*` 182 / 76, `Value` / `json!` 343 / 49 | |
| `Nested<T>` | 1 use: `transact::execTrx(trx: Nested<Transaction>, …)` |
| Leaf types: `Hex<` 65 / 25, `Checksum256` 101 / 29, `TimePointSec/USec` 141 / 37, `Seconds` / `MicroSeconds` 71 / 19, `Memo` 120 / 22 | |

Where they are:

| Area | `Pack` derives / files | `#[action]` | `#[table(` | `#[event(` | `.packed()` | `unpacked(` |
|---|---|---|---|---|---|---|
| `rust/psibase/src` without `services` (blocks, transactions, native tables, traces, HTTP, packages, schema, leaf types) | 84 / 10 | 1 | 0 | 0 | 46 | 20 |
| `rust/psibase/src/services` (the Rust view of 45 services, most of them C++) | 42 / 21 | 422 | 9 | 32 | 0 | 0 |
| `packages/system` services and query services | 25 / 7 | 80 | 20 | 4 | 8 | 1 |
| `packages/user` services and query services | 123 / 29 | 274 | 115 | 37 | 11 | 2 |
| `packages/user` plugins (wasm components run in the browser) | 22 / 10 | 0 | 0 | 0 | 94 | 35 |
| `packages/system` plugins | 0 | 0 | 0 | 0 | 31 | 1 |
| `rust/test_*`, `package-templates`, `psibase_macros` (tests and docs) | 30 / 7 | 30 | 10 | 8 | 25 | 9 |
| `rust/fracpack` | 5 / 2 | | | | | |

Shapes of the 331 declarations (types deriving `Pack` or `Unpack`, by what
else they derive): 147 are `Pack + Unpack + ToSchema + Serialize +
Deserialize`; 80 add `SimpleObject`; 25 add `SimpleObject + InputObject`
(10 of those also `ToKey`); 18 are `Pack + Unpack` alone; the rest are small
variations. Five enums derive `Pack` (`ConsensusData`, `IPAddress`,
`SocketEndpoint`, `SocketInfo`, `InnerTraceEnum`); every variant of each
holds exactly one unnamed field. Actions take 0–9 arguments (0: 106, 1: 302,
2: 213, 3: 105, 4: 44, 5: 22, 6: 7, 7: 6, 9: 1), events 0–7.

### 6.2 What the macros generate

`#[psibase::service]` (`rust/psibase_macros/psibase-macros-lib/src/service_macro`,
1,257 lines) turns a module of `#[action]` functions into:

* `action_structs::<name>`: one record per action holding its arguments,
  deriving `Pack, Unpack, fracpack::ToSchema, serde::Serialize,
  serde::Deserialize` (and `async_graphql::SimpleObject` on request), with
  `#[fracpack(fracpack_mod = "…")]`;
* `Actions<T: Caller>`: one method per action, which packs **the tuple of
  the arguments** (`self.caller.call(method, (a, b, c))`), not the action
  record. In fracpack, and in pSSZ, a tuple and a record of the same members
  have the same bytes (checked for pSSZ in the scratch crate, including
  trailing optionals and the empty case);
* `Wrapper` with `call*`, `push*`, `pack*` (inline call, tester transaction,
  `Action` value) over three `Caller`s in `psibase/src/service.rs` and the
  tester, each doing `args.packed()` and `Ret::unpacked(&ret)`;
* `dispatch(act: SharedAction)`: an `if act.method == MethodNumber::new(method_raw!("name"))`
  chain; the matching branch runs `action_structs::name::unpacked(&act.rawData)?`,
  calls the function and `set_retval(&val)`. Two actions with one method
  number are not detected (the first wins);
* schema: `ToActionsSchema` / `ToEventsSchema`, which fill an
  `IndexMap<MethodString, FunctionType>` with `builder.insert::<action_structs::name>()`
  and the result type;
* events (`#[event(history | ui | merkle)]`): `event_structs::…` records and
  emitters that pack the tuple of the arguments and call the `events`
  service;
* GraphQL: nothing of its own beyond a `Union` over event records; queries
  are hand-written `async_graphql` objects.

`#[psibase::service_tables]` (715 lines) turns `#[table(name = …, index = …)]`
records with `#[primary_key]` / `#[secondary_key(n)]` methods into
`TableRecord` impls (keys as `RawKey` through `ToKey`), table wrappers with
typed index getters, and `ToIndexSchema` / `ToDatabaseSchema` (the key's
field paths, read from the body of the key method).

The derives are psibase's own (`psibase-macros-derive`): `Pack`, `Unpack`,
`View` (`fracpack_macro.rs`, `view_macro.rs`), `ToSchema`
(`schema_macro.rs`), `ToKey` (`to_key_macro.rs`); `rust/fracpack` re-exports
the first four and depends on `psibase_macros` for them. Everything generic
is bounded by fracpack's traits: `TableRecord: Pack + UnpackOwned`,
`Caller::call<Ret: UnpackOwned, Args: Pack>`, `kv_get<V: UnpackOwned, K: ToKey>`.
`kv_get` validates every row it reads (`V::unpacked`): today nothing is
trusted.

Build: four Cargo workspaces (`rust/`, `packages/system`, `packages/user`,
and `packages/` for the plugins) and a few single crates with their own lock
file (the XAdmin wasm helper, the EthBridge relayer, `demo/`).
Every service crate depends on `psibase` by path; `psibase` re-exports
`fracpack` (`pub use fracpack`), and the derives default to the path
`psibase::fracpack`, so no service names the `fracpack` crate in its
manifest. Nothing is taken from crates.io under a psibase name
(`publish = false`). CMake builds 28 Rust packages with `cargo-psibase
package` (each into its own target directory) and the CLI tools with
`cargo build`.

### 6.3 Can Rust have a wire-neutral declaration slice, as C++ did?

**Not in the C++ sense.** In C++ a type moved to its final declaration
(`PSIO_REFLECT`) while the legacy library kept producing the bytes, because
`PSIO_REFLECT` produces *reflection*, and 150 lines of glue inside `psio1`
derived `psio1::reflect<T>` from `psio::reflect<T>`. Rust has no such seam:

* A derive is the implementation. `#[derive(psio::PsszPack)]` emits `impl
  PsszPack<F> for T` and nothing a second library can read; PSIO's Rust
  crate has no reflection trait (each PSIO derive parses the declaration
  again). So a type declared only with the official derives has no
  `fracpack::Pack`, and `Table<T>`, `Caller`, `kv_get` cannot use it while
  they still write fracpack.
* Glue confined to `rust/fracpack` could only be a blanket
  `impl<T: PsszPack<Pssz> + ToPsszSchema> Pack for T` that encodes pSSZ and
  transcodes it to fracpack through the Schema IR at run time. It overlaps
  fracpack's own impls for every primitive and container (Rust coherence
  forbids it without rewriting those too), needs a pSSZ ↔ fracpack
  transcoder and an IR → legacy-schema converter (some 2,000 lines written
  to be deleted), changes the cost of every row and action inside the
  services, and can differ from today's bytes wherever the two type systems
  do not map one to one. Rejected.
* A psibase derive named `PsszPack` that also emits the fracpack impl is the
  macro wrapper the owner ruled out.

**What Rust can do instead: additive declarations.** A type keeps its legacy
derive names and *gains* the PSIO ones:

```rust
#[derive(Pack, Unpack, ToKey, ToSchema,                                   // deleted at the flip
         psio::PsszPack, psio::PsszUnpack, psio::PsszView, psio::ToPsszSchema, psio::Key)]
#[fracpack(definition_will_not_change, fracpack_mod = "fracpack", custom = "AccountNumber")]
#[psio(definition_will_not_change, custom = "AccountNumber")]             // final
pub struct AccountNumber { pub value: u64 }
```

It is wire-neutral (nothing in production calls the PSIO impls; fracpack
writes every byte as before) and it adds nothing temporary anywhere: the
PSIO half is the final declaration, the legacy half is what is in the tree
today and is deleted by the flip. No glue is needed, in `rust/fracpack` or
elsewhere.

Trade-off:

| | Additive declarations first (R1–R5), then the flip | Declarations and wire together at the flip |
|---|---|---|
| Size of the flip commit in Rust | call sites, generic bounds and the macro's output switch; the legacy derive names and `#[fracpack]` lines are deleted. No type is described for the first time. | 331 declarations + 809 generated action records + the runtime + the schema path, in one commit with C++, JS and Python. |
| When PSIO's Rust gaps are found | Now, type by type, by the compiler (a member with no PSIO value fails the derive). This is how "Rust catches up to C++" gets a concrete list. | In the flip commit. |
| Cross-language evidence before the flip | Rust tests pin the same pSSZ, key and I-JSON vectors as the C++ tests, per type, before anything depends on them. | Round trips after the flip. |
| Cost | Each declaration is touched twice (add, then delete the old names). Two attribute lines side by side meanwhile. Every service compiles two codecs until the flip (the `psio` crate itself: about 1 % of a cold service build, 6.10; the per-type derive cost grows with R3–R5 and was not measured). | Once. |
| What it cannot do | The text side. `psio::JsonText` / `psio::Serde` replace `serde::Serialize` / `Deserialize` (two impls of one trait cannot coexist) and change the JSON a client sees, so they move at the JSON flip, not before. `ToPsszSchema` can be added now for all but 2 of the 263 `ToSchema` types checked: only `package::Meta` (`#[serde(default)]`) and `accounts::Account` (`deserialize_with`) carry a serde attribute the PSIO text derives reject (the other ~100 such attributes are on plugin, CLI and configuration types that are not on the wire). | — |
| Member types that are themselves replaced (`TimePointSec` → `psio::time::TimePoint<Seconds>`, `Hex<Vec<u8>>` → `Vec<u8>`) | The record's PSIO derive needs the member to be a PSIO value now. Time is another type under PSIO and its text differs (D34); `Hex<T>` would need a `#[psio(transparent)]` it loses again at the JSON flip (D29). Such records wait: 56 of the 76 core records (6.14). | No intermediate state. |

**Recommendation: additive declarations, bottom-up, for the binary and
schema derives; the flip then deletes the legacy half.** The decisive
reasons are the second and third rows: the flip is the one commit that
cannot be made small, and the only way to keep unknowns out of it is to have
had the compiler and a shared set of vectors pass over every Rust type
first. The cost is mechanical. Records whose members are still to be
replaced are not forced: they join when their member type is settled.

**The blocker found by doing R1 is gone.** At `224f80de` the declarations
were wire-neutral and the dependency was not: linking `psio` changed how
`serde_json` handles numbers in every crate (RG9). PSIO at `415ea1a6` no
longer enables that feature, and R1 is committed (6.10).

**What doing R2 and R3 showed about the last row of the table.** "Such
records wait" turns out to be most of the core: with `Hex<T>` and the time
types waiting for the JSON flip, 56 of the 76 core records cannot gain
their PSIO derives before it (6.14). The additive route still delivers what
it was chosen for on the 26 types it reaches — the compiler and one set of
vectors shared with C++ — and it found, before the flip, the Rust
declarations that are not the C++ ones today (D36) and the method-number
disagreement (D33). For the records that wait, that evidence arrives with
R8 unless D29 is reopened.

### 6.4 Slices

| Slice | Content | Size | Wire | Verified by |
|---|---|---|---|---|
| R1 (done; 6.10) | The `psio` crate acquired from the pinned checkout. `AccountNumber`, `MethodNumber`: PSIO derives, `custom` id, text form. Two panics in the name parsers removed. The method coder stays psibase's (RG12, D33). | 2 types; 7 lock files | unchanged | `psio_leaf_types.rs` (the C++ vectors of `leaf_types.cpp`): 13 / 13; ctest 92 / 92 |
| R2 (done for 4 types; 6.13) | `Memo` (`transparent`, the member bounded to 80), `tokens::{Precision, Quantity, Decimal}` with the overflow fix of D17. **Waiting:** time (`psio::time` replaces psibase's structs at R7 / R8: D34), `Hex<T>` and `Checksum256` (R8: D29), `SubjectPublicKeyInfo` (its C++ twin: D26). `ExactAccountNumber` is deleted at R8; `MethodString` belongs to the legacy schema format. | 4 types done | unchanged, except that a decimal text over 2^64 − 1 or with 256 or more fraction digits is rejected | `psio_wrappers.rs` (the C++ vectors of `wrappers.cpp`): 6 / 6; 3 unit tests in `quantity.rs`; ctest 92 / 92 |
| R3 (done for 20 of 76 records; 6.14) | Records of `rust/psibase/src` outside `services`. Additive `PsszPack, PsszUnpack, PsszView, ToPsszSchema` (+ `Key` where `ToKey`) on the 20 whose members are all PSIO values and whose C++ twin is finally declared and equal. **Waiting:** 31 behind `Hex<T>` (R8), 7 behind time, 7 behind the socket variants' text form in C++, 4 (and 2 of the above) whose Rust declaration is not the C++ one today (D36), 5 of the legacy schema format, `Meta` (a serde attribute), `ConsensusBytes` (no C++ twin). | 20 derives / 5 files | unchanged | `psio_twins.rs` against the fixture C++ writes (6.15): schema IR, pSSZ, key, text; ctest 92 / 92 |
| R4 (done as far as it is additive; 6.19) | `#[psibase::service(psio = true)]` also declares the actions with `#[psio::interface]`; on for `setcode`, `auth-delg`, `minrecvr`; two services cross-checked against C++ (18 functions, 18 calls); two actions with one method number are a compile error. Events, record-building callers and key bounds are left to R7. | 1 macro; 3 services | unchanged | `psibase-macros-lib` tests, `psio_twins.rs`, `rs-test-psibase-macros`; schemas identical |
| R4 (as first planned) | The macros. `action_structs` and `event_structs` gain the PSIO derives (`#[psio(crate = "…")]` where the macro names the crate today); callers and emitters build the action record instead of a tuple (same bytes in fracpack; removes the dependence on tuple ≡ record and gives argument caps a place to live, RG6); `service_tables` emits `psio::Key` bounds beside `ToKey`; the dispatcher refuses two actions with one method number at macro time (C++ D23). | 2 macros, ~2,000 lines; 809 action and 81 event records generated | unchanged | `rs-test-psibase-macros`, `psibase-macros-lib` tests, every `rs-test-*`; generated schemas of the 28 packages compared before / after |
| R5 (started; 6.20) | `rust/psibase/src/services`: 30 of its 37 `Pack` types declared (27 added), 7 wait. `packages/system` and `packages/user` not started. | 27 derives / 13 files | unchanged | compiles; not yet in the fixture |
| R5 (as planned) | Service declarations: `rust/psibase/src/services` (42 derives, 422 actions: the Rust statement of C++ interfaces), `packages/system` (25), `packages/user` (123 + 22 in plugins). Each crate that derives gets `psio` in its manifest (`psio.workspace = true`; the derives resolve `::psio`). Per type, the decisions that select bytes: `definition_will_not_change`, `String` vs `RawString` against the C++ parameter (99 `String` in 22 files of `services/` against C++ signatures that say `std::string` today), bounds (RG6). | 212 derives / 67 files | unchanged | as R4; per service that exists in both languages, action bytes pinned once and asserted in both |
| R6 | Keys. A test that `ToKey` and `psio::Key` agree for every table key type in the tree (25 `ToKey` derives, 151 primary and 52 secondary keys); then `table.rs`, `native.rs` and the macro use `psio::to_key`, `psio::key::key_prefix`; `RawKey` / `KeyView` implement `psio::key::KeyPack` (D8). With C++ slice 6. | `to_key.rs` 286 lines, `to_key_macro.rs` deleted | unchanged where the formats agree | the agreement test; all service tests |
| R7 | **The wire flip, with C++ slice 7.** `Pack` / `UnpackOwned` bounds → `psio::Encode<Pssz>` / `Decode<Pssz>`; `.packed()` → `psio::to_pssz`; action arguments and cross-service data → `psio::from_pssz` (validates); own rows → `psio::from_pssz_trusted`; `Nested`, `SharedAction`; schemas → Schema IR (`schema.rs`, 563 lines; the macros' schema output; `trace.rs` and `package.rs` onto `psio::pssz::dynamic`); the legacy derive names, `#[fracpack]`, `#[to_key]` and the 25 hand-written codec and key impls deleted; plugins and the XAdmin wasm rebuilt. | 198 + 62 + 32 call sites; 41 generic bounds; 331 derive lists | everything binary changes | all tests; fresh genesis; cross-language vectors for transactions and blocks |
| R8 | **The JSON flip, with C++ slice 8.** Wire types: `serde::Serialize, Deserialize` → `psio::JsonText, psio::Serde`; `serialize_as_str!` → `TextForm` + `psio::Serde`; `Hex<T>` deleted; serde attributes PSIO's text rejects removed where the type is on the wire; `serde_json::to_string(&wire)` → `psio::to_ijson`. Plugins, CLI and configuration types that only talk JSON keep serde (D10). | 376 / 522 derives to classify; 283 `serde_json` conversion calls | JSON changes | all tests; UI builds |
| R9 | Delete `rust/fracpack`, `rust/test_fracpack`, `rust/test_fracpack_macros`, the four legacy derives in `psibase-macros-derive`, `to_bin.rs` / `from_bin.rs` if nothing needs the `bin` format. | ~6,500 lines | none | |

R1–R5 are independent of the C++ slices and of each other's order beyond
bottom-up. Nothing in PSIO blocks them any more (RG9, RG3 and RG6 are
closed). What limits R3 — and will limit R5 in the same way, for every
service record or action with a `Hex`, a `Checksum256` or a time member —
is the decision that those member types change at the JSON flip (D29, D34).
R4 can proceed: the macros can emit the PSIO derives for action records
whose arguments are PSIO values and must leave the others alone, which
needs a rule the macro can evaluate (or the same wait).

### 6.5 What the tests cover, and what they do not

How the 92 ctest tests exercise Rust:

| ctest | Runs | Covers |
|---|---|---|
| `rs-tests` | `cargo test -r -p test_fracpack -p psibase -p cargo-psibase -p psibase-macros-lib -p psibase-macros-derive -p psibase_plugin` (native) | the legacy codec against the C++ legacy library (`test_fracpack`: 21 tests, among them the schema-driven JSON vectors that caught RG9), psibase's unit tests (95: names, hex, time, schema, packages, depgraph), the macro expansion tests; the PSIO forms: `psio_leaf_types.rs` (13), `psio_wrappers.rs` (6), `psio_twins.rs` (1: the fixture C++ writes, 6.15) |
| `rs-test-psibase-macros`, `rs-subjective-test`, `rs-test-contract`, `rs-test-contract-2`, `rs-test-package`, `rs-test-panic` | `cargo-psibase test` on the test crates: services built to wasm and run in `psitest` | the service macro, tables, events, subjective database, package build |
| 22 × `rs-test-<Package>` (AuthDyn, AuthRecover, Credentials, StagedTx, VirtualServer, WsAuth, Branding, BrotliSvc, Chainmail, DiffAdjust, Evaluations, FaucetTok, Fractals, Guilds, Identity, NameMarket, Profiles, Registry, Subgroups, TokenStream, TokenSwap, Tokens) | `cargo-psibase test` per package: the Rust service and the system services it calls, in `psitest`, on a booted chain | actions, tables, events and cross-service calls of those services, Rust ↔ C++ in both directions |
| 15 × `psinode_test_*`, 20 × `t-<Service>-test`, `t-psibase-tests` | a node with the default packages installed (Rust and C++ services together) | boot, package install, transactions through Rust services |

Not covered by any test:

* **Six Rust service packages are not even compiled by the build**: `BtcBridge`,
  `BtcRelay`, `EthBridge`, `EthRelay`, `Exchange`, `Signing` (52 `.rs`
  files; members of the `packages/user` workspace, no `cargo_psibase_package`
  in `CMakeLists.txt`). Only `cargo check --workspace` in `packages/user`
  reaches them. A Rust slice must run that explicitly.
* Six more packages are built but have no test of their own: `Symbol`,
  `Nft` (their C++ tests run), `Favor`, `FractalGen`, `SingleProd`,
  `FractalTester`.
* **Plugins** (wasm components run by the Supervisor in a browser; 125
  `.packed()` in 41 files, 36 `unpacked(` in 11): built, never run by a
  test. They pack action arguments for transactions.
* The XAdmin wasm helper (`packages/local/XAdmin/ui/wasm`: packs boot
  transactions, unpacks traces): built by the UI build, not tested.
* `rust/psibase`'s CLI paths that pack (`boot`, `install`, `push`) are
  exercised only through the node tests' use of the `psibase` binary.
* The query services (`r-*`, GraphQL over HTTP) of the Rust packages are
  covered only where a package's own test queries them.
* `demo/`, `experiments/`, `package-templates/` are not built.

### 6.6 Mapping, old → new

Every Rust API psibase code uses from the legacy stack and what replaces it.
Right-hand names were checked against the crate at `224f80de`.

| Legacy | PSIO |
|---|---|
| **Derives** | |
| `Pack` | `psio::PsszPack` |
| `Unpack` | `psio::PsszUnpack` (also gives the validator, `PsszValidate`) |
| `fracpack::View` | `psio::PsszView`: accessors come from a generated trait, `<Type>PsszAccessors`, which the caller imports |
| `ToSchema` | `psio::ToPsszSchema` |
| `ToKey` | `psio::Key` (`KeyPack`, `KeyUnpack`, `CompositeKey`) |
| `serde::Serialize, serde::Deserialize` on a wire type | `psio::JsonText, psio::Serde` (serde impls with PSIO's I-JSON rules) |
| `serialize_as_str!(T, …)` (psibase macro: serde through `FromStr` / `Display`, plus `async_graphql::scalar!`) | `impl psio::json::TextForm for T` + `psio::json_text_form!(T)` + `psio::Serde`; `scalar!` stays |
| **Attributes** | |
| `#[fracpack(definition_will_not_change)]` | `#[psio(definition_will_not_change)]` |
| `#[fracpack(custom = "Id")]` | `#[psio(custom = "Id")]` and a `TextForm` |
| `#[fracpack(skip)]` | `#[psio(skip)]` |
| `#[fracpack(fracpack_mod = "…")]`, `#[to_key(psibase_mod = "…")]` | none; `#[psio(crate = "…")]` only on what a macro generates into a crate without a `psio` dependency |
| a tuple struct `struct MethodString(pub String)` | `#[psio(transparent)]` |
| `psio_validate_packable`-style checks in hand-written `Unpack` | `#[psio(invariant = "path")]` |
| `#[serde(rename_all = …)]`, `#[serde(rename = …)]` | unchanged: the PSIO derives read them (or `#[psio(rename_all / name)]`) |
| `#[serde(deny_unknown_fields)]`, `default`, `deserialize_with`, `untagged`, `tag`/`content` on a wire type | removed: compile errors on `JsonText`, `Serde`, `ToPsszSchema` (PSIO skips unknown members, a missing non-optional member is an error, text is defined by the member's type, a variant is `{"Name": value}`). `deserialize_with = "deserialize_number_from_string"` exists because C++ writes 64-bit integers as strings; I-JSON reads both forms |
| (new) | `#[pssz(max_dynamic_data = N)]`; member bounds `#[psio(max = N, element(...), keys(...), values(...), at(I, ...))]` |
| **Functions and types** | |
| `value.packed()` | `psio::to_pssz(&value)` (`try_to_pssz` for a value that may violate a bound or invariant) |
| `T::unpacked(bytes)?` on action arguments, return values, anything from another service or a client | `psio::from_pssz::<T>(bytes)?` |
| `T::unpacked(bytes)` on the service's own rows (`kv_get`, `Table`) | `psio::from_pssz_trusted::<T>(bytes)` |
| `T::verify_no_extra(bytes)` | `psio::validate_pssz::<T>(bytes)` |
| `Pack::pack(&self, &mut Vec<u8>)` | `psio::to_pssz_into(&value, &mut out)` |
| `T: Pack` / `T: UnpackOwned` in generic code | `T: psio::Encode<psio::Pssz>` / `T: psio::Decode<psio::Pssz>` |
| `fracpack::Result`, `fracpack::Error` | `psio::pssz::PsszResult`, `psio::pssz::PsszError` |
| hand-written `impl Pack / Unpack` with `FracInputStream` (`Hex`, `db.rs`, `Memo`, `Precision`, the schema custom handlers) | none: the type is declared (`transparent`, `custom`, `invariant`) or is a PSIO type |
| `fracpack::Nested<T>` | `psio::pssz::Nested<T>` |
| `SharedAction<'a>`, `SharedGenesisActionData<'a>`, `SharedGenesisService<'a>`: records that borrow (`Hex<&'a [u8]>`) so that packing and unpacking do not copy (`Unpack<'a>`) | writing: the record derives `PsszPack` over its reference members (`psio::to_pssz` takes `&T`, `str`, `[T]`); reading: `psio::PsszView<'a, Action>` — `PsszUnpack` yields owned values only. Owned packed values: `psio::PsszBuffer<T>`, `psio::SharedPssz<T>` |
| views (`T::View`, generated `…View` types) | `psio::PsszView::<T>::new(bytes)?` (validates) / `::trusted(bytes)`; `psio::PsszMutView` |
| `key.to_key()` | `psio::to_key(&key)` |
| `ToKey::append_key` | `psio::key::KeyPack::key_pack` / `psio::to_key_into` |
| a key prefix built by hand (`(a, b).to_key()` then truncation, `RawKey` concatenation) | `psio::key::key_prefix::<Key, _>(&(a, b))`, `psio::key::key_prefix_upper_bound` |
| `RawKey`, `KeyView` (already-encoded key bytes) | psibase's own two types, implementing `psio::key::KeyPack` (D8; checked in the scratch crate: such a type composes in a tuple key) |
| `fracpack::SchemaBuilder`, `AnyType`, `Schema`, `FunctionType` | `psio::pssz::schema_ir::{SchemaBuilder, AnyType, Schema, FunctionType, Func, Interface}`, `schema_for::<T>()` |
| `CompiledSchema`, `CompiledType`, `CustomHandler`, `CustomTypes`, `to_value` / `from_value` | `psio::pssz::dynamic` (`decode_exact`, `decode_compatible`, `encode`, `validate`, `to_key`, `json::pssz_to_json` / `json_to_pssz`, `CustomHandlers`, `Options`) |
| `SchemaMatcher`, `SchemaDifference` | `psio::pssz::upgrade` (`validate_optional_upgrade`), `psio::pssz::pssz_evolves_from` |
| `serde_json::to_string(&wire_value)` / `from_str::<WireType>` | `psio::to_ijson(&v)` / `psio::from_ijson::<T>(text)?` (`serde_json` stays for free-form `Value`s and non-wire types) |
| `to_bin.rs` / `from_bin.rs` (`ToBin`, `FromBin`: 13 uses in 3 files) | removed, or PSIO's `bin` if a consumer remains (not examined) |
| **Types** | |
| `String` | `String` (⇔ C++ `psio::utf8_string`: UTF-8 enforced) |
| a string that C++ declares `std::string` | `psio::pssz::RawString` (borrowed: `RawStr`) |
| `Hex<Vec<u8>>`, `Hex<[u8; N]>`, `Checksum256` | `Vec<u8>`, `[u8; N]` (hex in I-JSON by PSIO's rule) |
| `TimePointSec`, `TimePointUSec` | `psio::time::TimePoint<Seconds>`, `TimePoint<Micros>` (at R7 / R8: D34) |
| `Seconds`, `MicroSeconds` | `psio::time::Duration<Seconds>`, `Duration<Micros>` |
| `Option<T>`, `Vec<T>`, `[T; N]`, tuples, `Box<T>`, `bool`, integers, floats | the same |
| `indexmap::IndexMap<K, V>` | `BTreeMap<K, V>` (⇔ `std::map`); bounded: `psio::pssz::BoundedMap` |
| `psibase::Memo` | the same type, `#[psio(transparent, invariant = "…")]` over `String` |
| `AccountNumber`, `MethodNumber` | the same types (R1) |

### 6.7 Behaviour of PSIO's Rust crate that the plan relies on (checked)

In a scratch crate against `224f80de`:

* `AccountNumber` declared as in 6.3 gives the bytes C++ pins: pSSZ
  `00b82a1b83aedf04`, key `04dfae831b2ab800`, I-JSON `"alice"`, composite
  key and `key_prefix` as in `leaf_types.cpp`; its schema is
  `Custom{Object{value: Int{64}} [definitionWillNotChange], "AccountNumber"}`.
* A record equals the tuple of its members in pSSZ (with fixed members, a
  string, trailing optionals, one member, none), and `auto_pssz_width`
  agrees.
* `psio::to_pssz` accepts `str`, `[T]`, `&T` and tuples of references: a
  caller does not clone to pack.
* A field-less enum needs `#[repr(int)]` (it is its integer) or
  `#[psio(variant)]`; an enum with payloads is a variant.
* `BTreeMap`, `HashMap`, `Box<T>`, `Nested<T>`, `RawString`, `Option<bool>`
  are values; `Rc<T>` / `Arc<T>` and tuples of more than 12 elements are not
  (fracpack had both; psibase packs neither).
* `psio::from_pssz_trusted`, `PsszView::trusted` exist for own rows.
* `pssz::dynamic` decodes, validates and writes JSON under the automatic
  profile (`docs/compatibility.md` still says it supports the explicit
  widths only).
* At `224f80de`, with `psio` in the dependency graph `serde_json` was built
  with `arbitrary_precision` for every crate (RG9). At `415ea1a6` it is not;
  `raw_value` remains, which adds a type and changes no behaviour (6.10).

### 6.8 Where PSIO's Rust crate lacks something psibase needs

The table is as found at `224f80de`. The status of each at `415ea1a6`,
checked in the checkout and with a scratch crate, follows it, with the two
gaps found since (RG12, RG13).

| # | Missing | Why psibase needs it | Reproduction / precise description |
|---|---|---|---|
| RG1 | **Methods and interfaces.** Rust has no counterpart of `PSIO_REFLECT(T, method(name, args…))` or `PSIO_INTERFACE`: nothing declares a function, derives its argument record or lists an interface's functions. The IR has the records (`Interface`, `Func`, `FunctionType`), `SchemaBuilder` has `insert::<T>()` only. | The service macro derives all of it itself from the `#[action]` functions (argument records, callers, dispatch, the action schema). That stays psibase's macro either way; what it needs from PSIO is the piece that makes Rust and C++ agree: (a) a builder call that adds an interface with its functions (C++ `SchemaBuilder::insert_interface`), given a name and, per function, the argument record type and result type; (b) one stated rule for the pSSZ of a function's arguments (C++ packs `std::tuple<params…>`; Rust would pack a record; equal bytes today, but argument caps, RG6, must select the same width in both). | `psio::pssz::schema_ir::SchemaBuilder` has no method that returns or fills an `Interface`; `grep -n interface rust/psio-macros/src/*.rs` finds nothing. |
| RG2 | **Name compression.** C++ has `psio/compress_name.hpp` (`method_to_number`, `number_to_method`, used by `psibase::MethodNumber`), JS has `compress-name.ts`. Rust has none. | The method-name half of `rust/psibase_names` (`method_number.rs`, `method_to_number_converter.rs`, `number_to_string_converter.rs`, `frequency.rs`, the model table) is psibase's own second implementation of what C++ takes from PSIO; R1 found a panic in its hash-form parser (6.10). The account-name coder is psibase's own in C++ as well (`psibase/name.hpp`) and stays. | `grep -rn "compress_name\|method_to_number" rust/psio/src` → nothing. |
| RG3 | **Time values cannot replace psibase's.** (a) `psio::time::TimePoint` / `Duration` have `checked_add` / `checked_sub` / `checked_duration_since` and no operators, no conversion between units (`seconds → micros`, floor / ceil), no `FromStr` / `Display` (only `to_rfc3339` / `from_rfc3339`). (b) They are foreign types to psibase, so psibase cannot give them `async_graphql` scalar impls or `chrono` conversions (orphan rule), and a wrapper is what the owner ruled out. | `TimePointSec` / `TimePointUSec` are used 141 times in 37 files, as members of `SimpleObject` and `InputObject` records (GraphQL) and with `+ Seconds`, `.seconds()`, `.microseconds()`, `From<chrono::DateTime<Utc>>`. | `#[derive(async_graphql::SimpleObject)] struct S { t: psio::time::TimePoint<psio::time::Seconds> }` cannot compile in psibase: `OutputType` is not implemented for the member and only `psio` or `async-graphql` may implement it. `TimePoint::<Seconds>::from_ticks(1) + Duration::<Seconds>::from_ticks(1)`: no `Add`. Needed: the operators and unit conversions in `psio::time`, and a way for a PSIO value to be a GraphQL scalar through its text (an optional `async-graphql` feature in `psio`, or PSIO's own GraphQL for Rust). The same applies to every PSIO type psibase would put in a GraphQL object: `RawString`, `Nested<T>`, the bounded strings. |
| RG4 | **A user type may claim a reserved time id.** `#[psio(custom = "time-point-seconds")]` on a record is accepted and its schema is `Custom{Object{…}, "time-point-seconds"}`, which schema-driven codecs read as a time point over a non-integer. | Found while checking whether psibase could keep its own time structs under PSIO's schema ids (it cannot, correctly; the derive should say so). | `#[derive(PsszPack, PsszUnpack, ToPsszSchema)] #[psio(definition_will_not_change, custom = "time-point-seconds")] struct T { seconds: i64 }` + `schema_for::<T>()` → `Ok`. |
| RG5 | **The IR's own records have no schema.** `Schema`, `AnyType`, `FunctionType`, `Member`, … derive `PsszPack`, `PsszUnpack`, `JsonText` but not `ToPsszSchema` (JS has `PsszSchema.meta()`). | psibase passes schemas as values: the `Packages` service stores and takes a service schema as an action argument, so an action record with a schema member cannot derive `ToPsszSchema`. | `psio::pssz::schema_ir::schema_for::<psio::pssz::schema_ir::Schema>()` → "the trait bound `Schema: ToPsszSchema` is not satisfied". |
| RG6 | **Member bounds and argument caps** (known to be coming: nested bounds such as `#[psio(max = 8, element(max = 16))]` and caps on method arguments are being added to C++ and Rust mirrors them). Today Rust has bounded *types* only (`BoundedString<N>`, `BoundedRawString<N>`, `BoundedList<T, N>`, `BoundedMap`, `BoundedSet`) and `#[pssz(max_dynamic_data = N)]` on a type. | Not worked around; psibase waits. Where psibase Rust would use them is listed in 6.9. | `docs/pssz-rust-profile.md`: "Field-level annotations are not supported; bounds are expressed with bounded types." |
| RG7 | **`JsonText` for enums is narrower than `PsszPack`.** A variant must hold exactly one unnamed field; a unit alternative or a struct variant is encodable in pSSZ and has a schema, but no text. | No psibase enum on the wire needs it today (all five have one field per variant); it will be met by the first service that declares `enum E { None, Some(u32) }`. | `#[derive(psio::JsonText)] enum E { Unit, One(u32) }` → "a JsonText variant holds exactly one unnamed field". |
| RG8 | **The documentation of the Rust crate is behind the crate.** `docs/pssz-rust-profile.md` says the crate-root `Pack` / `Unpack` / `ToSchema` are legacy fracpack and writes `#[pssz(definition_will_not_change)]` (now an error naming `#[psio(...)]`); `docs/compatibility.md` says the Rust schema-driven codec rejects the automatic profile (it works). `lib.rs` is current. | psibase's plan was written from `lib.rs` and the source because of it. | as stated |
| RG9 | **Blocking. Depending on `psio` changes `serde_json` for the whole program.** `rust/psio/Cargo.toml` requires `serde_json` with `arbitrary_precision` and `raw_value` unconditionally (the serde bridge wants the text of a number); Cargo's feature unification applies both to every crate in the graph. With `arbitrary_precision` a number reaches serde's buffered deserializers (untagged and tagged enums, `flatten`) as a one-member map, not a number, and a float is no longer recovered from it. | With no PSIO call anywhere, linking the crate (a) breaks reading a float through `serde_aux::deserialize_number_from_string` (psibase uses that function 65 times; on floats in `rust/fracpack/src/schema.rs:2065, 2072`, the schema-driven JSON → binary path behind the CLI and traces); (b) changes the text of an `f32` written to JSON (shortest `f32` digits instead of the widened `f64`: `1e-45` for `1.401298464324817e-45`), which no longer matches what C++ writes; (c) makes `serde_json::Value` keep a number's source digits (`1e2` is forwarded as `1e+2`, an integer beyond 64 bits as its digits, where both became floats; `Value` / `json!` occur 343 times in 49 files, mostly CLI and plugins). (a) and (b) fail `rs-tests` (`test_fracpack`: `generated_test0::run_tests`, `schema_json`). psibase cannot opt out of a dependency's feature. | A crate with `psio`, `serde`, `serde_json = "1"` and `serde-aux = "4"`: `#[derive(Deserialize)] struct D { #[serde(deserialize_with = "serde_aux::prelude::deserialize_number_from_string")] x: f64 }` and `serde_json::from_str::<D>(r#"{"x":1.5}"#)` → `Err("data did not match any variant of untagged enum StringOrInt")`; without `psio` → `Ok`. `serde_json::to_value(f32::from_bits(1))` → `1e-45`; without → `1.401298464324817e-45`. Integers are unaffected (`u64` through the same function, untagged and adjacently tagged enums, `flatten` were probed and read the same). Wanted: `psio` without `arbitrary_precision` in its default features — the bridge behind an opt-in feature, or reading the number text another way. |
| RG10 | **Distribution.** The crate is not on crates.io and its derives resolve `::psio`. | In the tree a path dependency into the pinned checkout is exact (D28). A service developed outside the tree (`cargo psibase` with the SDK, `package-templates`) needs `psio` from somewhere at the same commit as its `psibase`: a published crate, or the SDK shipping the Rust sources. To decide before the flip, not for R1–R5. | `package-templates/…/Cargo.toml.liquid` names `psibase.workspace = true` and gets it by path today. |
| RG11 | **Every dependent compiles every format.** There are no features for capnp, flatbuf, wit, pjson, ssz and the beacon-chain types: a service that needs pSSZ, keys and JSON compiles all of it and sees the crate's 6 warnings (`unused imports: ssz_struct_dwnc and ssz_struct`, …). | Build time and noise, in each of the 28 package target directories. Measured at about 1 % of a cold service build (6.10). Not a correctness matter. | `cargo build` of any dependent prints the warnings; `[features]` has only `experimental-frac` and bench switches. |

At `415ea1a6`:

| # | Status | How it was checked, and what psibase does with it |
|---|---|---|
| RG1 | Closed. `#[psio::interface]` on a trait gives the argument records, dispatch, a proxy and `SchemaBuilder::insert_interface`; `docs/pssz-rust-profile.md` states the one rule for the pSSZ of a function's arguments. | A trait with a capped method and an annotated parameter compiles and adds one interface to a schema. Not used yet: psibase's service macro moves onto it in R4. |
| RG2 | Closed: `psio::compress_name` (`method_to_number`, `number_to_method`, `is_hash_name`; `name_to_number` is PSIO's identifier coder, not psibase's account names — psibase keeps its own, the owner's decision). | Compared with `psibase_names` over 2.2 million texts: see RG12. Not used. |
| RG3 | Closed: operators, `to_unit` / `floor` / `ceil`, `Display` / `FromStr`, features `chrono` and `async-graphql`. | A `TimePoint<Seconds>` and a `Duration<Micros>` as members of an `async_graphql::SimpleObject` with stock serde derives compile and serialize; `+`, unit conversion and chrono conversion work. Not used: D34. |
| RG4 | Closed: `#[psio(custom = "time-point-seconds")]` is a compile error. | Tried. |
| RG5 | Closed: `schema_for::<schema_ir::Schema>()` is `Ok`. | Tried. Not used (the records that carry a schema are the legacy format until R7). |
| RG6 | Closed: `#[psio(max = N, element(...), keys(...), values(...), at(I, ...))]` on a member, `#[pssz(max_dynamic_data = N)]` and `#[psio(returns(...))]` on an interface method. | Used once: `Memo`'s member, `#[psio(max = 80)]` (6.13). See RG13 for what it does not cover. |
| RG7 | Closed: a unit alternative is `{"Unit":{}}`, a struct alternative a record. | Tried. |
| RG8 | Closed: `docs/pssz-rust-profile.md` and `lib.rs` describe the crate as it is. | Read; the plan's spellings were checked against them. |
| RG9 | **Closed.** `psio` enables only `raw_value` of `serde_json`. | `rs-tests` with `psio` linked: `test_fracpack` 21 / 21 with no change to `rust/fracpack` (6.10). |
| RG10 | Open (distribution; before the flip). | — |
| RG11 | Closed: with no feature a dependent compiles pSSZ, keys, text, the Schema IR, time, names and interfaces; the other formats are features. | psibase asks for no feature; the crate builds without warnings of its own in psibase's workspaces. |
| RG12 | **New, open.** `psio::compress_name::method_to_number` (and C++ `psio::detail::method_to_number`) returns a truncated arithmetic code for a name whose code runs past 64 bits in its last partial byte: the number is not marked as a hash and `number_to_method` does not return the name. | Reproduction: `method_to_number("getSymbolType")` = `0x7ea96086faa7f7c0`; `number_to_method(0x7ea96086faa7f7c0)` = `"getsymboltyp"`. (`"TxSuccessTable"` → `0x04ac12664a779248` → `"txsuccesstabl"`.) The encoder zeroes its output, and so falls back to the hash, when a set bit would land on bit 63 or the input is not consumed, but not when the final partial byte lies beyond bit 64 (C++ `psio/compress_name.hpp`: `if (m_Mask != 0x80 and m_bit < 64) m_output \|= …` has no `else`). psibase's Rust coder has that `else` (`method_to_number_converter.rs`: `self.output = 0`) and hashes the name. Also: `method_to_number("#abc")` is `u64::MAX` where psibase's Rust reads 0. Effect: psibase cannot replace its Rust method coder with PSIO's without changing method numbers (D33). |
| RG13 | **New, open.** `#[derive(psio::Key)]` on a `#[psio(transparent)]` type ignores the bound of its member. | `#[derive(PsszPack, PsszUnpack, Key, JsonText)] #[psio(transparent)] struct Memo(#[psio(max = 4)] String);` — `psio::from_key::<Memo>(&psio::to_key(&"abcde".to_string()))` is `Ok`, and so are `validate_key` and `try_to_key(&Memo("abcde".into()))`, while `from_pssz` and `from_ijson` of the same text are errors. The same bound on a member of an ordinary record is enforced in a key (`from_key` and `try_to_key` are errors), and `from_key::<BoundedString<4>>` is an error. (Separately, `try_to_key(&BoundedString::<4>("abcde".into()))` is `Ok`: the writer trusts the wrapper's public field.) `docs/pssz-rust-profile.md` says an annotated member has "the same checks … in Json / IJson text and in keys". Effect: `psibase::Memo` does not derive `Key` (6.13). |

At `c6d99404`:

| # | Status | Reproduction / description |
|---|---|---|
| RG13 | Closed, verified: `psio::from_key::<Memo>(&psio::to_key(&"abcde".to_string()))` with `Memo(#[psio(max = 4)] String)` is an error now. | `psibase::Memo` could derive `psio::Key`; not done (it is not a legacy key either). |
| RG12 | Open (announced for a later pin). | `MethodNumber` and the service macro stay on psibase's coder; the place to switch is marked in `service_macro/actions.rs` (`check_method_number`). |
| RG14 | **New, open.** A C++ `std::vector<char>` and a `std::vector<std::uint8_t>` are different Schema IR nodes, and Rust can only say the second. | C++: `psio::SchemaBuilder b; b.insert<std::vector<char>>("A"); b.insert<std::vector<std::uint8_t>>("B");` → `A` = `Custom{List<Custom{Int{8, unsigned}, "char"}>, "hex"}`, `B` = `Custom{List<Int{8, unsigned}>, "hex"}`. Rust: `schema_for::<Vec<u8>>()` = `B`; no Rust type gives `A` (`"char"` is a reserved id the dynamic codec reads, `rust/psio/src/pssz_schema_ir.rs:373`). pSSZ, key and I-JSON of the two are identical. Effect: a C++ record with a `std::vector<char>` member and its Rust twin never have equal schemas (14 psibase records today, D41). Wanted: one node for a byte sequence whatever the C++ element spelling, or a Rust spelling of the other. |
| RG15 | **New, minor.** `&[u8]` (and `&str`, `&[T]`) is `PsszPack` but not `ToPsszSchema` or `KeyPack`-with-`KeyUnpack`, so a record that borrows (`SharedAction<'a> { rawData: Hex<&'a [u8]> }`) can derive `PsszPack` only: no schema, no `psio::Key`. | `#[derive(psio::PsszPack, psio::ToPsszSchema)] struct S<'a> { b: &'a [u8] }` → "the trait bound `&'a [u8]: ToPsszSchema` is not satisfied". Not blocking: the owned twin has the schema, and psibase's three such records only need to be written. `psio::Key` on a borrowing record would need a write-only key derive. |

Not gaps: tuples stop at 12 elements (psibase's largest action has 9
arguments, and R4 stops packing tuples); `Rc` / `Arc` are not pSSZ values
(psibase packs none); a field-less enum needs `#[repr]` (a decision per
enum).

Not evaluated: whether `psio::pssz::dynamic` with `CustomHandlers` can carry
what `trace.rs` does today (an action's `rawData` is decoded with the *target
service's* schema, fetched asynchronously, 500 lines), and whether
`psio::pssz::upgrade` answers what `SchemaMatcher` answers for package
upgrades. Both belong to R7 and need their own probe.

### 6.9 Where psibase Rust would declare bounds and caps (RG6)

Nothing in Rust declared a size before R2 (fracpack has no bounds); limits
are run-time checks inside actions. PSIO Rust has member annotations and
argument caps now (RG6 closed); `Memo` is declared (6.13) and nothing else,
because the per-type audit awaits the owner. These are the places, to be stated identically in C++ where
the type exists there:

* `Memo` (80 bytes, UTF-8): the member behind `transparent`; 120 uses.
* `Precision` (0–8) is an invariant, not a bound.
* Registry: an app has at most 3 tags of at most 30 bytes each
  (`MAX_APP_TAGS`, `MAX_TAG_LENGTH`, checked in `tables.rs`) — exactly the
  nested form, `#[psio(max = 3, element(max = 30))]` on the tag list — and
  names of at most 30 (`MAX_NAME_SIZE`).
* Profiles: the avatar, at most 100 KiB (`MAX_AVATAR_SIZE`).
* BtcBridge (`tx.input.len() <= 256`, a cursor of at most 73 bytes),
  BtcRelay (`headers.len() <= 32`, a context of at most 2027 bytes),
  EthRelay (`fact_json.len() <= 32768`, `network_json.len() <= 8192`),
  Exchange (page text of at most 2048 bytes).
* 69 length comparisons were found in service code and `rust/psibase`
  (`git grep -P 'len\(\)\s*(<=|<|>|>=)'`); the list above is those whose
  constant or assertion message says they limit data the service accepts.
  Whether each is an action argument or a row member, and the rest of the
  69, were not classified.
* Every action record: an argument cap, so that a call's argument frame has
  a narrow width where its members allow; C++ `MethodArgs<M>` and the Rust
  action record must then agree (RG1 b).
* Table rows with a natural cap (`#[pssz(max_dynamic_data = N)]` exists
  already): not started; a per-table decision at R5.

### 6.10 Slice R1 (done)

R1 was written against `224f80de`, where it could not be committed (RG9:
depending on `psio` changed `serde_json` for every crate and failed two
tests of `test_fracpack`). At `415ea1a6` PSIO no longer does that, and R1 is
in the tree unchanged apart from one added test.

**Subset and why.** `AccountNumber` and `MethodNumber`: they are in nearly
every record and action (2,036 and 169 uses), so nothing else can be
declared before them; they are the best-specified types of the conversion
(C++ slice 1 pinned their bytes, keys, texts and rejections in
`leaf_types.cpp`); and they exercise the whole PSIO Rust surface a psibase
type needs — fixed-layout record, custom text form, key, view, schema — on
two types small enough to check by hand.

**Acquisition** (decision D28). `rust/Cargo.toml` declares
`psio = { path = "../external/psio/rust/psio" }` and `rust/psibase` depends
on it, with no cargo feature: pSSZ, keys, Json / IJson text, the Schema IR,
time, names and interfaces are what the crate compiles by default (RG11).
`external/psio` is the checkout CMake fetches and verifies against the pin
on every configure (head equal to the pinned commit, clean tree), so Rust
and C++ build one PSIO source and cannot drift; the pin is still stated
once. Cargo writes nothing into the checkout (its lock and target
directories belong to the dependent workspace; checked: the checkout is
clean after the builds). The other workspaces reach `psio` through
`psibase`; their seven lock files gain the two path packages `psio` and
`psio-macros` (21 lines each) and nothing else: every crate `psio` depends
on was already in each of them, at the same version. Consequence: `cargo`
in a tree that was never configured fails with "failed to read
…/external/psio/rust/psio/Cargo.toml"; configure once.

**Declarations.** Both types keep `Pack, Unpack, ToKey, ToSchema` and gain
`psio::PsszPack, psio::PsszUnpack, psio::PsszView, psio::ToPsszSchema,
psio::Key` with `#[psio(definition_will_not_change, custom = "…")]` (the ids
`AccountNumber` and `MethodNumber`), and a text form
(`impl psio::json::TextForm`, `psio::json_text_form!`):

* `AccountNumber`: strict, as in C++ (D2). `from_text` is
  `AccountNumber::from_exact`: exactly the text `Display` writes.
* `MethodNumber`: as in C++ (D3). The empty text; a `#` form only if it is
  the one `Display` writes for that value; any other text if it names a
  method (value ≠ 0).

serde is untouched (`serialize_as_str!`, lenient `FromStr`): JSON as the
services and the CLI read it today does not change until R8.
`ExactAccountNumber` stays until then.

**Two panics removed in `rust/psibase_names`** (decision D30), because a
PSIO text form must report, not abort. Both were reachable from any JSON
that names an account or a method:

* `account_number_from_str("alice+")` (also `+x`, `+256`) called
  `sub.parse::<u8>().unwrap()`. It returns 0 now, the value every other
  non-name already has.
* `method_number_from_str("#abc#abc#abc#abc#")` (17 characters starting with
  `#`, one of them outside the alphabet) computed `table[c] - 1` on 0: a
  panic where overflow checks are on, a wrapped symbol otherwise. It is not
  a hash form, and reads as 0 like other invalid text.

**The method half of `psibase_names` is not replaced by
`psio::compress_name`** (gap RG12, decision D33). PSIO has the coder now
(RG2 closed), and replacing psibase's was the plan. Before deleting it the
two were compared over 2.2 million texts (every identifier in the tree,
random text over a wider alphabet, random hash forms; scratch program, not
in the tree). Number → text agrees everywhere. Text → number differs in two
classes:

* **A name whose arithmetic code runs past 64 bits in its last, partial
  byte.** psibase's Rust coder gives it the hash of the name (bit 56 set,
  written `#…`). PSIO — Rust and C++ alike, and psibase's legacy C++
  (`psio1/compress_name.hpp`), which PSIO reproduces byte for byte — keeps
  the truncated code: `method_to_number("getSymbolType")` is
  `0x7ea96086faa7f7c0`, which is not marked as a hash and reads back as
  `getsymboltyp`. 561 of the 29,860 identifiers in the tree are in this
  class, and 15 of the 606 action and event names: `add_liquidity`,
  `checkFirstAuth`, `cpu_min_unit`, `create_request`, `created_fractal`,
  `frozenAccounts`, `getSymbolType`, `get_resources`, `on_ev_unreg`,
  `received_income`, `removeCallback`, `rowsBySecondary`, `setWasmCfg`,
  `set_g_rep`, `set_paid_occ`.
* **Text that starts with `#` and is not 17 characters long** (it names no
  method): psibase's Rust reads 0, PSIO `u64::MAX`.

So C++ and Rust psibase do not agree on these method numbers **today**,
before any of this work: a C++ caller of the Rust service
`VirtualServer::get_resources` (it has a C++ header) sends
`0xb2a0545cdfc9f9c0`, the Rust dispatcher expects `0xd5137f98107c0181`; the
Rust view of `Transact::checkFirstAuth` and `removeCallback` and of
`Symbol::getSymbolType` sends the hash, the C++ dispatcher expects the
truncated code. Whether any such pair is exercised was not established (no
test fails). Switching Rust to `psio::compress_name` would make the two
languages agree, by changing the number of every Rust action in the class
(wire) and by adopting the lossy code. That is not a wire-neutral step and
not one to take silently, so `MethodNumber` keeps psibase's coder,
`psio_leaf_types.rs` pins the difference (the test fails the day the two
coders agree), and the choice is the owner's (D33). What remains of
`rust/psibase_names` either way: the account-name coder
(`account_number.rs`, `name_encoder.rs`, `frequency.rs`, the account half of
`constants.rs`), which is psibase's own in C++ as well, and its use by the
`account!` / `method!` macros (`psibase-macros-derive/src/number_macro.rs`).

**Tests.** `rust/psibase/tests/psio_leaf_types.rs`, 13 tests: the vectors of
`leaf_types.cpp` for both types — pSSZ bytes and sizes, rejected lengths,
key bytes, key order over the same value lists, composite key and prefix,
I-JSON text in both directions, the hash form of a method that does not
compress, every rejected text of the C++ lists (plus `"alice+x"` and the
malformed hash form above), the schema node and its custom id; one test
that the forms in use are unchanged (fracpack bytes, legacy keys, lenient
serde); and the pinned difference between the two method coders.

**RG9 is gone, checked in the tree.** With `psio` linked into every crate,
`rs-tests` passes with no change to `rust/fracpack` and nothing added to
any test: the 21 tests of `test_fracpack` pass, among them
`generated_test0::run_tests` and `schema_json`, the two that failed. In a
scratch crate with `psio`, `serde-aux` and `serde_json`,
`deserialize_number_from_string` reads `{"x":1.5}` as an `f64`,
`serde_json::to_value(f32::from_bits(1))` is `1.401298464324817e-45`, and a
`serde_json::Value` writes `{"a":1.0,"b":10000000000000000000000,"c":1e2}`
back exactly as the same `serde_json` does without `psio`. What `psio`
still asks of `serde_json` is `raw_value`, which adds a type and changes
nothing for code that does not name it.

**What was checked with R1.**

| | |
|---|---|
| Full build | exit 0 (`~/psibase-pssz-build.build-r1.log`); `psio` builds for `wasm32-wasip1` inside every service |
| `ctest -j4` | 92 / 92 (`~/psibase-pssz-build.ctest-r1.log`; binaryen was upgraded while this run was in progress, 1.15, and nothing failed) |
| `rs-tests` | `test_fracpack` 21 / 21, `psibase` 95 unit tests, `psio_leaf_types.rs` 13 / 13 |
| Generated `*-schema.json` (68) vs. the build of 0167a3056 | byte-identical |
| wasm in the build directory | the 222 C++ service and test binaries byte-identical to the build before R1; of the 37 plugin components 12 are byte-identical and 25 differ (not examined: plugins are not run by any test, 6.5). The Rust services' wasm is built in the source tree and was not compared |
| The six packages the build never compiles (6.5) | `cargo check --target wasm32-wasip1` of their service, query and core crates: exit 0 (`~/psibase-pssz-build.r1-check-unbuilt.log`; needs `CC_wasm32_wasip1` set to the WASI SDK's clang for `secp256k1-sys`) |

### 6.11 JavaScript / TypeScript

Surveyed over tracked `*.ts, *.tsx, *.js, *.mjs` outside `external/`.

**Where binary is produced or read.** There is no fracpack codec in JS: no
schema-driven packer, no `wasm-bindgen`. The browser gets packed bytes three
ways:

| Path | Where | What |
|---|---|---|
| Server pack endpoints | `packages/user/CommonApi/common/packages/common-lib/src/rpc.ts` (399 lines): `packAction` → `POST <service>/pack_action/<method>` (line 211), `packTransaction` → `/common/pack/Transaction` (229), `packSignedTransaction` → `/common/pack/SignedTransaction` (265), `packAndDigestTransaction` / `signTransaction` (SHA-256 of the returned bytes, client side), `pushPackedSignedTransaction` → `transact/push_transaction` | JSON in, packed bytes out; the client never lays out a byte. Only `SimpleUI.mjs` calls these outside common-lib. |
| Hand-written bytes | `common-lib/src/key-conversions.ts`: `publicKeyPairToFracpack` (179–196), `signatureToFracpack` (242–258) write a fracpack variant by hand (`[4,0,0,0]`, index, size, bytes) | **Neither is called anywhere in the tree.** Delete at the flip. |
| Rust compiled to wasm | Plugins (162 tracked `.rs` under `packages/**/plugin*`: `.packed()` 125 / 41, `unpacked(` 36 / 11) and the XAdmin helper (`packages/local/XAdmin/ui/wasm/src/lib.rs`: boot transactions packed, `TransactionTrace::unpacked`) | The real client-side packing. It moves with Rust (R5, R7), not with JS. |

Packed data otherwise appears as hex (`rawData`, 53 uses in 17 files):
action arguments shown by the Explorer UI, which prefers the server-decoded
`data` and has no decoder, and claim / key bytes in XAdmin and Config (DER,
not fracpack).

**What PSIO's JS package offers** (`external/psio/js`, package `psio` 0.1.0,
ESM, no runtime dependencies, ~7,500 lines, 19 test files): a schema-driven
codec — `PsszSchema`, `PsszType.encode / decode / validate / view`,
`jsonToPssz` / `psszToJson` (I-JSON and JSON), keys (`encodeKey`,
`encodeKeyPrefix`, `keyPrefixUpperBound`), read-only views, typed
definitions that generate the Schema IR (`record`, `variant`, `list`,
`optional`, `nested`, `transparent`, `custom`, `timePoint`, …), custom
handlers by id (its README's example is `AccountNumber`), time text, hex,
name compression (`nameToNumber`, `numberToName`, `hashName`).

**What a move to client-side packing would need** (decision D12 is still
open; nothing forces it — the pack endpoints can simply return pSSZ):

| Need | PSIO JS | Whose |
|---|---|---|
| Pack action arguments, `Transaction`, `SignedTransaction`; decode a trace | codec present | psibase: fetch the service schema (Schema IR JSON), declare or fetch the transaction types, register handlers |
| `AccountNumber` text ↔ u64 | Not established. `compress-name.ts` is headed as a port of the *method*-name compressor (its model table matches `psio/compress_name.hpp`); psibase account names use a different coder (`psibase/name.hpp`, 36 symbols, 10 characters, `+N` subaccounts). The README row "Account names → `nameToNumber`" does not look right for psibase. Read, not run. | PSIO to clarify; otherwise psibase supplies the handler |
| SHA-256, ECDSA, key text formats | none, by design | psibase keeps `hash.js` / WebCrypto and `key-conversions.ts` |
| Hex case | `toHex` writes lower case; `uint8ArrayToHex` upper case | psibase; whether a consumer depends on the case was not checked |
| Distribution | `dist/` is not committed and the package is not in psibase's yarn workspace; whether it is on npm was not verified | both |

**Tests.** No ctest test runs JavaScript. The UI packages are built
(`web-apps.cmake`: 15 UIs, common-lib) and 16 JS test files exist (vitest
and `node --test`, run only by per-package scripts); none of them touches
packing. PSIO's JS tests were not run here.

### 6.12 Python

`programs/psinode/tests/fracpack.py` (1,246 lines) is a schema-driven
fracpack codec: type objects (`Int`, `Float`, `Struct`, `Object`, `Array`,
`List`, `Option`, `Variant`, `Tuple`, `FracPack` (nested), `Custom`, `Type`),
custom adapters (`Bool`, `String`, `Hex`, `Map`), a schema loader for the
legacy schema JSON, and schema compatibility. Values are JSON-shaped Python
objects.

| User | Uses |
|---|---|
| `psibase.py` | `AccountNumber`, `MethodNumber` (with `name.py`, 451 lines), `TimePointSec`, `Action` (packs `data` with the target service's schema), `Tapos`, `Claim`, `Transaction`, `SignedTransaction`, `ServiceSchema` |
| `psinode.py` | fetches `/schema?service=X` from `packages`, `pack_transaction`, `pack_signed_transaction`, `sign_transaction` (SHA-256, P-256), `push_transaction`, `push_action`, `set_producers` |
| `services.py`, `test_shutdown.py`, `test_subjective.py` | one declared record (`LoginData`), `push_action`, one `unpack` of a `u32` return value |
| `test_fracpack.py` | the codec's own tests against `libraries/psio1/tests/fracpack-tests.json` (153 values) |
| `test_psibase_types.py` | three golden hex strings for `Action` and `Transaction` |
| `packages/user/Exchange/test_math.py`, `test_stops.py` | not users: they search Rust source for a comment containing "Fracpack" |

Of the 18 Python ctest tests, `py_test_fracpack` and `py_test_psibase_types`
test the codec itself, `py_test_name` does not touch it, and all 15
`psinode_test_*` import it through `testutil` → `psinode`; eight of them
pack in the test file itself (`connect`, `psibase`, `subjective`, `txqueue`,
`shutdown`, `snapshot`, `block_signing`, `crash`). Boot and package install
go through the `psibase` CLI, not Python.

**The need** (PSIO has no Python: G9). A replacement must load the Schema IR
that `/schema` will return, encode JSON-shaped values — records with
trailing-optional pruning, lists, optionals, variants as `{"Name": value}`,
tuples, arrays, nested values, byte strings from hex, strings, booleans,
integers to 64 bits — under the automatic width profile (which means
computing inferred bounds and caps as `docs/pssz-type-width.md` states
them), decode at least a `u32`, and carry four custom types
(`AccountNumber`, `MethodNumber`, a time point, `Action` with its context).
Keys, views and the other formats are not used by any test. Estimate, not a
measurement: 1,000–1,500 lines for that subset; 2,500–4,000 for a codec that
replays PSIO's conformance vectors (`conformance/pssz-vectors.json`, 5,167
vectors; the JS equivalent, `pssz-core.ts` + `pssz-json.ts` + `pssz.ts`, is
about 4,150 lines). The alternative that needs no Python codec: the tests
call the node's pack endpoints, as the JS client does; they would then test
less (no independent encoder) but need nothing from PSIO. Not determined:
the exact argument shapes of the actions the tests push (whether any holds a
map, which would pull the key encoding into the subset).

### 6.13 Slice R2 (leaf and wrapper types: done for four, three wait)

| Type | State | PSIO declaration |
|---|---|---|
| `Memo` | done | `#[psio(transparent)] struct Memo(#[psio(max = 80)] String)` with `PsszPack, PsszUnpack, ToPsszSchema, JsonText`. Not `Key` (RG13). |
| `tokens::Precision` | done | `#[psio(transparent, invariant = "Precision::in_range")]` with `PsszPack, PsszUnpack, ToPsszSchema, Key, JsonText` |
| `tokens::Quantity` | done | the record, with `PsszPack, PsszUnpack, PsszView, ToPsszSchema, Key, JsonText`; `Quantity::from_str` rejects overflow |
| `tokens::Decimal` | done | the record `(quantity, precision)` with `PsszPack, PsszUnpack, PsszView, ToPsszSchema, Key`, `#[psio(custom = "Decimal")]` and a `TextForm` (`Display` / `FromStr`) |
| `TimePointSec`, `TimePointUSec`, `Seconds`, `MicroSeconds` | **wait for R7 / R8** (D34) | `psio::time::TimePoint<Seconds>` …, replacing psibase's structs |
| `Hex<T>`, `Checksum256` | **wait for R8** (D29) | `Vec<u8>`, `[u8; N]` |
| `auth_sig::SubjectPublicKeyInfo` | **waits for its C++ twin** (D26) | `transparent` over the DER bytes, PEM text |
| `ExactAccountNumber`, `MethodString` | not converted | deleted at R8 / part of the legacy schema format |

**`Memo`.** The owner's decision for the flip is a UTF-8 string of at most
80 bytes. In Rust the PSIO declaration is independent of the legacy one
(another derive on the same type), so it says that now: the member carries
the bound, `#[psio(max = 80)]`, and a Rust `String` is UTF-8. Nothing
psibase writes today changes: `Pack`, the hand-written `Unpack` and
`serialize_as_str!` are untouched and still produce every byte and text
(pinned: `psio_wrappers.rs`, "the packed and JSON forms in use are
unchanged"). Under PSIO a memo is its text in pSSZ and I-JSON, and a text
over 80 bytes or not UTF-8 is refused by `validate_pssz`, `from_pssz`,
`from_ijson` and by the writers. Two things to know:

* The C++ declaration is still `transparent(), invariant(wellFormed)` over a
  `std::string`: the same bytes and text for a memo by itself, but another
  schema node (`Custom{string, "Memo"}` against Rust's
  `Custom{BoundedList<u8, 80>, "utf8"}`) and, inside a record, possibly
  another offset width (a bound narrows it). C++ must declare
  `attr(contents, utf8 | max<80>)` before the flip for the two to agree;
  `psio_twins.rs` pins exactly this difference and fails when it is gone
  (D5, D37).
* `Memo` does not derive `psio::Key`: PSIO's key derive does not enforce the
  bound of a transparent type's member (RG13). It is not a `ToKey` today
  either, so nothing is lost.

**`Precision`, `Quantity`, `Decimal`.** As C++ (1.11): `Precision` is its
number with the invariant 0–8, and the rejection names the value ("Value 9
outside allowed Precision range: 0 to 8", the C++ text); `Quantity` is the
record of its `u64`; `Decimal` is the record `(quantity, precision)` in
pSSZ and key and the decimal number in text. Rust's `Decimal` had no codec
at all (it was never packed in Rust); it has C++'s now.

**The approved behaviour change: `Quantity::from_str` rejects overflow**
(D17). It added the scaled integer part and the fraction with a plain `+`:
`"184467440737.09551616"` at precision 8 panicked where overflow checks are
on and read as 0 where they are off. It is `checked_add` now and the text is
`TokensError::Overflow`, as the neighbouring `checked_mul`s already were.
`Decimal::from_str` and the serde reader of `Decimal` go through it, so every
Rust reader rejects what every C++ reader rejects. Tests: `quantity.rs`
(unit: the boundary at precisions 0, 1, 2, 4, 7, 8 — 2^64 − 1 is read, 2^64
is not — and four texts further out), `psio_wrappers.rs` (the same through
`FromStr`, `from_ijson` and serde).

**One more wrap of the same kind, fixed with it — not in the approved
list** (D38). Both parsers counted fraction digits with `len() as u8`, so a
fraction of 256 digits counted as none: `"5." + 255 zeros + "1"` read as the
quantity 6 at precision 0. Both use `u8::try_from` now and such text is
`PrecisionOverflow`, which is what C++ `Decimal::parse` answers (it
compares the length with 8). Text that was read wrongly is rejected;
nothing that was read correctly changes.

**Time waits** (D34). Not for something `psio::time` lacks: the operators,
unit conversions, `Display` / `FromStr`, `chrono` conversions and
`async-graphql` scalars that RG3 asked for are there and were exercised
(scratch crate: a `TimePoint<Seconds>` member of a `SimpleObject` with stock
serde beside it). It waits because the replacement is not wire- and
JSON-neutral and cannot be made additive:

* The four psibase types are structs of their own (`TimePointSec { seconds:
  i64 }`). The PSIO form of time is `psio::time::TimePoint<U>`, another
  type, not a derive on these: a psibase struct cannot claim the schema id
  `time-point-seconds` (reserved, RG4, correctly), so "the same struct with
  PSIO derives" would be a declaration that is not the final one.
* Replacing the type changes the JSON psibase writes. Today Rust writes a
  time point with chrono: `"2026-11-22T10:15:30+00:00"`, the fraction only
  when it is not zero (`…30.123456+00:00`), and reads any offset and drops a
  fraction it cannot hold; a duration is the record `{"value":5}`. PSIO
  writes `"2026-11-22T10:15:30Z"` with exactly the unit's digits, rejects a
  fraction the unit cannot hold, and a duration is `5`. The GraphQL scalar
  names change too (`TimePointSec` → `DateTimeSeconds`; C++ `psio::graphql`
  calls every time point `DateTime`).
* Until the wire flip every record that holds a time point still derives
  `fracpack::Pack`, so `psio::time::TimePoint` would need the legacy traits:
  `Pack` / `Unpack` / `ToSchema` can only be implemented in `rust/fracpack`
  (orphan rule), which is glue of the kind this plan does not add.

So the uses of the two time points (about 90 lines in 37 files) move with R7 (the type) and R8 (the text), and
every record with a time member waits with them: `Tapos` and through it
`Transaction`; `BlockHeader` (`BlockTime`) and through it `Block`,
`SignedBlock`, `BlockInfo`, `StatusRow`; `RunRow`.

**`Hex<T>` and `Checksum256` wait** (D29, the owner's rule: no interim
workaround). PSIO expresses a byte sequence without a wrapper — `Vec<u8>`
and `[u8; N]` are hex in I-JSON — so `Hex<T>` has no PSIO declaration: it is
deleted at R8 and the members become the plain types. Before R8 that member
type cannot change (stock serde would write an array of numbers, and the
legacy schema would lose its `hex` node), and giving `Hex<T>` PSIO derives
for the interval is the workaround ruled out. PSIO has nothing that
expresses it more cleanly; `#[serde(with = "psio::serde_bridge")]` on a
plain `Vec<u8>` member would give the hex text but is the same kind of line
R8 deletes, and does not keep the legacy schema. Every record with such a
member therefore waits for R8 (the list is in 6.14).

Checked after R2:

| | |
|---|---|
| Full build | exit 0 (`~/psibase-pssz-build.build-r2.log`; from here on with `wasm-opt` 133) |
| `ctest -j4` | 92 / 92 (`~/psibase-pssz-build.ctest-r2.log`) |
| `rs-tests` | `psibase` 98 unit tests (3 added, `quantity.rs`), `psio_wrappers.rs` 6 / 6, `psio_leaf_types.rs` 13 / 13 |
| Generated `*-schema.json` (68) | byte-identical to the build of 0167a3056 |
| The six unbuilt packages | exit 0 (`~/psibase-pssz-build.r2-check-unbuilt.log`) |

### 6.14 Slice R3 (core records: 20 of 76 done, the rest wait)

`rust/psibase/src` outside `services` has 84 `Pack` derives in 10 files; 8
of them are the leaf types of R1 and R2 (`AccountNumber`, `MethodNumber`,
`Memo`; `ExactAccountNumber` and the four time types, not converted). Of
the other 76, 20 are declared with PSIO now and proved equal to their C++
twins; 56 wait, each for a reason outside this slice.

**Converted (20).** Each gains `psio::PsszPack, psio::PsszUnpack,
psio::PsszView, psio::ToPsszSchema` (and `psio::Key` where it derives
`ToKey`), and `#[psio(definition_will_not_change)]` where the legacy
attribute says so. Nothing else changes; no bound or cap is declared (none
is enforced today for any of them, see the list below).

| File | Types |
|---|---|
| `block.rs` | `BlockHeaderCode` |
| `http.rs` | `HttpHeader` (fixed layout; `Key`) |
| `native_tables.rs` | `VMOptions`, `WasmConfigRow`, `ConsensusChangeRow`, `ScheduledSnapshotRow`, `LogTruncateRow`, `IPV4Address`, `IPV6Address`, `IPV4Endpoint`, `IPV6Endpoint`, `LocalEndpoint` (the five fixed layout), `TLSInfo`, `ServiceMethod` (`Key`), `EnvRow`, `HostConfigRow`, `PendingShutdownRow` |
| `package.rs` | `PackageRef`, `PackageExport` |
| `trace.rs` | `ConsoleTrace` |

**Waiting (56), by first reason.**

| Reason | Types |
|---|---|
| A `Hex<T>` / `Checksum256` member, directly or through a member (D29; R8) — 31 | `Action`, `SharedAction`, `GenesisService`, `SharedGenesisService`, `GenesisActionData`, `SharedGenesisActionData`, `Claim`, `SignedTransaction`, `Producer`, `CftConsensus`, `BftConsensus`, `ConsensusData`, `BlockHeaderAuthAccount`, `Consensus`, `PendingConsensus`, `JointConsensus`; `HttpRequest`, `HttpReply`; `CodeRow`, `CodeByHashRow`, `NotifyRow`, `BlockDataRow`, `StateChecksum`, `StateSignature`, `SnapshotStateItem`, `SnapshotRow`; `ActionTrace`, `InnerTraceEnum`, `InnerTrace`, `TransactionTrace`; `SignedBlock` (also behind C++) |
| A time member (D34; R7 / R8) — 7 | `Tapos`, `Transaction`, `BlockHeader`, `Block`, `BlockInfo`, `StatusRow`, `RunRow` |
| The C++ twin is not finally declared: the socket variants have a text form to come (1.9) — 7 | `IPAddress`, `SocketEndpoint`, and what holds them: `HttpSocketInfo`, `HttpClientSocketInfo`, `WebSocketInfo`, `SocketInfo`, `SocketRow` |
| **The Rust declaration is not the C++ one today** (D36) — 4 | `ConfigRow` (C++ has a third member, `maxBlockSize`); `LogMessage` (C++ order is `severity, message, service`, Rust `message, severity, service`: different bytes today); `ProducerMultiCastSocketInfo` (C++ `ProducerMulticastSocketInfo`); `RunMode` (C++ an `enum class : uint8_t`, Rust a tuple struct over `u8`). Also wrong and already listed above: `SocketInfo` (C++ has six alternatives, `LogSocketInfo` second and `P2PSocketInfo` last; Rust has four, so every index after the first differs) and `SignedBlock` (C++ has `auxConsensusData`) |
| No C++ twin — 1 | `ConsensusBytes` |
| The legacy schema format, replaced by the Schema IR at R7 — 5 | `MethodString`, `EventType`, `FieldId`, `TableInfo`, `Schema` (`schema.rs`) |
| A serde attribute PSIO's schema derive refuses (`#[serde(default)]`; R8) — 1 | `package::Meta` |

**Strings.** A Rust `String` is UTF-8 for PSIO and a C++ `std::string` raw
bytes, by the owner's rule; the bytes are the same and the schema node is
not (`Custom{List<u8>, "utf8"}` / `"string"`). Eight of the 20 hold a
`String` whose C++ member is a `std::string` without `utf8`: `HttpHeader`
(`name`, `value`), `LocalEndpoint` (`path`), `EnvRow` (`name`, `value`),
`HostConfigRow` (`hostVersion`, `config`), `PendingShutdownRow` (`args`),
`PackageRef` (`name`, `version`), `PackageExport` (`name`), `ConsoleTrace`
(`console`). For these the cross-check requires the two schemas to be equal
*once a raw string is read as a UTF-8 one* and to be unequal before that,
so the list is exact and a type leaves it when either side changes. Which
side changes is the per-member decision of the size and string audit: where
it says UTF-8, C++ gains `attr(member, utf8)`; where it says raw
(`LocalEndpoint::path`, `EnvRow::name` / `value`, `ConsoleTrace::console`,
`HttpHeader::value`), the Rust member becomes `psio::pssz::RawString` at
R7. D35.

**`ServiceMethod` and `Action` carry a custom id in the legacy schema**
(`custom = "ServiceMethod"`), which the PSIO declarations in C++ do not
state yet (G13). `ServiceMethod` is declared as C++ declares it today, a
plain record; if C++ gives it an id, both change.

**No bounds or caps were declared.** None of the 20 enforces a limit today.
What `~/psibase-pssz-audit/size-and-string-audit.md` recommends for them,
for the owner's approval, not in the code:

| Type | Recommended |
|---|---|
| `Memo` | 80 bytes, UTF-8 — the one limit enforced today; declared (6.13) |
| `VMOptions`, `WasmConfigRow`, `ConsensusChangeRow`, `ScheduledSnapshotRow`, `LogTruncateRow`, `ServiceMethod`, `TLSInfo`, `Quantity`, `Decimal` | `maxDynamicData(255)` (no variable member; 8-bit either way) |
| `HttpHeader` | `name` ≤ 256 UTF-8, `value` ≤ 8192 raw; `maxDynamicData(65535)` |
| `LocalEndpoint` | `path` ≤ 4096 raw; `maxDynamicData(65535)` |
| `EnvRow` | `name` ≤ 120 raw, `value` ≤ 16384 raw; `maxDynamicData(65535)` |
| `HostConfigRow` | `hostVersion` ≤ 64 UTF-8, `config` unbounded UTF-8; no cap |
| `PendingShutdownRow` | `args` ≤ 16384 UTF-8; `maxDynamicData(65535)` |
| `PackageRef` | `name`, `version` ≤ 64 UTF-8; `maxDynamicData(65535)` |
| `PackageExport` | `name` ≤ 64 UTF-8; `maxDynamicData(65535)` |
| `BlockHeaderCode`, `ConsoleTrace` | no cap (`code`, `console` unbounded raw) |

### 6.15 The C++ ↔ Rust cross-check

One file, written by C++ and read by Rust, that neither side can change
alone:

* `libraries/psibase/common/tests/rust_twins.cpp` (part of the native
  `psibase-psio-tests`) builds, from the C++ declarations, the Schema IR of
  each type (`psio::SchemaBuilder`, written as pSSZ with `psio::emit_pssz`)
  and sample values of each in pSSZ, key and I-JSON form, and requires the
  result to be byte-equal to `rust-twins.json` beside it
  (`PSIBASE_WRITE_RUST_TWINS=1` rewrites the file).
* `rust/psibase/tests/psio_twins.rs` (part of `rs-tests`) reads that file
  and requires, for the Rust declaration of each type: the same schema node
  with every reference resolved; every value's pSSZ bytes accepted by
  `validate_pssz`, decoded and written back byte-identical; the same key,
  written and read, where the Rust type is a key; the same I-JSON text,
  written and read, where it has text. It also requires every type of the
  fixture to be checked, so a type added in C++ fails in Rust until it is
  declared there.

The method is PSIO's own for its annotated-bounds vectors (the Rust test
decodes the IR C++ wrote and compares resolved nodes). 26 types and 64
values: the two names (schema, bytes, key, text), `Precision`, `Quantity`,
`Decimal` (the same four), `Memo` (bytes and text; its schema is the pinned
difference of 6.13), and the 20 records of R3 (schema and bytes; key for
`BlockHeaderCode`, `HttpHeader`, `ServiceMethod`). All agree, with the two
stated exceptions (raw / UTF-8 strings in eight records, `Memo`'s bound).
What the fixture does not show: the method names of RG12 (not among its
values), and anything about the 56 types that wait.

Checked after R3:

| | |
|---|---|
| Full build | exit 0 (`~/psibase-pssz-build.build-r3.log`) |
| `ctest -j4` | 92 / 92 (`~/psibase-pssz-build.ctest-r3.log`) |
| `rs-tests` | `psio_twins.rs` 1 / 1 (26 types), `psio_wrappers.rs` 6 / 6, `psio_leaf_types.rs` 13 / 13 |
| `psibase-psio-tests` (native) | 38 test cases, 1 of them `[twins]` |
| Generated `*-schema.json` (68) | byte-identical to the build of 0167a3056 |
| The six unbuilt packages | exit 0 (`~/psibase-pssz-build.r3-check-unbuilt.log`) |

### 6.16 `Hex<T>` and the records it held back (D29 revised)

The decision is revised by the coordinator: `Hex<T>` is psibase's own serde
wrapper and is needed between the wire flip and the JSON flip whatever
else happens, and PSIO is not going to change for it, so
`#[psio(transparent)]` on it is its declaration for that period, not a
workaround.

```rust
#[derive(Debug, Clone, Hash, PartialEq, Eq, PartialOrd, Ord,
         psio::PsszPack, psio::PsszUnpack, psio::ToPsszSchema, psio::Key, psio::JsonText)]
#[psio(transparent)]
pub struct Hex<T>(pub T);
```

The derives are generic: `Hex<Vec<u8>>`, `Hex<[u8; N]>` (so `Checksum256`)
are their member in pSSZ, key, I-JSON and the Schema IR; `Hex<&[u8]>` is
written (`PsszPack`) and nothing else, because PSIO reads owned values and
a borrowed slice has no schema of its own. The legacy `Pack`, `Unpack`,
`ToKey`, `ToSchema`, serde and GraphQL impls are untouched.
`psio_wrappers.rs` has the tests: bytes, key, text and schema node equal
to the bare type's, in a record and in a list too, rejection of a short
digest and of text that is not hex, and the legacy forms unchanged. That
the bare type is also the C++ member's is in the fixture (`Checksum256`,
`Bytes` = `std::vector<char>`, `Octets` = `std::vector<std::uint8_t>`).

**Declared (20 of the 31 that waited; `NotifyRow` in 6.17 makes 21).** With `PsszPack, PsszUnpack,
PsszView, ToPsszSchema` (and `Key` where they derive `ToKey`): `Action`,
`GenesisService`, `GenesisActionData`, `Claim`, `Producer`, `CftConsensus`,
`BftConsensus`, `BlockHeaderAuthAccount`; `HttpRequest`, `HttpReply`;
`CodeRow`, `CodeByHashRow`, `BlockDataRow`, `StateChecksum`,
`StateSignature`, `SnapshotStateItem`, `SnapshotRow`. With `PsszPack`
only, because they borrow: `SharedAction`, `SharedGenesisService`,
`SharedGenesisActionData` (the test requires them to write the bytes of
the owned records). `NotifyRow` joined in 6.17.

**Still waiting (10).**

| Reason | Types |
|---|---|
| The labels and text names of a variant's alternatives are not settled (D39) — 4 | `ConsensusData`, and what holds it: `Consensus`, `PendingConsensus`, `JointConsensus` |
| Time: `ActionTrace::totalTime` is a `std::chrono::nanoseconds` in C++ (`Custom{i64, "duration-nanos"}`) and an `i64` in Rust (D34) — 4 | `ActionTrace`, `InnerTraceEnum` (also a variant, D39), `InnerTrace`, `TransactionTrace` |
| The C++ member is a legacy library type until the flip (`psio1::shared_view_ptr<Transaction>`; Rust `Hex<Vec<u8>>`, to become a nested value) — 1 | `SignedTransaction` |
| Holds a `BlockHeader` (time) — 1 | `SignedBlock` |

**A second listed difference: `char`.** A C++ `std::vector<char>` is
`Custom{List<Custom{u8, "char"}>, "hex"}` in the Schema IR and a
`std::vector<std::uint8_t>` is `Custom{List<u8>, "hex"}`, which is what a
Rust `Vec<u8>` is. Bytes, key and text are identical. psibase C++ writes
byte members as `std::vector<char>` almost everywhere (446 occurrences in
143 files; 74 of the unsigned spellings), so 13 of the records above
(and `NotifyRow`, 6.17) differ from their Rust twin in exactly that. The cross-check lists them
(`CharInCpp`) the way it lists raw / UTF-8 strings: the schemas must be
equal once a `char` is read as the `u8` it is, and unequal before. RG14,
D41.

### 6.17 The Rust declarations that had fallen behind C++ (D36)

Corrected to the C++ declarations. For each: what was wrong, who uses the
Rust type, and what now covers it.

| Type | Was | Now | Used in Rust by | Covered by |
|---|---|---|---|---|
| `ConfigRow` | two members | `maxBlockSize: u32` added (C++ `nativeTables.hpp`) | nothing (the declaration only) | the fixture: schema, pSSZ, legacy bytes |
| `LogMessage` | `message, severity, service` | `severity, message, service`, the order C++ reflects (its members are declared in another order than they are reflected) | nothing | the fixture |
| `NotifyRow` | JSON member `type_`; `key()` without the type | `#[serde(rename = "type")]`; `key()` is `(table, index, type)` as C++ `notifyKey`. The legacy schema still calls the member `type_` (the legacy derive does not read serde names) | nothing | the fixture (schema and bytes; not the key function, not JSON) |
| `SocketInfo` | four alternatives | the six of C++, in its order: `ProducerMulticastSocketInfo`, `LogSocketInfo`, `HttpSocketInfo`, `HttpClientSocketInfo`, `WebSocketInfo`, `P2PSocketInfo`; `LogSocketInfo` and `P2PSocketInfo` are new, `ProducerMultiCastSocketInfo` is renamed. Every index after the first was wrong | nothing (`SocketRow` holds it; nothing reads `SocketRow`) | **no test**: the socket variants are not PSIO-declared yet (their text form in C++), so they are not in the fixture |
| `SignedBlock` | two members | `auxConsensusData: Option<Hex<Vec<u8>>>` added | nothing | **no test** (it holds a `BlockHeader`, which waits for time) |
| `RunMode` | reported as "a struct where C++ has an enum" | **was not wrong on the wire**: the legacy derive packs a struct of one unnamed member as that member, so it has always been one byte, and its legacy schema is the integer, as C++'s is for an enum. It gains `#[psio(transparent)]` and the PSIO derives, which is what the C++ enum is for PSIO today (D40) | `tester.rs`, `tester_raw.rs` (an argument of the `runAction` host function, by value), `RunRow` (nothing reads it), one VirtualServer test | the fixture: schema, pSSZ, key, text, legacy bytes |

So the bytes the legacy Rust code packs changed for `ConfigRow`,
`LogMessage`, `SocketInfo` / `SocketRow` and `SignedBlock`, the JSON for
`NotifyRow`, and none of them had a reader or a test in Rust. `ctest`
(93 / 93) is unaffected.

**The fixture now carries legacy bytes as well** (`"frac"`: the value as
`psio1::convert_to_frac` packs it; temporary, deleted with the legacy
library), and `psio_twins.rs` requires the legacy Rust declaration of
every fixture type but `Decimal` (which has no legacy codec in Rust) to
read those bytes and write them back. This is the test that would have
caught D36: with the old `ConfigRow` it fails on the schema, and with the
old `LogMessage` on both. 50 types, 115 values.

Not exposed by the cross-check but seen while doing it, and left:
`ConsensusBytes` (Rust only, used by nothing: delete rather than declare),
and the Rust views of C++ services restate parameter names loosely (6.18).

### 6.18 What is left of R3, and raw or UTF-8 per string member (D35)

**Core records (`rust/psibase/src` outside `services`): 44 of 78 declared**
(20 in R3, 20 in 6.16, `ConfigRow`, `LogMessage`, `NotifyRow`, `RunMode`
in 6.17; the 76 of 6.14 and the two socket records added in 6.17). The 34
that wait, by first reason:

| Reason | Types |
|---|---|
| Time (D34; R7 / R8) — 12 | `Tapos`, `Transaction`, `BlockHeader`, `Block`, `SignedBlock`, `BlockInfo`, `StatusRow`, `RunRow`; `ActionTrace`, `InnerTraceEnum`, `InnerTrace`, `TransactionTrace` (a duration member) |
| Variant labels (D39) — 4 | `ConsensusData`, `Consensus`, `PendingConsensus`, `JointConsensus` |
| The socket variants' text form in C++ (1.9), and D39 — 10 | `IPAddress`, `SocketEndpoint`, `HttpSocketInfo`, `HttpClientSocketInfo`, `WebSocketInfo`, `P2PSocketInfo`, `SocketInfo`, `SocketRow`; `ProducerMulticastSocketInfo` and `LogSocketInfo` (empty records that could be declared; left with the variant that holds them) |
| The C++ member is a legacy library type until the flip — 1 | `SignedTransaction` |
| The legacy schema format (R7) — 5 | `MethodString`, `EventType`, `FieldId`, `TableInfo`, `Schema` |
| A serde attribute PSIO's schema derive refuses (R8) — 1 | `package::Meta` |
| No C++ twin, no user — 1 | `ConsensusBytes` (delete) |

Nothing in this list can move without one of: the time replacement, an
owner decision (D39), the C++ socket text adapters, or the flips. So this
step added no declaration; it is the list below.

**Raw or UTF-8.** Neither language was changed. Every `String` member of a
record declared in both languages whose C++ member is a `std::string`
without `utf8`, with a recommendation by the owner's rule (names, versions
and human text are UTF-8; header values, paths, environment values and
arbitrary bytes are raw). "UTF-8" means C++ gains `attr(member, utf8)`;
"raw" means the Rust member becomes `psio::pssz::RawString` at R7. All are
best estimates.

| Record | Member | Recommended | Why |
|---|---|---|---|
| `HttpHeader` | `name` | UTF-8 | a header name is an ASCII token; psibase compares it case-insensitively as text |
| | `value` | raw | a header value is bytes off the wire (RFC 9110 allows obs-text); rejecting a request for one header would be new behaviour |
| `HttpRequest` | `host` | raw | the Host header's value, not validated before the record is built |
| | `method` | UTF-8 | a token (`GET`, `POST`); psibase compares it with literals. Raw if an unknown method must still reach the service as it came |
| | `target` | raw | a path and query as sent, percent-encoding and all |
| | `contentType` | raw | a header value |
| `HttpReply` | `contentType` | raw | a header value, written by a service |
| `LocalEndpoint` | `path` | raw | a file-system path |
| `EnvRow` | `name` | raw | an environment variable's name: bytes to the host |
| | `value` | raw | an environment value |
| `HostConfigRow` | `hostVersion` | UTF-8 | a version |
| | `config` | UTF-8 | a JSON document |
| `PendingShutdownRow` | `args` | UTF-8 | a JSON document |
| `PackageRef` | `name`, `version` | UTF-8 | a package name and a version requirement |
| `PackageExport` | `name` | UTF-8 | a name |
| `ConsoleTrace` | `console` | raw | whatever a service wrote to its console |
| `GenesisActionData` | `memo` | UTF-8 | human text |
| `LogMessage` | `message` | UTF-8 | human text; raw if a service must be able to log bytes it did not check (today the node writes it to its log unchecked) |

Where the recommendation is UTF-8, a value that is not UTF-8 is refused by
every reader and writer from the flip on; today nothing checks. The cases
where that could reject something a node accepts now are the two marked
with an alternative (`HttpRequest::method`, `LogMessage::message`).

### 6.19 Slice R4: the service macro declares a PSIO interface (additive)

**What is generated.** With `#[psibase::service(psio = true)]` the service
module gains, beside everything it had,

```rust
#[psio::interface(name = "<the service's account>", module = "psio_actions", crate = "psibase::psio")]
pub trait PsioActions {
    fn setCode(service: AccountNumber, vmType: u8, vmVersion: u8, code: Hex<Vec<u8>>);
    // ... one function per #[action], with its documentation
}
```

and so, from PSIO's own attribute and nothing of psibase's: `psio_actions::Tag`
(`psio::interface::Interface`: the name, the methods with their parameter
names, the Schema IR `Interface` / `Func` through
`SchemaBuilder::insert_interface`), `psio_actions::args::<action>` (the
argument record: `Method`, `PsszPack`, `PsszUnpack`, `ToPsszSchema`,
`JsonText`; its pSSZ is the tuple of the parameters), `psio_actions::dispatch`
and `psio_actions::Proxy`. Both are re-exported next to `Actions` and
`action_structs`. `psibase` re-exports the `psio` crate for the generated
code (`pub use psio`), as it does `fracpack`. Nothing calls any of it:
`Actions`, `action_structs`, `Wrapper`, the dispatcher and the schema are
what they were, and callers and dispatch still pack fracpack tuples. Files:
`psibase-macros-lib/src/service_macro/{mod,actions}.rs`.

**Why it is an option and not unconditional.** A derive cannot ask whether
a type implements a trait, and `#[psio::interface]` needs every parameter
type to be `PsszPack + PsszUnpack + ToPsszSchema + JsonText` and every
result type the first three. Until every type a service names is declared
(time, the variants of D39, the service records of R5), turning it on
everywhere does not compile. `psio = true` is therefore the statement "all
of this service's types are PSIO values"; at the flip it becomes
unconditional and the option is deleted. Two more conditions come from
PSIO's attribute: parameter and result types are named as the service
module sees them, not through `super::` or `self::` (several Rust views
write `super::Record` in a result today), and a parameter is an owned
value.

**Turned on for three services:** `setcode` and `auth-delg` (the Rust views
of C++ services, `rust/psibase/src/services`) and `minrecvr`
(`rust/test_psibase_macros/services/min-call-recvr`, a service built to
wasm and run in `rs-test-psibase-macros`, which proves the
`psibase::psio` path from a crate that does not name `psio`). For them
`Claim` and `ServiceMethod` gained `psio::JsonText` and `NewAccountMode`
its PSIO declaration (`transparent` over `u8`, D40).

**The cross-check** (`psio_twins.rs`, `rust_and_cpp_declare_the_same_services`;
C++ side in `rust_twins.cpp`). C++ declares the two services as
interfaces in the test (`PSIO_INTERFACE(SetCode, types(), name("setcode"))`
over the methods `PSIO_REFLECT` lists: the form D18 prefers) and writes
their `Interface` nodes into the fixture's Schema IR, and the pSSZ of the
arguments of 18 sample calls packed as psibase packs them
(`psibase::MethodArgs<M>`, the tuple of the parameters). Rust requires,
for `setcode` (9 functions) and `auth-delg` (9): the same set of function
names; for each function the same parameter names in order, the same
parameter and result types with every reference resolved, the same
attributes; the method metadata (`Tag::METHODS`) agreeing with the schema;
and each call's bytes accepted by `validate_pssz`, decoded as the argument
record and as its tuple, and written back identical. Both interfaces
differ from C++ only in `char` (D41: `code`, a claim's `rawData`), and the
test requires that difference to be present. Not compared: the order of
the functions (the Rust views list them in another order; an action is
found by number).

**What it found.** `AuthDelegate::getOwner` and `checkOwner`: C++ declares
the parameter `account` and reflects it as `owner`
(`method(getOwner, owner)`), so its JSON name is `owner`; the Rust view
said `account`. The Rust view now says `owner`, because the reflected name
is what clients send today; whether the C++ reflection is the mistake is
D42. Seen by reading and not yet under the check: `Accounts` (Rust `num`
where C++ reflects `name`), `Nft` (`debitor` where C++ says `receiver`).
The Rust views restate C++ interfaces by hand and nothing compared them;
with `psio = true` and a line in the fixture each one is compared.

**Two actions with one method number are a compile error now**, for every
service, with or without `psio` ("actions `a` and `b` have the same method
number; rename one of them"); C++ has refused them since slice 4a (D23).
No service in the tree is affected (the full build passes). The check uses
psibase's own coder, handed to the macro library by the proc-macro crate
(`psibase_names::method_number_from_str`), so no lock file changes. Where
it switches to `psio::compress_name::method_to_number` once RG12 is fixed
is marked at `check_method_number` in `service_macro/actions.rs`; `method_raw!`
(`number_macro.rs`) and `MethodNumber` switch in the same commit.

**Not done in R4, and why.**

* Events (`#[event(history | merkle)]`): the same trait could be generated
  for them, but the name of an events interface and its C++ counterpart
  (the `Svc_EventsHistory` structs) are not decided (D43).
* Callers and emitters building the action record instead of a tuple, and
  `service_tables` emitting `psio::Key` bounds: both change code that runs,
  for no difference before the flip; left to R7 with the switch itself.
* The interface's name is the service's account (`"setcode"`), which both
  languages know; the C++ default would be the class name (D43).
* No argument caps or parameter bounds are declared (the size audit awaits
  the owner). `#[psio(max = ...)]` on an action parameter would reach the
  generated trait, but the action function itself would then carry an
  attribute rustc does not know; the macro must strip it there when the
  first bound is declared.

### 6.20 Slice R5: service declarations (started: the Rust views in `rust/psibase`)

**Done: `rust/psibase/src/services`.** Of the 37 types there that derive
`Pack` (found by parsing the derive lists; `Decimal` has no legacy codec
and was declared in R2), 30 are declared with PSIO now: 3 from the earlier
slices (`Precision`, `Quantity`, `NewAccountMode`) and 27 added here, each
with `PsszPack, PsszUnpack, ToPsszSchema`, `PsszView` for a record with
named members, `Key` where it derives `ToKey`, and `#[psio(transparent)]`
for a struct of one unnamed member (which is what the legacy derive makes
of it):

| File | Types |
|---|---|
| `auth_dyn.rs` | `WeightedAuthorizer`, `DynamicAuthPolicy` |
| `dyn_ld.rs` | `DynDep` |
| `events.rs` | `EventDb` (transparent) |
| `invite.rs` | `InviteRecord`, `InvPayload` |
| `nft.rs` | `Nft`, `NftHolderRecord`, `CreditRecord` |
| `packages.rs` | `PackageSource`, `InstalledPackage` |
| `producers.rs` | `CandidateInfo` |
| `sites.rs` | `SitesContentRow`, `SiteConfigRow`, `SitesDataRow`, `SitesDataRefRow` |
| `staged_tx.rs` | `ActionList` |
| `symbol.rs` | `SymbolRecord`, `Mapping` |
| `tokens/mod.rs` | `TokenRecord`, `Holder`, `SharedBalance`, `Balance` |
| `virtual_server.rs` | `ServerSpecs`, `NetworkVariables`, `BufferConfig` |
| `ws_auth.rs` | `WsTicketInfo` |

How: the derives were added to every type and removed again from each one
the compiler refused, so "every member type is already convertible" was
decided by the compiler, not by reading.

**Waiting in that directory (7).**

| Type | Why |
|---|---|
| `diff_adjust::RateLimit`, `staged_tx::StagedTx`, `token_stream::Stream` | a time member (D34) |
| `accounts::Account` | `#[serde(deserialize_with)]`, which PSIO's schema derive refuses (R8) |
| `packages::InstalledSchema` | holds the legacy `Schema` (R7) |
| `auth_sig::SubjectPublicKeyInfo`, `auth_sig::AuthRecord` | the key type waits for its C++ twin (D26); it would compile as `transparent` over its bytes, which is the form D26 leans to |

**What this does not show.** These 27 are not in the C++ ↔ Rust fixture:
they compile and nothing has compared them with their C++ twins (member
names and order, raw or UTF-8 strings, `char`). 6.17 and 6.19 found a
wrong mirror in each small sample taken, so expect some here; each joins
the fixture with one line in `rust_twins.cpp` and one in `psio_twins.rs`.
No service was switched to `psio = true` in this step either: most of the
views name a waiting type or write a result type as `super::Record`.

**Not started: `packages/system` and `packages/user`** (the Rust services
themselves and their query services; plugins belong to R7). Nothing
blocks them that does not block the views above; what they need first is
mechanical: `psio.workspace = true` in each service crate's manifest (the
derives name `::psio`), `psio` in the `[workspace.dependencies]` of
`packages/system/Cargo.toml` and `packages/user/Cargo.toml`, and the lock
files that follow. The same add-and-let-the-compiler-refuse pass
(`~/psibase-pssz-scripts/r5.py`, `r5_loop.py`; scratch tools, not in the
tree) then applies per workspace with `--target wasm32-wasip1`, including
the six packages the build never compiles. Expected to wait there, from
the survey of 6.1: every row and action with a time point (`TimePointSec`
/ `TimePointUSec`: 141 uses in 37 files), the 25 `ToKey` records only
where a member waits, and whatever holds `SubjectPublicKeyInfo`.

### 6.22 Names: declarations, reflections and mirrors (the owner's naming rule)

The rule (owner): for each type or service one language is the authority,
the one it was written in — the node, the native tables and the services
implemented in C++ → C++; a service implemented in Rust → Rust (its C++
header and its view in `rust/psibase/src/services` are mirrors). Mirrors
rename their structs, members, variants and parameters to match; a rename
annotation is for an externally imposed name only; where a declared name
and its reflected name disagree, the declaration changes so both agree.
Casing is a language convention and is not bridged per member (see the end
of this section for where it is bridged today).

**C++: reflected name against declared name** (commit `c663d0f45`).
Scripted (`~/psibase-pssz-scripts/reflect_check.py`, log
`~/psibase-pssz-build.reflect-names.log`): every `PSIO_REFLECT`,
`PSIBASE_REFLECT_*_EVENTS` and `PSIO1_REFLECT` site of the tree outside
`external/` and `libraries/psio1` (593 files, 601 sites, 581 `method(...)`
items, 1,169 data-member items) is parsed, the struct body it names is
located and its member functions and data members are parsed, and the two
are compared; 309 out-of-class definitions are compared with the
reflection as well. Found: 24 methods whose declared parameter names
differ from the reflected ones, 10 whose number of names differs from the
number of parameters, no reflected data member under another name.

Renamed, declaration to reflection (what clients and the generated schemas
already say; all 68 schemas byte-identical after it):

| Method | Declared → reflected |
|---|---|
| `AuthDelegate::getOwner`, `checkOwner` | `account` → `owner` (D42) |
| `serveSys` of `XHttp`, `XProxy`, `RDynLd`, `AsyncQueryService`, `SocketListService`; `XBasic::checkAuth` | `req` → `request` |
| `XPeers::serveSys` | `user` → `socket` (it is the socket) |
| `XHttp::giveSocket` | `account` → `service` |
| `XTransact::addCallback`, `removeCallback` | `callback` → `action` |
| `Transact::addCallback`, `removeCallback` | `act` → `action` |
| `Transact::execTrx`, `RTransact::preverify` | `trx` → `transaction` |
| `Producers::setProducers` | `prods` → `producers` |
| `EventQueryInterface::sqlQuery`, `REvents::sqlQuery` | `squery` → `query` |
| `TestMemo::testJson`, `testConstruct` | `data` → `memo` |
| unnamed in the declaration: `EmitEvents::emitMerkle` (`s`), `GetUser::serveSys` (`socket`), `REvents::serveSys` (`request`), `Ledger::transfer` in `methods.cpp` (`amount`) | named |
| `XHttp::accept` | the reflection listed two names (`callback`, `err`) for parameters the method does not have; removed (the schema never showed them) |

Out-of-class definitions were renamed with their declaration where the new
name was free in the body; 19 definitions keep another spelling than the
declaration (an unnamed unused parameter, or a body that already uses the
name: `Producers::setProducers`, `RTransact::preverify` / `recv`,
`Transact::checkFirstAuth`, `HttpServer::sendReply` / `serve`,
`XHttp::sendReply`, `Db::open`, `XDb::open`, `Invite::createAccount`, the
`AuthNone` methods, `NotifyService::onTrx`, `RSetCode::serveSys`).

Left for the team, because correcting them changes a generated schema or
the JSON of an action's arguments:

| Where | What | Reading |
|---|---|---|
| `AuthDelegate::getOwner(owner)` | the parameter is the account whose owner is returned ("Returns the owner of `account`"); `owner` is the reflected and now the declared name | the reflected name looks like the mistake; correcting it changes `AuthDelegate-schema.json` |
| `Packages::setSchema(schema)` reflected `method(setSchema, account, schema)` | the one parameter is called `account` in the schema and in JSON | a stale reflection; should be `method(setSchema, schema)` |
| `Packages::getSchema(service)` reflected `method(getSchema)` | the parameter has no name (`c0` in the schema) | should be `method(getSchema, service)` |
| `XAdmin::isAdmin(account, socket, forwardedFor)` | third name missing (`c2`) | add `forwardedFor` |
| `XPackages::serveSys(request, socket)`, `Explorer::serveSys(request, socket, user)`, `REvents::serveSys(request, socket, user)` | only `request` is named | add the names |
| `AuthInterface::getDlgsSys(sender, method)` | `method` not named | add it |
| `TestExport::doExport(initialValue, subjective)` | `subjective` not named | add it (a test service) |
| `Events` test `TestService::sendAccount(account)` reflected `a` | the declared name is the better one | change the reflection (a test service) |
| `XAdmin::serveSys`, `checkAuth`, `RSetCode::serveSys`, `GetUser`, `CookieProbe` reflect `req` where every other service says `request` | consistent with their declarations, not with each other | rename both at a flip |

**Members a struct has and its reflection does not list** (17 found; the
owner's rule: an omission may be deliberate — working state, a cache).

| Member | Evidence | Reading | Done |
|---|---|---|---|
| `SystemService::CodeRefCountRow::numRefs` | incremented and decremented and then `put`; never stored, so every read saw 0 | a bug | reflected (`556ae9fb5`); test added; `SetCode-schema.json` and `XAdmin-schema.json` change |
| staged-tx `Response::seq` (C++ mirror) | the Rust service, the authority, stores `id, account, seq, accepted` | the mirror was wrong | reflected (`a92a404d1`); in the fixture; no schema changes |
| `SiteConfig::proxy` (`Sites.cpp`, a query result) | `getConfig` fills it; added with the proxy actions | forgotten | reflected (`a4fa77740`); query output only; untested |
| `WasmConfigRow::maxHandles` | read by the node; the row is written from `BlockHeaderWasmConfig`, which does not carry it; the Rust twin has no such member | deliberate (a node-side constant) | comment (`8adac6a0e`) |
| `GQLUrl::refcount` (`XPeers.cpp`) | read by `connected()`, which is reflected | deliberate (working state) | comment |
| zip records: `LocalFileHeader::{filename, extra}`, `FileHeader::{filename, extra, comment}`, `ExtraHeader::data`, `Zip64EndOfCentralDirectoryRecord::{versionMadeBy, versionNeededToExtract, extData}`, `EndOfCentralDirectoryRecord::comment` | `zip.cpp` reads the reflected fixed part with `readStruct` and the variable parts by hand | deliberate | none |
| `PsinodeConfig::{tls, http_timeout}` | listed in the reflection, `tls` under `#ifdef PSIBASE_ENABLE_SSL` | not omissions (the script does not read the preprocessor) | none |

Seen with `numRefs` and left: `SetCode::setCodeStaged` returns early when
the account already runs the staged code, after removing the staged row
and without dropping the reference that row held.

**Interfaces by name, three ways** (`~/psibase-pssz-scripts/iface_names.py`,
log `~/psibase-pssz-build.iface-names.log`): the methods and parameter
names of the 76 C++ classes that state a `service` account, the 49 Rust
views and the 37 Rust service implementations, compared per account.
60 parameter-name differences. **Not corrected yet** (the priority moved
to the wire flip); the list for whoever does:

| Account | Authority | Mirror differs |
|---|---|---|
| `accounts` | C++ | view: `exists`, `getAccount`, `incAuthSeq` say `num` for `name` |
| `cpu-limit` | C++ | view: `setCpuLimit(limit)` for `limit_ns` |
| `producers` | C++ | view: `setConsensus(prods)` for `consensus`, `setMaxProds(max_prods)` for `maxProds`, `setProducers(prods)` for `producers` |
| `transact` | C++ | view: `addCallback` / `removeCallback` `(type_, objective, act)` for `(type, objective, action)`; `execTrx(trx, ..)` for `transaction` |
| `x-http` | C++ | view: `giveSocket(socket, account, local)` for `service`; `serveSys(req, ..)` for `request` |
| `x-admin`, `x-packages`, `packages` | C++ | the view names a parameter the C++ reflection leaves unnamed or misnames (the table above) |
| `nft` | Rust | C++ header: `credit`, `transfer` say `receiver` for `debitor`; view: `nftId` for `nft_id` |
| `symbol` | Rust | C++ header: `newSymbol` for `symbol`, `numChars` for `length` |
| `tokens` | Rust | C++ header: `getBalance(tokenId, account)` for `user`; `setBalConf` / `setTokenConf` / `setUserConf` say `enable` for `enabled`; 25 methods differ in casing only (`tokenId` / `token_id`, `subAccount` / `sub_account`, `maxIssuedSupply` / `max_issued_supply`) |
| `auth-dyn`, `auth-rcovr`, `credential`, `vserver` | — | the Rust implementation names an unused parameter `_flags`, `_sender`, `_socket`, …; the service macro copies the name, so that is the parameter's JSON name. The interface they implement says `flags`, `sender`, `socket` |
| type names | Rust | `nft`: `NftHolder` (C++ and view `NftHolderRecord`), `Nft` (C++ `NftRecord`: `Nft` is the service class there); `tokens`: `Token` (C++ and view `TokenRecord`), `UserConfig` (view `Holder`), `InitRow` (C++ `TokensInitRecord`); view `SharedBalance` lacks the first member, `shared_bal_id`; `symbol`: `Symbol` (C++ and view `SymbolRecord`), `SymbolLength` (C++ `SymbolLengthRecord`) |

**Casing today.** There is no crate-level casing rule. `rust/psibase`
spells the members of the records it mirrors from C++ as C++ does
(`rawData`, `vmType`; `#![allow(non_snake_case)]` in `block.rs`, `http.rs`,
`native_tables.rs`, `services/accounts.rs`), and the Rust services spell
their own snake_case, which their C++ mirror headers copy for members
(`nft_id`) and do not copy for parameters (`tokenId`). The service macro
copies parameter names as written. `#[serde(rename_all = "camelCase")]` is
on 65 types in 24 files: `rust/psibase` 4 files, `VirtualServer` service 2,
`Tokens`, `SingleProd`, `Registry`, `Favor` services 1 each, and 14 plugin
crates. Per-member renames (`#[serde(rename = ..)]`, `#[graphql(name =
..)]`): 21 in 14 files — `Nft` query service 4, the two schema files 3
each, `Producers` plugin 2, and one each in `native_tables.rs`
(`NotifyRow::type`), `cargo-psibase`, the `TokenSwap`, `Symbol`,
`SingleProd`, `Fractals` services, the `TokenSwap` and `StagedTx` plugins
and two test crates. The owner's decision: keep it as it is for now; a
team discussion.

### 6.23 Pin moved to PSIO `b5cea0d4`; one method-name coder; `Memo` bounded

**Pin** (commit `ab0076b85`): `b5cea0d44613740f75fd5c3a428e406908ea9afc`,
PSIO's consistency round. No psibase source changed for it; the tree
built as it was.

**Method numbers.** psibase C++ has taken its method numbers from PSIO
since slice 1 (`psibase::MethodNumber` is `psio::detail::method_to_number`:
call proxies, dispatch, schemas); the legacy library's own copy of the
coder served only its GraphQL method lookup and its macro. PSIO now gives
a compressed number only to a name that decodes back to it and hashes
every other (RG12 closed). With the pin, and with Rust moved onto
`psio::compress_name` in the same step, every language has one coder:

| | Before | Now |
|---|---|---|
| C++ `MethodNumber` | PSIO's (cut-off codes) | PSIO's |
| C++ `psio1::hash_name` | the legacy copy | forwards to PSIO's (temporary, in `psio1/get_type_name.hpp`) |
| Rust `MethodNumber`, `method!`, `method_raw!`, the service macro | `rust/psibase_names` (hashed five of the eight) | `psio::compress_name`; the method half of `psibase_names` is deleted (5 files); the crate keeps the account-name coder |
| Python `name.py` | a third implementation (dropped `_`, no decode-back rule) | follows PSIO's rule; `test_name.py` pins 15 vectors |

Numbers that changed (old → new):

| Name | Old | New |
|---|---|---|
| `checkFirstAuth` | `0x02865743c9374c7c` | `0xcd29c38cde224f8e` |
| `cpu_min_unit` | `0x0e7af790922c457d` | `0x13fb233a1d98cbd8` |
| `frozenAccounts` | `0xda8039f811aaaad5` | `0x27303f52c1c094da` |
| `get_resources` | `0xb2a0545cdfc9f9c0` | `0xd5137f98107c0181` |
| `getSymbolType` | `0x7ea96086faa7f7c0` | `0xd55df3070b8758eb` |
| `regEvIdx` | `0x0040b0a625283b52` | `0x413db64868a8ec0f` |
| `removeCallback` | `0x8a0905b7cb153252` | `0x978d530fdfe275cb` |
| `rowsBySecondary` | `0xf0817995f79ba054` | `0x83a92f4d480665a6` |
| `create_request` (Rust) | `0xfc7b80faf272bd7a` | `0xf997f22d796b5e2b` |
| `set_paid_occ` (Rust) | `0x6471b2808a8eb95b` | `0x15d82d05366fa15c` |

(The C++ column of the first eight is what C++ sent; Rust already sent the
new number for `checkFirstAuth`, `cpu_min_unit`, `get_resources`,
`getSymbolType`, `removeCallback`.) What pinned them: nothing in the tree
held an old number. One spelling did: a hashed name is the hash of its
bytes, so its case matters, and `packages/user/Events/src/postinstall.json`
called `regevidx`; it says `regEvIdx` now (without it the chain does not
boot: "Missing action transact::#aualyrdoumydndpe"). `Transact-schema.json`
changes in the order of its actions only.

**`Memo` in C++** is `PSIO_REFLECT(Memo, transparent(), attr(contents,
utf8 | max<maxBytes>))`: the bounded UTF-8 string Rust already declared
(D37 closed; the fixture compares the two like any other type now, and
the pinned-difference test is gone). A record that holds a memo can have
a narrower offset in pSSZ than one that holds a string. The legacy
library has no bounded types: `psio1/canonical_bounded.hpp` (temporary)
checks the bound of such a transparent type where the legacy library
validates, with the messages `Memo` always had ("Memo exceeds 80 bytes",
"Memo must be valid UTF-8"); legacy bytes are unchanged (`test_memo.cpp`
and the pinned forms pass as they were).

### 6.24 Rust readiness for the wire flip (the owner's priority: old library out, then refine)

Order changed by the owner: reach a tree without the legacy library
quickly; polish later. What was done towards it in Rust, in order.

**Variants** (`243197cf0`). `ConsensusData`'s alternatives are
`CftConsensus` and `BftConsensus`, the C++ type names (C++ is the
authority; D39). serde wrote `{"CFT": ...}` before, which no C++ reader
accepts. The other four Rust enums on the wire already named their
alternatives after the types. Variant *labels* in the Schema IR still
differ between the languages (C++ `"0"`, `"1"` with `ijsonName`; Rust the
identifier): a PSIO question; schemas of the two languages are to be
compared on the wire shape until it is settled, and psibase adds no
per-type label annotation.

**Time is `psio::time`** (`11b964218`). `TimePointSec`, `TimePointUSec`,
`Seconds`, `MicroSeconds` are aliases of `psio::time::TimePoint<Seconds |
Micros>` and `psio::time::Duration<..>`; psibase's four structs are
deleted. The use sites (60 files) call PSIO directly: `.ticks()`,
`from_ticks(n)`, `floor::<Seconds>()`, `ceil`, `to_unit().unwrap()`,
`from_chrono_floor`. Temporary, deleted with the legacy crate:
`rust/fracpack/src/psio_time.rs` gives the four types the legacy `Pack /
Unpack / ToSchema` with the bytes and legacy schema nodes the structs had
(a test redeclares the old structs and compares); `ToKey` is in
`rust/psibase` with the same key bytes. Changes a client sees (approved):

| | Before | Now |
|---|---|---|
| `TimePointSec` in JSON | `"2026-11-22T10:15:30+00:00"` | `"2026-11-22T10:15:30Z"` |
| `TimePointUSec` | `"…30.123456+00:00"`, no fraction when zero | `"…30.123456Z"`, always six digits |
| a duration | `{"value":5}` | `5` (a string beyond 2^53) |
| a fraction finer than the unit | dropped | rejected |
| GraphQL scalars | `TimePointSec`, `TimePointUSec` | `DateTimeSeconds`, `DateTimeMicroseconds`; durations `Seconds`, `Microseconds` |

Readers accept `Z`, an offset, and extra zero digits, so what C++ writes
and what Rust wrote before both parse. `floor` rounds toward negative
infinity where the old `.seconds()` truncated (differs before 1970 only).
RG16 (PSIO, convenience): no arithmetic or infallible conversion across
units — `TimePoint<Micros> + Duration<Seconds>` does not compile and
`Duration<Seconds>` has no `Into<Duration<Micros>>`; 20 call sites write
`to_unit().unwrap()`.

**Every packed type declared** (`b5af09d5a`, `1b213b1c3`). The
add-and-let-the-compiler-refuse pass over all four workspaces:

| Workspace | Types that gained the PSIO derives | Refused |
|---|---|---|
| `rust/psibase` | 36 more (consensus records, `SignedTransaction`, `BlockHeader`, `Block`, `SignedBlock`, `BlockInfo`, `StatusRow`, the socket records and variants, `SubjectPublicKeyInfo` as `transparent`, `AuthRecord`, `Tapos`, `Transaction`, `RunRow`, …) | `package::Meta`, `accounts::Account`, `ActionTrace` (a serde attribute PSIO's schema derive refuses: `default`, `deserialize_with`) and with it `InnerTrace`, `InnerTraceEnum`, `TransactionTrace`; the legacy schema records `Schema`, `EventType`, `FieldId`, `TableInfo`, `InstalledSchema` |
| `packages/system`, `packages/user`, plugins | 158 types in 39 files; 100 manifests gained `psio.workspace = true` | Permissions plugin `PackablePromptContext`, `Permission`, `Permissions` (they hold `TrustLevel`, a wit-bindgen type with a hand-written codec) |

All workspaces compile with them (`cargo check --workspace --target
wasm32-wasip1`; the six packages the build never compiles included; five
plugin crates that need a generated `bindings.rs` do not compile under
`cargo check`, before and after).

**Names** (the owner's rule applied to parameters). Rust actions no
longer expose a leading underscore as the JSON name of an unused
parameter: 20 actions in 15 services (`auth-dyn`, `auth-rcovr`,
`credential` `checkAuthSys` / `getDlgsSys` / `isAuthSys` / `isRejectSys`;
`serveSys(.., socket, user)` of eight services; `verifySys`,
`role_policy`, `is_role_ok`, `on_attest`, `on_ev_unreg`) say `flags`,
`sender`, `socket`, … with `#[allow(unused_variables)]`. The C++ mirror
headers of `nft`, `symbol`, `tokens` take the Rust names (`4c3d12af3`, 42
parameters). The Rust views take the authority's names (19 parameters:
`accounts` `name`, `producers` `consensus` / `producers` / `maxProds`,
`transact` `transaction` / `action`, `x-http` `service` / `request`,
`cpu-limit` `limit_ns`, `nft` `nft_id`, …); the view's `SharedBalance`
has `shared_bal_id`. A cross-check fails on any mismatch now: C++ writes
the methods and parameter names of 28 services into the fixture
(`"names"`), and `psio_twins.rs`
(`rust_views_name_parameters_as_the_implementation_does`) compares each
with the view's generated schema: 265 methods. Listed exceptions, each
pinned so that it fails when it is gone: `transact::addCallback` /
`removeCallback` (`type` is a Rust keyword; the view says `type_`), and
the four C++ reflections of 6.22 (`packages::setSchema` / `getSchema`,
`x-admin::isAdmin`, `x-packages::serveSys`). Not in it: `brotli-svc`,
`chainmail`, `subgroups` (their C++ headers are not on the test target's
include path), services without a C++ header, type names, and the Rust
view against the Rust implementation directly (the script of 6.22 does
that; a test would have to live in each service crate).

**String kinds** (raw or UTF-8, D35 decided by the owner: fix the
declarations, per the audit `~/psibase-pssz-audit/v2`). The C++ members
and parameters that gain `attr(m, utf8)` (84) were sent to the C++ side
(`~/psibase-pssz-build.cpp-utf8-members.tsv`). The Rust members that
become `psio::pssz::RawString` — `HttpHeader::value`,
`HttpRequest::target`, `LocalEndpoint::path`, `EnvRow::name` / `value`,
`ActionTrace::error`, `TransactionTrace::error`, `ConsoleTrace::console`,
`WsTicketInfo::path`, `SitesContentRow::path`, the `path` parameter of
eight `sites` actions, `r-events::sqlQuery` `params` — can only change
with the wire flip: `RawString` has no legacy codec.

**What is left before and in the Rust wire flip (R7), not done here.**

1. The service macro: `psio = true` as the only mode (the argument
   records, events as interfaces, dispatch with `psio::from_pssz`, callers
   with `psio::to_pssz`), and `service_tables` on `psio::Key`. With every
   type declared, what still blocks "all parameter types qualify" is
   `JsonText` (the PSIO interface asks it of every parameter, and the
   derive pass added the binary and schema derives only) and result types
   written `super::Record`.
2. The runtime of `rust/psibase`: `Pack` / `UnpackOwned` bounds in
   `service.rs`, `native.rs`, `table.rs`, `tester.rs`, `db.rs`
   (41 bounds), 198 `.packed()` and 62 `unpacked(` call sites, `Nested`,
   the three borrowing records.
3. The schema path: `psibase::Schema` (legacy) → the `ServiceSchema`
   record over PSIO's Schema IR that the C++ side defines
   (`~/psibase-flip-cpp/doc/flip-interop.md`, section 2), in `schema.rs`,
   `trace.rs`, `package.rs`, `cargo-psibase`, the tester's schema fetcher.
   This is a contract with the C++ flip and was "proposed" there when read.
4. The remaining refused types above (serde attributes; `TrustLevel`),
   `String` → `RawString` for the members listed, the Rust CLI's
   `LocalPackage::exports`.
5. Deleting `rust/fracpack`, the legacy derives, `rust/test_fracpack*`,
   and `rust/fracpack/src/psio_time.rs` with them.

### 6.25 Handover: the state at the end of this round, for whoever takes the service macro and the Rust wire flip

**State.** Branch `claude/pssz`, not pushed. PSIO pin
`0e6a1b7216a47620b9eafc69c2556b124f3796b0` (the C++ flip branch
`claude/pssz-flip-cpp` in `~/psibase-flip-cpp` uses the same; section
6.23 describes `b5cea0d4`, which was the pin for two steps; what `0e6a1b72`
changed here: `std::vector<char>` and `std::vector<std::uint8_t>` are one
Schema IR node, RG14 closed, so the fixture no longer lists a `char`
difference; RG15 closed). ctest baseline 93. Everything psibase puts on
the wire is still packed by the legacy libraries (`psio1` in C++,
`rust/fracpack` in Rust); nothing in production calls a PSIO codec.

**Milestone 3 (Rust readiness) leaves undone**

1. The service macro is still dual: `psio = true` on three services only
   (`setcode`, `auth-delg`, `minrecvr`); events are not declared as PSIO
   interfaces (naming undecided, D43). To make it the only mode every
   parameter type needs `psio::JsonText` (not derived on the service
   records yet: the derive pass added `PsszPack, PsszUnpack, PsszView,
   ToPsszSchema` and `Key`), result types must be named as the module
   sees them (several views write `super::Record`), and a service whose
   signature names a type of the "refused" list below cannot compile it.
   A first attempt at this step was started and cancelled; nothing of it
   is in the tree.
2. Types still without PSIO derives, and why:
   `package::Meta` (`#[serde(default)]`), `accounts::Account`
   (`#[serde(deserialize_with)]` on `authSequence`), `ActionTrace`
   (`deserialize_with`; its `totalTime` is also an `i64` where C++ has
   `std::chrono::nanoseconds`) and with it `InnerTrace`, `InnerTraceEnum`,
   `TransactionTrace`; the legacy schema records `psibase::Schema`,
   `EventType`, `FieldId`, `TableInfo`, `packages::InstalledSchema` (to be
   replaced by the `ServiceSchema` record over PSIO's Schema IR that the
   C++ side defines); Permissions plugin `PackablePromptContext`,
   `Permission`, `Permissions` (they hold the wit-bindgen `TrustLevel`,
   packed by a hand-written codec in `Permissions/plugin/src/types.rs`).
3. `String` → `psio::pssz::RawString` for the Rust twins of the members
   C++ keeps raw (list in 6.24); the C++ `utf8` list is with the C++ side.
4. Mirror *type* names (6.22, last row of the interface table) and the
   C++ reflections `packages::setSchema` / `getSchema`, `x-admin::isAdmin`,
   `x-packages::serveSys` (with the C++ side).

**The flip checklist** is the numbered list at the end of 6.24; the
contract for everything that crosses the language boundary is
`~/psibase-flip-cpp/doc/flip-interop.md` (read-only from here).

**Pinned exceptions of the parameter-name cross-check** (`psio_twins.rs`,
`rust_views_name_parameters_as_the_implementation_does`; each fails when
it is gone, so remove the entry with the fix): `transact::addCallback`,
`transact::removeCallback` (the view says `type_`: `type` is a Rust
keyword); `packages::setSchema`, `packages::getSchema`,
`x-admin::isAdmin`, `x-packages::serveSys` (C++ reflections to correct).

**Temporary code, and where it goes**

| Where | What | Deleted with |
|---|---|---|
| `rust/fracpack/src/psio_time.rs` (+ `psio` in `rust/fracpack/Cargo.toml`) | legacy `Pack / Unpack / ToSchema` for the four `psio::time` types | `rust/fracpack` |
| `rust/psibase/src/time.rs` | `ToKey` for the same | the legacy key trait |
| `libraries/psio1/include/psio1/canonical_bounded.hpp` and its uses in `fracpack.hpp`, `from_json.hpp` | the bound of a `transparent()` type with an annotated member (`Memo`), checked where the legacy library validates | `psio1` |
| `libraries/psio1/include/psio1/get_type_name.hpp` (`hash_name`, `is_compressed_name`) | forward to PSIO's method coder | `psio1` |
| the `"frac"` member of `rust-twins.json` and `same_legacy_bytes` in `psio_twins.rs` | legacy bytes of each twin | the legacy libraries |

**How to verify** (scratch tools in `~/psibase-pssz-scripts`, not in the
tree; build directory `~/psibase-pssz-build`, wasmtime backend, Node 22 on
`PATH`: `/opt/homebrew/opt/node@22/bin`).

* Everything: `~/psibase-pssz-scripts/step.sh <tag>` = full build
  (`cmake --build … -j 6`), `ctest -j4`, `cargo check` of the six
  packages the build never compiles
  (`~/psibase-pssz-scratch-r/check-unbuilt.sh`), and the generated
  `*-schema.json` (68) against a snapshot. Logs:
  `~/psibase-pssz-build.{build,ctest,compare}-<tag>.log`,
  `…<tag>-check-unbuilt.log`, one-line result
  `~/psibase-pssz-build.step-<tag>.log`.
* Schema snapshots (`snap.sh make | compare <dir>`):
  `~/psibase-pssz-snap-head` (before this round),
  `~/psibase-pssz-snap-omissions` (after `numRefs`: `SetCode`, `XAdmin`
  changed), `~/psibase-pssz-snap-d` (current baseline: `Transact` also
  changed, in the order of its actions).
* The C++ ↔ Rust fixture: `libraries/psibase/common/tests/rust-twins.json`
  is written by `~/psibase-pssz-build/psibase-psio-tests '[twins]'` with
  `PSIBASE_WRITE_RUST_TWINS=1` and read by
  `cargo test -r -p psibase --test psio_twins` in `rust/` (3 tests: types
  — 51 types, schema node, pSSZ, key, text, legacy bytes; the interfaces
  of `setcode` and `auth-delg` with 18 calls; parameter names of 28
  services, 265 methods). A change of either side's declaration or of
  the pin makes the native test fail until the fixture is regenerated
  and the Rust test passes.
* Rust, outside ctest: `cargo check --workspace` in `rust/` needs
  `PSIBASE_BOOST_INCLUDE_DIR=/opt/homebrew/include` (for
  `test_fracpack`'s build script); `packages/system` and `packages/`:
  `cargo check --workspace --target wasm32-wasip1`; `packages/user`: the
  same with `CC_wasm32_wasip1=/Users/dlarimer/psibase/build/wasi-sdk-prefix/src/wasi-sdk/bin/clang`
  and `--keep-going`. Five plugin crates fail there on a generated
  `bindings.rs` (`btcbridge-plugin`, `btcrelay-plugin`, `ethbridge-plugin`,
  `exchange-plugin`, `favor-plugin-legacy`), before and after any change.
  The `verify_schema` unit tests of `rust/psibase` need CMake's
  environment: run them through `ctest -R '^rs-tests$'`.
* Names: `~/psibase-pssz-scripts/reflect_check.py` (C++ reflection
  against declaration, 6.22) and `iface_names.py` (C++ / Rust view / Rust
  implementation by account).

**Slow or fragile steps.** The machine is shared: a full build after a
header of `libraries/psibase` changes takes 10–25 minutes at `-j 6` and
`ctest -j4` 10–40 minutes depending on load. `psinode_test_crash` failed
intermittently on one earlier pin (1.14; the storage engine at restart,
"reference count exceeded limits"); it passed in every run of this round.
A hashed method name is the hash of its exact bytes: a `method` string in
a hand-written `postinstall.json` must be spelled as declared (6.23).
`cargo` in a tree that was never configured cannot find
`external/psio/rust/psio`; after a pin move run `cmake ~/psibase-pssz-build`
once (it checks the checkout against the pin).

**What was checked in this round**

| Step | Tag | ctest | Schemas |
|---|---|---|---|
| Declared = reflected parameter names | `names` | 93 / 93 | identical to `snap-head` |
| `numRefs`, `Response.seq`, `SiteConfig.proxy`, comments | `omissions` | 93 / 93 | `SetCode`, `XAdmin` differ (approved) |
| Pin `b5cea0d4`, one method coder, `Memo` bounded | `d2` | 93 / 93 (first run, `d`: 37 / 93 until `regevidx` was respelled) | `Transact` differs in order (approved) |
| Variants, time, derive passes, names, cross-check | `twins` | 93 / 93 | identical to `snap-d` |
| Pin `0e6a1b72` | `repin-0e6a` | 92 / 93: the fixture-is-current test, as expected; fixture regenerated, native and Rust PSIO tests pass; the full suite was not run again | identical to `snap-d` |

The six unbuilt packages checked (exit 0) in every row. Not verified: the
C++ mirror header renames of `nft` / `symbol` / `tokens` are compiled by
the build and by the fixture test but no test calls those actions by
named JSON arguments; `SiteConfig.proxy` has no test; the JSON and
GraphQL changes of the time types are covered by unit tests in
`rust/psibase/src/time.rs` only, no UI or plugin was exercised.

### 6.26 The Rust flip, stage by stage (handover; newest state first)

Stages R-A … R-F as the coordinator defined them. Scratch tools:
`~/psibase-pssz-scripts/rflip/` (`add_jsontext.py`, `add_psio_all.py`,
`flip.py`, `clean_imports.py`); logs `~/psibase-pssz-build.*rflip*.log`.

**HANDOVER: the state after the sweep R-B + R-C + R-D (+ the Rust part
of R-F).** Branch `claude/pssz`, not pushed, PSIO pin `e12e4f6d`. Every
byte Rust writes or reads is PSIO's: there is no `rust/fracpack`, no
legacy derive, no `ToKey`. The C++ of this tree is still on the legacy
wire, so the two halves of this tree do not talk to each other until the
C++ flip branch (`claude/pssz-flip-cpp`) is merged. Not started: R-E.

*What the sweep did.*

* **Wire.** `x.packed()` → `psio::to_pssz(&x)` (202 sites), `T::unpacked(b)`
  → `psio::from_pssz::<T>(b)` (62), legacy derive names, `#[fracpack]` and
  `#[to_key]` removed from every derive list; generic bounds are
  `PsszPack<Pssz> + PsszUnpack<Pssz>` (`psio::from_pssz` asks both).
  `SignedTransaction::transaction` is `psio::pssz::Nested<Transaction>`
  (built with `Nested::new(&trx)`, read with `.decode()`, `.bytes()` for
  the digest); `transact::execTrx` takes the same. The borrowing records
  `SharedAction`, `SharedGenesisActionData`, `SharedGenesisService` are
  gone: a writer packs the owned record, the dispatcher reads a view.
* **Service macro.** Callers pack the action's argument record
  (`psio_actions::args::<action>`; the bytes of the tuple of the
  parameters) and `Caller::call` takes `Args: psio::interface::Method`.
  Dispatch gets `psio::PsszView<Action>` (validated), compares the method
  number and decodes the arguments with `psio::from_pssz` (validated).
  Events pack their argument record. What `#[psio::interface]` expands
  to is named after the service (`psio_actions__<service>`, trait
  `PsioActions__<service>`) and re-exported as real modules
  `psio_actions`, `psio_history_events`, `psio_merkle_events` and
  `action_structs` (`= psio_actions::args`, the name service code always
  used): a service module that glob-imports another service's module
  would otherwise have two macro-expanded items of one name (E0659).
  `X::ACTION_NAME` is `<X as psio::interface::Method>::NAME`.
* **Trust: one switch.** `rust/psibase/src/table.rs` `decode_row` is the
  only place a table row is decoded (tables, secondary indexes, the
  GraphQL table queries go through it); it validates, as every read did
  before. To trust a service's own rows, change that function. Nothing
  else in the tree calls a `trusted` entry point.
* **Keys (R-D).** `psio::to_key`, `psio::key::KeyPack` bounds; `to_key.rs`
  holds only `RawKey` and `KeyView`, which implement `KeyPack` (their
  bytes as they stand); `SingletonKey` likewise. `key_prefix` is not used
  yet: prefixes are still built by concatenating `psio::to_key` of the
  parts (same bytes).
* **Schemas (R-C).** `psibase::ServiceSchema`, `TableInfo`, `FieldId`,
  `EventType` (`rust/psibase/src/schema.rs`) are the records of the
  settled specification (`~/psibase-flip-cpp/doc/flip-interop.md` 2,
  commits `4ccdfae3a` / `300521555`): Schema IR members,
  `BTreeMap<String, _>`, `String` everywhere. `SchemaMap` is
  `HashMap<AccountNumber, Arc<ServiceSchema>>`. Lookup by method number:
  `ServiceSchema::action(method)`. Schema-driven JSON is
  `psio::pssz::dynamic`: `schema_handlers()` (AccountNumber,
  MethodNumber), `action_handlers(schemas)` (an `Action` as
  `{sender, service, method, data}` through `CustomHandlers::add_json`,
  a `ServiceMethod` with the declared spelling), `ActionDecoder`
  (traces), `nested_calls` (what the legacy collecting handlers did),
  `action_data_from_json` (postinstall `data`). `Action` and
  `ServiceMethod` are `#[psio(custom = "Action" / "ServiceMethod")]`.
  Schema files are written with `psio::to_ijson`.
* **Raw strings.** `psio::pssz::RawString`: `HttpHeader::value`,
  `HttpRequest::target`, `LocalEndpoint::path`, `EnvRow::name` / `value`,
  `ActionTrace::error`, `TransactionTrace::error`, `ConsoleTrace::console`,
  `WsTicketInfo::path`, `SitesContentRow::path`, the `path` parameter of
  the `sites` actions, `r-events::sqlQuery` `params`. Text is read with
  `.to_str()`; the traces have `error_text()`.
* **Other.** `DbId` has no `NumChainDatabases` and writes camelCase names
  (`service`, `writeOnly`, …: the C++ names). `ActionTrace::total_time`
  is `psio::time::Duration<Nanos>`. The Permissions plugin stores
  `StoredTrustLevel` (a plain `#[repr(u8)]` PSIO enum mirroring the
  wit-bindgen `TrustLevel`). The CLI's `LocalPackage` sends `exports`.
  `SignedTransaction` lost `SimpleObject` / `InputObject` (`Nested<T>` is
  not an async-graphql type; nothing used it as one) — for the team
  review log.
* **Deleted (R-F, Rust workspace).** `rust/fracpack`, `rust/test_fracpack`,
  `rust/test_fracpack_macros`, the derives `Pack`, `Unpack`, `View`,
  `ToKey`, `ToSchema` of `psibase-macros-derive` (four files), the
  legacy halves of the `psio_*` tests; `rs-tests` no longer runs
  `test_fracpack`.

*Temporary items that MUST be removed at the merge with the C++ flip.*

| Where | What | Remove when |
|---|---|---|
| `rust/psibase/tests/psio_twins.rs`, `resolved()` | the custom ids `Action` and `ServiceMethod` are read through on both sides | the C++ of the tree declares them (the flip branch does: `PSIO_INVARIANT` in `block.hpp`, `nativeTables.hpp`); then regenerate the fixture |
| `libraries/psibase/common/tests/rust-twins.json` | still carries a `"frac"` member per value (written by C++, no longer read by Rust) | the C++ side stops writing it |

No `#[action(legacy)]` marker is left, and the macro no longer knows it.

*What the C++ side must provide for the combined tree.*

1. `service/<acct>.json` and `<Target>-schema.json` in the new I-JSON, and
   a reader of it: today a Rust tool refuses every C++-built package
   (`json: missing required member "package" of Schema`) and the C++
   tester refuses every Rust-built one (`Invalid type for variant`).
   This alone accounts for all 64 failing tests below.
2. The custom ids `Action` and `ServiceMethod` (above).
3. `DbId` reflected as an enum with the names `service`, `writeOnly`,
   `native`, `blockLog`, `blockProof`, `prevAuthServices`, `subjective`,
   `nativeSubjective`, `session`, `nativeSession`, `temporary`; then add
   `DbId` to the twin fixture (not done: this tree's C++ has no such
   reflection).
4. `meta.json` with every member (the node tests' writer has `services`
   since R-A).
5. `SignedTransaction.transaction` as `psio::nested<Transaction>`;
   `ActionTrace.totalTime` nanoseconds; traces' `error` / `console` raw.

*For `flip-interop.md` (not yet said there).* Rust reads an `Action`
from JSON as `{sender, service, method, data}` or
`{sender, service, method, rawData}` and writes `data` when the called
service's schema describes the method, else `rawData` (hex); a
`ServiceMethod` is `{service, method}` with the declared spelling. The
interface names of events are provisional (`<service>.history`,
`<service>.merkle`); they only name the argument records in the Schema
IR. A Rust-built schema names an argument list `<interface>.<method>`
where C++ writes `@N` (RG18, fixed on the PSIO line: switch to
`SchemaBuilder::insert_argument_lists` at the next repin; compare with
`equivalent`, not text).

*PSIO gaps recorded in this round.*

| # | Gap | Reproduction |
|---|---|---|
| RG16 | closed at `e12e4f6d`; not yet used: 13 `to_unit().unwrap()` sites become `.into()` | — |
| RG17 | closed at `e12e4f6d` (`CustomHandlers::add_json`); used by `action_handlers` | — |
| RG18 | a `#[psio::interface]` argument record is a named type in the Schema IR (`"<interface>.<method>"`), C++ writes an anonymous `@N`; fixed on the PSIO line, not on the pin | `SchemaBuilder::new().insert::<token::args::transfer>()` → `Type{"token.transfer"}` |
| RG19 | **convenience:** `psio::pssz::RawString` has no text helpers: no `Display`, no `PartialEq<str>` / `PartialEq<&str>`, no `as_str` or lossy access, no `Deref<[u8]>`. psibase writes `x.to_str().unwrap_or_default()` (about 40 sites) and `String::from_utf8_lossy(x.as_bytes())` | `let t = RawString::from("/a"); t == "/a"` and `format!("{t}")` do not compile |

*Verification at this tip (tag `rflip-rb`).*

| Check | Command | Result |
|---|---|---|
| Rust workspace | `cd rust && cargo check --workspace` | clean |
| core tests compile | `cargo check -p psibase -p cargo-psibase -p psibase-macros-lib -p psibase_plugin --all-targets` | clean |
| system packages | `cd packages/system && cargo check --workspace --target wasm32-wasip1 --tests --keep-going` | clean |
| user packages (the six unbuilt included) | `cd packages/user && CC_wasm32_wasip1=/Users/dlarimer/psibase/build/wasi-sdk-prefix/src/wasi-sdk/bin/clang cargo check --workspace --target wasm32-wasip1 --tests --keep-going` | clean except the known ones below |
| plugins | `cd packages && cargo check --workspace --target wasm32-wasip1 --keep-going` | clean |
| wasm test crates | `cd rust && cargo check --target wasm32-wasip1 --tests -p test-contract -p example -p subjective -p test-panic -p psimacrotest -p tpack -p r-tpack -p tpack-admin` | clean |
| XAdmin wasm helper | `cd packages/local/XAdmin/ui/wasm && cargo check --target wasm32-unknown-unknown` | clean |
| EthBridge relayer | `cd packages/user/EthBridge/relayer && cargo check --target aarch64-apple-darwin` | clean (its manifest was broken since the derive pass: `psio.workspace = true` without a workspace) |
| Rust unit tests | `cd rust && cargo test -r --no-fail-fast -p psibase -p cargo-psibase -p psibase-macros-lib -p psibase-macros-derive -p psibase_plugin` | `service_schema` 4 / 4, `psio_twins` 3 / 3, `psio_leaf_types` 13 / 13, `psio_wrappers` 8 / 8, macro-lib 6 / 6, cargo-psibase 8 / 8, psibase lib 60 pass and the 42 `verify_schema` fail (they read the build directory's packages: legacy schema JSON, and need `PSIBASE_DATADIR`) |
| full build | `~/psibase-pssz-scripts/build.sh rflip-rb` | exit 1 at the last step only, `share/psibase/packages/index.json`: the Rust `reserved-names` tool reads the C++-built `AccountsService.psi` and refuses its legacy schema JSON. Everything else built: all Rust services to wasm, all packages, the CLI, the UIs |
| full suite | `~/psibase-pssz-scripts/ctest.sh rflip-rb` | 29 / 93 |

`service_schema.rs` is the test of the specification's sample
(`tests/service-schema-sample.json`, the text of the interop document):
Rust reads it, writes the identical I-JSON and packs it to the same 1336
bytes; the schema the service macro builds for the same declaration is
`equivalent` (`Compare::Contract`; `Compare::Wire` for `getRow`, whose
parameter C++ leaves unnamed); the argument bytes of the typed record,
of the tuple and of the schema-driven codec over the C++ schema are
equal; an `Action` view gives the method and the argument bytes the
dispatcher uses.

*The 64 failing tests, classified.* None is known to be a Rust bug; all
fail before any PSSZ byte crosses between the languages, so the wire
itself is **not exercised** in this tree (that is what the merge will
test first).

| Tests | Count | Message | Class |
|---|---|---|---|
| `rs-test-*`, `rs-subjective-test` (`cargo-psibase test`: the Rust tester loads the default packages) | 28 | `json: missing required member "package" of Schema` (`tester.rs:283`) | needs the C++ flip: schema I-JSON in C++-built packages |
| `psinode_test_*` except `config`, `timer` | 13 | the same, from `psibase boot` / `psibase install` | needs the C++ flip: the same |
| `t-*-test`, `t-psibase-tests` (C++ tester) | 22 | `tester wasm asserted: Invalid type for variant` | needs the C++ flip: the C++ reader of the schema JSON in Rust-built packages |
| `rs-tests` | 1 | 42 × `verify_schema` | needs the C++ flip: schemas of the built packages |

Passing: the native C++ tests, `n-` / `t-psibase-psio-tests`,
`psinode_test_config`, `psinode_test_timer`, the consensus and routing
tests, the Python unit tests (29).

*Not compile-verifiable, and why.* `btcbridge-plugin`, `btcrelay-plugin`,
`ethbridge-plugin`, `exchange-plugin`, `favor-plugin-legacy`: their
`bindings.rs` is generated by the component build, absent under
`cargo check` (before and after; the flip script rewrote their
`.packed()` calls and they have the `psio` dependency, but no compiler
has seen the result). `tokens-plugin` under `--tests`: its two records
derive the codec only with `cfg(not(test))` (as before). The Favor
contract tests need `FAVOR_TEST_SERVICE` / `FAVOR_TEST_QUERY_SERVICE` at
compile time. `package-templates/` (converted by hand) and `demo/` are
not built.

*What is left.*

**R-E, the JSON flip (not started).** 263 types in 63 files derive both
`psio::JsonText` and `serde::Serialize` / `Deserialize`: the serde
derives become `psio::Serde` (the bridge; six types have it already:
`ServiceSchema` and its three records, `ActionTrace`, `accounts::Account`,
and every generated argument record). 159 `#[serde(...)]` attributes to
review (PSIO refuses `default` on a non-optional member,
`deserialize_with`, `deny_unknown_fields`, `tag` / `content`, `flatten`;
`untagged` is honoured at this pin). `Hex<T>` (92 lines in 30 files;
`Checksum256` is `Hex<[u8; 32]>`, 113 lines in 31 files) is deleted and
its uses become `Vec<u8>` / `[u8; N]`; `serialize_as_str!` (5 uses:
`AccountNumber`, `MethodNumber`, `Memo`, `ExactAccountNumber`, …) becomes
`TextForm` + `psio::json_text_form!` + `psio::Serde`; `ExactAccountNumber`
(44 lines) is deleted; `serde_json::to_string(&wire)` /
`from_str::<Wire>` → `psio::to_ijson` / `from_ijson`; the GraphQL scalars
of the replaced wrappers come from `psio`'s `async-graphql` feature
(check that it does not change `serde_json` for dependents). `PrettyAction`
and the package records (`PackageInfo`, `ServiceInfo`, `PackageManifest`)
are serde-only today. `DbId`'s serde derive still writes the Rust names
only because it is serde's (`rename_all = "camelCase"` is in place).

**R-F, the rest.** 13 `to_unit().unwrap()` → `.into()` (RG16);
`from_bin.rs` / `to_bin.rs` (comment says they disappear; 13 uses) — check
for consumers; comments and documentation that still say "fracpack"
(`rust/psibase_macros/**/README.md` and `psibase-macros-derive/src/lib.rs`
docs, `native_raw.rs`, `tester_raw.rs`, `serve_http.rs`,
`rust/.config/hakari.toml`, `StagedTx/service/src/db.rs`,
`Exchange/service/src/math.rs`, two `.wit` files); `rust/psibase_names`
keeps the account coder; `doc/src` Rust documentation. `git grep -i
fracpack -- 'rust' 'packages'` still lists those plus C++, TypeScript and
Python files that belong to the other sides.

**After the merge.** Regenerate the twin fixture and remove the
pass-through; add `DbId`, action argument records of services in both
languages, a boot transaction and a package's schema file to the fixture
(not done here: the C++ of this tree cannot produce their PSIO forms
yet); rerun the full suite; then the trust refinement (`decode_row`).

**Pin moved to PSIO `e12e4f6df7a2422f893d609848ab06194b75e082`** (the
pin both flip branches converge on). No psibase source changed; the
checkout in `external/psio` has to be fetched and checked out by hand
(the CMake check refuses to move an existing checkout), then
`cmake ~/psibase-pssz-build`. Full rebuild exit 0, ctest 93 / 93 (tag
`rflip-repin`), 68 schemas identical, fixture regenerated without a
difference, twin tests 3 / 3. Not yet used from it: `psio::time`
widening `From` / `Into` and the `*_mixed` methods (RG16 closed: the
`to_unit().unwrap()` sites become `.into()` in R-B),
`CustomHandlers::add_json` (RG17: the nested-`Action` presentation of
`trace.rs`), `pssz::dynamic::{equivalent, evolves_from}`.

**R-A (done): every service declares a PSIO interface.**

* `#[psibase::service]` always generates `PsioActions` / `psio_actions`
  (`#[psio::interface]`, argument records with `Debug, Clone, psio::Serde`);
  the option `psio = true` is gone. A second interface in one module
  (`structs = "hooks_structs"`) is `PsioHooks` / `psio_hooks`. Events are
  interfaces too: `PsioHistoryEvents` / `psio_history_events` and
  `PsioMerkleEvents` / `psio_merkle_events`, interface names
  `<service>.history` / `<service>.merkle` (provisional; the schema of an
  event is the argument record's node, not an `Interface`).
* Tables: `TableRecord::PrimaryKey` and every secondary key type must be
  `psio::key::KeyPack` (a compile-time assertion per index);
  `RawKey`, `KeyView`, `SingletonKey` implement it (their bytes as they
  stand).
* Types: `psio::JsonText` on the 257 types that had the binary derives;
  the full PSIO derives on 32 more (types declared inside service
  modules, `DbId`, `AuthTarget`, `SymbolLength`, `AdminOptionsRow`, …).
  `package::Meta` has no serde `default` any more (every member of
  `meta.json` is required, as in C++; the node tests' package writer adds
  `services`); `accounts::Account` and `ActionTrace` lost
  `deserialize_with` and take their serde impls from `psio::Serde` (reads
  a 64-bit number bare or quoted).
* Result types are named absolutely where a view wrote `super::Record`.
* **Temporary, must be gone after R-B / R-C:** `#[action(legacy)]` keeps
  an action out of the PSIO interface: `packages::setSchema`,
  `packages::getSchema` (legacy `Schema`), `transact::execTrx`
  (`fracpack::Nested`). The legacy schema records and
  `packages::InstalledSchema` have no PSIO derives. The Permissions
  plugin's `PackablePromptContext`, `Permission`, `Permissions` have none
  either (`TrustLevel` is mirrored as a plain enum when the legacy codec
  goes). `ActionTrace::total_time` is still `i64` (C++: nanoseconds).
* Checked (tag `rflip-ra`): full build exit 0; ctest 93 / 93 (81 in the
  first run: `psibase boot` could not read `totalTime` written as a
  string, and two tests fed a `meta.json` without `services`; the 12 were
  rerun after the fixes and pass); 68 schemas identical to `snap-d`; the
  six unbuilt packages check; plugins workspace checks.

### 6.21 What was checked after each of these steps

Each row: full build exit 0, full `ctest -j4`, the generated
`*-schema.json` (68) against `~/psibase-pssz-snap-head/`, and `cargo check
--target wasm32-wasip1` of the six packages the build never compiles.
Logs: `~/psibase-pssz-build.{build,ctest,compare}-<tag>.log`,
`~/psibase-pssz-build.<tag>-check-unbuilt.log`.

| Step | Tag | ctest | Schemas | Unbuilt packages |
|---|---|---|---|---|
| Merge of the integration head | `head` | 93 / 93 | identical to the snapshot of 0167a3056 (new baseline taken) | — |
| Pin `c6d99404` | `repin-c6d9` | 93 / 93 | identical | exit 0 |
| `Hex<T>` and 20 records (6.16) | `hex` | 93 / 93 | identical | exit 0 |
| Stale mirrors (6.17) | `mirrors` | 93 / 93 | identical | exit 0 |
| RTransact body validation, and slice R4 (6.19) | `r4` | 93 / 93 | identical | exit 0 |
| Slice R5, the views (6.20) | `r5` | 93 / 93 | identical | exit 0 |

`rs-tests` at the end: `psio_twins.rs` 2 tests (50 types, 115 values, 2
interfaces, 18 calls), `psio_wrappers.rs` 8, `psio_leaf_types.rs` 13,
`psibase-macros-lib` 6. `psinode_test_crash` passed in all six runs; the
evidence watcher captured nothing. wasm binaries were not compared (the
head changed how every service is compiled).

The RTransact change (commit `d208308ab`, not part of the conversion):
`parseBody<T>` inserted the JSON body at another container's iterator and
ignored the result of `from_frac`; `/login` read views over a transaction
a JSON body supplies as unvalidated hex. Fixed at the points of use
(`psio1` unchanged); `Transact-test` "Test login" posts a JSON login and
seven malformed bodies. Those cases pass with the fix; they were not run
against the code before it, and some of them would have been answered
with a 400 there too (a default `SignedTransaction` has no action), so
they cover the paths rather than prove the defect.
