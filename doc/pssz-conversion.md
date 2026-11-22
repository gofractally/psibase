# Converting psibase from fracpack to PSIO / PSSZ

This document records the first three slices of the conversion and slice 4a
(branch `claude/pssz`), the pattern they established, everything that remains, a
proposed order for the remaining slices, the decisions that need the owner's
confirmation, and the places where PSIO lacks something psibase needs.

End state: one serialization library, [gofractally/psio](https://github.com/gofractally/psio).
No in-tree copy, no fracpack, no compatibility layer. PSSZ on the wire, PSIO's
`key` format for database keys, I-JSON (`psio::ijson`) for clients, PSIO's
Schema IR for schemas. No chain data is migrated (fresh genesis).

## 0. Where the tree is after slices 1–3 and 4a

| | |
|---|---|
| Legacy library | `libraries/psio1`: include prefix `<psio1/…>`, namespace `psio1`, macros `PSIO1_…`, CMake target `psio1`, archive `libpsio1.a`. It is deleted at the end of the conversion. |
| PSIO | `gofractally/psio` at `e6901febbe226c93fa31e5aec06bd8f7c12b5ff5`, pinned in `cmake/PsibaseDependencies.cmake`, fetched to `external/psio`. |
| Native | `libraries/CMakeLists.txt` calls `psibase_acquire_dependency(psio)`; `psibase` and `psio1` link `psio::psio`. PSIO fetches simdjson 5.2.0 by URL and SHA-256; configuration fails if any other simdjson target exists first. PSIO's own install rules are excluded from psibase's install tree. |
| Guests | The `wasm/` project defines an INTERFACE target `psio` (`psio::psio`) over the same source tree: `PSIO_EXCEPTIONS_ENABLED=0`, `PSIO_HAVE_SIMDJSON=0`. The SDK installs PSIO's headers (`include/psio`, `include/psio/external/xxhash.h`); `psibase-config.cmake{,.build}` define the same target for SDK consumers. |
| Slice 1: leaf types | `AccountNumber`, `MethodNumber`; `Seconds`, `MicroSeconds`, `TimePointSec`, `TimePointUSec`; `Checksum160/256/512` (sections 1.1–1.3). |
| Slice 2: data records | 416 records moved from `PSIO1_REFLECT` to `PSIO_REFLECT` in 106 files. With slice 1's and the tests' own, the tree has 422 data declarations with `PSIO_REFLECT` in 111 files (`libraries/psibase` 107, `libraries/net` 33, `libraries/psibase_http` 1, `programs/*` 20, `packages/system` 75, `packages/user` 105, `packages/local` 37, `packages/psibase_tests` 43, `tests/cmake` 1); 122 table names declared with `PSIO_REFLECT_TYPENAME` in 37 files. 10 records deferred (section 1.9). |
| Slice 3: services | 124 `PSIO_REFLECT` declarations with methods in 108 files (every C++ service, its events, the query roots and the interfaces), 528 `method(...)` items, plus 15 `PSIBASE_REFLECT_{HISTORY,MERKLE}_EVENTS` sites (28 items), which now expand to `PSIO_REFLECT`. No service is deferred. |
| Slice 4a: method consumers | Everything psibase derives from a class's methods reads `psio::reflect<T>` directly: the call proxies (`Actor`, `transactor`, `EventEmitter`, `ActionViewBuilder`, the tester's `ServiceUser`) are `psio::reflect<T>::proxy<P>`; `dispatch` finds the action with `index_of_method_hash` and calls it with `invoke_method`; the action and event part of the service schema, `/pack_action`, `/action_templates` use `for_each_method` and `method_param_names<I>` (section 1.10). GraphQL still reads methods through `psio1` (slice 9). |
| Still declared with the legacy macro | 17 `PSIO1_REFLECT` sites in 11 files: the 10 deferred records, and 7 outside the scope of slices 2–3 (`rust/test_fracpack` 5, `libraries/debug_eos_vm` 2). 3 `PSIO1_REFLECT_TYPENAME` (2 XAdmin wrappers, 1 in `rust/test_fracpack`). No class with methods is declared with the legacy macro any more (`demo/` and the documentation examples moved in slice 4a: a service declared with `PSIO1_REFLECT` can no longer be dispatched). |
| Temporary glue | Only in `libraries/psio1` (section 1.5). Every block is marked `// TEMPORARY: removed when psio1 is deleted`. |
| Unchanged | Every wire, key, JSON and schema byte psibase produces: everything is still packed, keyed, written as JSON, described and dispatched by `psio1`, which reads the PSIO declarations through the glue. Evidence: after both slices all 68 generated `*-schema.json` files are byte-identical to the build of the tree before slice 2 (071fff6eb); after slice 2 every service and test WASM binary was byte-identical too; after slice 3 half of them still are (section 1.8). |
| Tests | ctest 92/92 after each slice, 4a included. `psio-tests` grew from 52 to 66 test cases natively and from 11 to 25 in the guest: pinned legacy bytes of psibase's own records, and legacy method metadata of PSIO-declared classes against legacy twins. |

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
| `psio1/reflect.hpp` (end of file) | `psio1::reflection_impl::canonical_reflect<T>` and a constrained `psio_get_reflect_impl` overload: `psio1::reflect<T>` is derived from `psio::reflect<T>` for any type reflected with PSIO. Everything read from `psio1::reflect` is provided with the type the legacy macro gives it: `is_defined`, `is_struct`, `definitionWillNotChange`, `name` (a `FixedString`, concatenated at compile time for GraphQL names), `data_members`, `data_member_names` (exactly one element per member; iterated), `member_functions` (a `MemberList` of the method pointers), `member_function_names` (an array of `initializer_list{"method", "param"...}`), and `proxy<P>`: the PSIO proxy over a projection that forwards `get<I, &T::field>()` to the legacy proxy object (the views). | fracpack, views, `to_key`, `to_bin`, schema (tables, keys), GraphQL and generic JSON read the data members. Since slice 4a only `psio1/graphql.hpp` reads the methods (`member_functions`, `member_function_names`, `get_member_function`): the half of the projection that forwarded `call<I, &T::method>(args...)` by value to a legacy call proxy is deleted, with its tests. Binary / key adapters are not bridged (static assertion). `member_pointers()` (read by nothing) lists data members, then methods; the legacy macro interleaves them as written. |
| `psio1/to_json.hpp`, `psio1/from_json.hpp` | `to_json` / `from_json` overloads for any type with a PSIO `text_category` adapter. | Replaces the ADL `to_json` / `from_json` the converted headers no longer define. `from_json` calls only the adapter's `decode`, so legacy JSON keeps its historical leniency. |
| `psio1/graphql.hpp` | `use_json_string_for_gql` is true for a type with a PSIO text adapter. | Replaces the ADL hook. |
| `psio1/schema.hpp` | `psio_custom_schema` is true for `psio::schema_custom_v<T>`; the custom id is `psio::schema_custom_id<T>()`. | Replaces the ADL hook; the ids (`AccountNumber`, `MethodNumber`) are the ones the legacy schemas already used. |
| `psio1/fracpack.hpp` (last line) | includes `psio1/chrono.hpp`. | `psibase/time.hpp` no longer includes a legacy header. |
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

Every reflected type that slices 2 and 3 did not convert, and why. All of them
work as before through the legacy macro.

| Type | Where | Reason | Blocked by |
|---|---|---|---|
| `Memo` | `psibase/Memo.hpp` | A string that packs as its `contents` (`psio_unwrap_packable`), validates UTF-8 and ≤ 80 bytes on unpack (`psio_validate_packable`) and in JSON. Its canonical form is `psio::utf8_string<80>`, which changes the member API and is a wire decision. | D5; G3, G5 |
| `Precision` | `Tokens/tokenTypes.hpp` | A `uint8_t` wrapper that packs as the integer and validates 0–8 on unpack and in JSON. | G3, G5 |
| `Decimal` | `Tokens/tokenTypes.hpp` | A record (`Quantity`, `Precision`) whose JSON is a decimal string. It needs a text adapter whose `validate` reports instead of aborting (`Decimal::fromStr` calls `psibase::check`), and a decision on which spellings name a value (`"1.50"` and `"1.5"` are different values; `".5"`, `"5."`, `""`?). | D17; holds a `Precision` |
| `TypedAction<T>` | `psibase/Actor.hpp` | `psio1::nested<T>` member. | G7 |
| `TimerRow` | `psibase/nativeTables.hpp` | `MonotonicTimePointUSec` member. | G2 |
| `UrlRow` | `XPeers.hpp` | `MonotonicTimePointUSec` member. | G2 |
| `TimerQueueRow` | `XTimer.hpp` | `MonotonicTimePointUSec` member. | G2 |
| `ServiceSchema` | `psibase/schema.hpp` | Four `std::map` members (`actions`, `history`, `merkle`, `database`); it is also the legacy schema format itself, replaced by the Schema IR. | G8, G1 |
| `DynDepGroups` | `DynLd.hpp` | `std::map<std::string, std::vector<DynDep>>` member. | G8 |
| `PsinodeServiceConfig` | `programs/psinode/main.cpp` | `std::map<std::string, ExtraConfigField>` member. | G8 |
| `SubjectPublicKeyInfo`, `PrivateKeyInfo` | `AuthSig/Spki.hpp`, `PrivateKeyInfo.hpp` | Not reflected at all: transparent wrappers over DER bytes with validation, PEM text and a key hook. | G3, G5 |
| `XAdmin::Auth::Account`, `LocalUsername` | `XAdmin.hpp` | Transparent wrappers named with `PSIO1_REFLECT_TYPENAME` (variant alternative names). | G3 |
| `IPAddress`, `SocketEndpoint` | `psibase/SocketInfo.hpp` | Variant aliases with a text form; their alternatives are converted records. | G4 |

Outside the scope of slices 2–3 and still on the legacy macro:
`libraries/debug_eos_vm/dwarf.cpp` (2 sites; the legacy `bin` format with
custom `to_bin`/`from_bin` and a `psio1::input_stream` member) and
`rust/test_fracpack/tests/test.hpp` (5 sites; the legacy library's own
C++/Rust cross-check, deleted with it). `demo/http-server-build/CookieProbe.cpp`
(2 sites, one service; built by its own script, not by the tree) and the C++
examples under `doc/src/development/services/cpp-service` (4 services and the
snippet in `reference/services-events.md`; compiled against the SDK by the
tree) moved to `PSIO_REFLECT` in slice 4a, because `PSIBASE_DISPATCH` reads
PSIO reflection now.

One declaration is wrong today and was converted as it stands:
`PSIO_REFLECT(RestartInfo, shouldRestart)` in `programs/psinode/main.cpp`
names a member the struct does not have (it has `args`, `keysChanged`,
`configChanged`). Both macros only fail when the reflection is used, and
nothing uses it. Decision D19.

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

## 2. Inventory of what remains

Counts are occurrences / files in the tree outside `libraries/psio1`,
`external/` and `doc/` (`git grep -P`). Section 2.1 is re-counted at the end
of slice 3; sections 2.2–2.9 are as counted at the end of slice 1 (slices 2
and 3 changed declarations only, so the call sites they count are unchanged).
`libraries/psio1` itself is 52 files, about 14,600 lines of headers and
sources, 20 test files.

### 2.1 C++: reflection

| Legacy | Sites / files | Canonical replacement |
|---|---|---|
| `PSIO1_REFLECT(` | was 569 / 176; now 20 / 12 (19 declarations and one comment) | `PSIO_REFLECT`: now 553 / 175 |
| — remaining, by area | `libraries/psibase` 4 (`Memo`, `TypedAction`, `TimerRow`, `ServiceSchema`), `packages/user` 3 (`Precision`, `Decimal`, `DynDepGroups`), `packages/local` 2 (`UrlRow`, `TimerQueueRow`), `programs/psinode` 1 (`PsinodeServiceConfig`); out of scope: `rust/test_fracpack` 5, `libraries/debug_eos_vm` 2, `demo` 2 | section 1.9 |
| `method(...)` items | 557 items (the text `method(` occurs 606 times in 121 files, 49 of them calls such as `action.method()`): 528 in `PSIO_REFLECT`, 28 in `PSIBASE_REFLECT_*_EVENTS` (which expand to `PSIO_REFLECT`), 1 in `demo/` on the legacy macro | done; consumers move to `reflect<T>::method_*`, `index_of_method_hash<Hash>` in slice 4 |
| `definitionWillNotChange()` | 25 / 13, all in `PSIO_REFLECT` now | same keyword |
| `allowHashedMethods()` | was 4 / 3; now 0 | removed: it was inert (1.7). Decision D7. |
| `PSIO1_REFLECT_TYPENAME` | was 125 / 38; now 3 / 2 (two XAdmin wrappers, `rust/test_fracpack`) | `PSIO_REFLECT_TYPENAME`: 122 / 37 (table names) |
| `psio1::reflect<…>` used directly | was 42 / 9; after slice 4a 19 / 5, all data-member uses: `serveGraphQL.hpp` 9, `XPackages.cpp` 3 (`name`, `data_member_names`), `Table.hpp` 2, `schema.hpp` 1 (table keys), `zip.cpp` 1 (`data_members`) | `psio::reflect<T>` (slice 4b) |
| `MemberPtrType`, `TypeList`, `apply_members`, `for_each_member`, `member_function_names`, `FixedString` | 24 / 6 | `psio::reflect<T>::for_each_field` / `for_each_method`, `psio::method_traits` |
| `PSIBASE_REFLECT_TABLES` 80, `…_HISTORY_EVENTS` 15, `…_KEY_TRANSFORM` 7, `…_MERKLE_EVENTS` 2 | 104 / 67 | psibase's own macros; they stay, re-implemented over `psio::reflect` |
| `psibase/dispatch.hpp` + `PSIBASE_DISPATCH` | 80 / 79 | done in slice 4a: dispatcher over `reflect<Svc>::invoke_method` / `index_of_method_hash` |
| `Actor<>` / `at<>` | 30 / 10 | done in slice 4a: `psio::reflect<Svc>::proxy<P>` (`P::call<I, &Svc::m>(args...)`) |
| Events (`EventEmitter`, `emit()`) | 39 / 8 | done in slice 4a: same proxy mechanism over the event structs |
| ADL hooks `psio_unwrap_packable` 14/6, `psio_validate_packable` 5/3, `psio_custom_schema` 2/2, `use_json_string_for_gql` 3/3, `get_gql_name` 3/2 | | adapters (`PSIO_ADAPTER`), bounded wrappers; see G3, G4, G13 |
| `#include <psio1/reflect.hpp>` | 8 / 8 (was 15) | `<psio/reflect.hpp>`: the 13 headers and sources that included the legacy header for the macro include PSIO's; 6 of them no longer include the legacy one |

### 2.2 C++: binary (fracpack → PSSZ)

| Legacy | Sites / files | Canonical replacement |
|---|---|---|
| `psio1::to_frac(` | 93 / 38 | `psio::encode(psio::pssz{}, v[, sink])` |
| `convert_to_frac` | 35 / 25 | `psio::encode(psio::pssz{}, v)` |
| `from_frac`, `from_frac_strict` | 75 / 37 | `psio::decode<T>(psio::pssz{}, bytes)` after `psio::validate<T>` (or `validate_strict`) |
| `fracpack_validate[_strict]` | 24 / 5 | `psio::validate<T>(psio::pssz{}, bytes)` / `validate_strict` |
| `psio1::view<…>` | 134 / 38 (3 of them mutable) | `psio::view<T, psio::pssz, storage>` (`pssz_view.hpp`); mutation: G6 |
| `shared_view_ptr` | 64 / 32 | `psio::buffer<T, psio::pssz>` (owning) + `psio::as_view` |
| `prevalidated` | 43 / 16 | nothing: a PSIO view's getters assume validated input (`pssz_view.hpp`), so a view is built after `psio::validate` |
| `psio1::nested<T>` | 4 / 3 (`Actor.hpp`, `Rpc.hpp`, XPeers) | a `std::vector<char>` member holding PSSZ of `T`; G7 |
| `is_packable`, `PackableAs` | 5 / 4 | PSIO shape concepts; `pssz_evolves_from` for compatibility checks |
| `to_bin` / `convert_to_bin` 156/4, `from_bin` 70/5 | `debug_eos_vm/dwarf.cpp`, `psitest/main.cpp`, `TestKV.cpp` | `psio::bin` (`bin.hpp`), or plain stream reads in `dwarf.cpp` |
| Streams: `vector_stream` 66/25, `input_stream` 168/23, `size_stream` 7/4, `string_stream` 5/3, `fixed_buf_stream` 1/1 | | `psio/stream.hpp` sinks; most uses disappear with `encode(fmt, v)` |
| `psio1::to_hex` / `from_hex` / `hex` | 15 / 9 | `psio/to_hex.hpp` |
| `sha256(const T&)` and `Merkle` (hash of the packed form) | `crypto.hpp`; 146 / 76 call sites of `sha256(` | the same functions over PSSZ bytes. Every block, transaction and Merkle id changes at the flip. |

### 2.3 C++: keys

| Legacy | Sites / files | Canonical replacement |
|---|---|---|
| `convert_to_key` | 87 / 28 | `psio::to_key(v)` / `psio::encode(psio::key{}, v)` |
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
| `convert_to_json` | 65 / 25 | `psio::encode(psio::ijson{}, v)` / `encode_json_checked` |
| `convert_from_json` | 53 / 29 | `psio::decode_json_checked(psio::ijson{}, text, out)` |
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
| `MonotonicTimePoint*` | 7 / 5 (nativeTables, XTimer, XPeers) | G2 |
| `get_type_name` | 4 / 2 | `psio::get_type_name` |

### 2.7 Rust

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

Rust acquires PSIO how? `external/psio/rust/psio` is not published; the Cargo
workspace needs a pinned `git` dependency at the same commit as the CMake pin
(decision D11).

### 2.8 JavaScript / TypeScript

| Legacy | Where | Replacement |
|---|---|---|
| Pack endpoints: `packAction` (`/pack_action/<m>`), `packTransaction` (`/common/pack/Transaction`), `packSignedTransaction`, `packAndDigestTransaction` | `packages/user/CommonApi/common/packages/common-lib/src/rpc.ts` (399 lines) | same endpoints returning PSSZ (server side flips), or client-side packing with PSIO's JS package (`external/psio/js`: `pssz.ts`, `pssz-json.ts`, `pssz-key.ts`, `schema.ts`) — decision D12 |
| `publicKeyPairToFracpack`, `signatureToFracpack` | `common-lib/src/key-conversions.ts` (277 lines) | PSSZ forms of the same values |
| `SimpleUI.mjs`, `Explorer/ui/src/lib/types.ts` | | I-JSON shapes (variants as `{"Name": v}`, 64-bit numbers) |
| Every UI and plugin that reads service JSON | not counted here | I-JSON; inventory belongs to the JSON slice |

### 2.9 Python

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
| 2b | The deferred types of 1.9, as PSIO closes G2, G3, G5, G7, G8 (the pin moves) or the owner decides D5, D17: `Memo` → `psio::utf8_string<80>` (99 uses), `Precision`, `Decimal`, `SubjectPublicKeyInfo` / `PrivateKeyInfo`, `TimerRow` / `UrlRow` / `TimerQueueRow`, `TypedAction<T>`, `DynDepGroups`, `PsinodeServiceConfig`, the two XAdmin wrappers, `IPAddress` / `SocketEndpoint` text. Each needs the glue to pack the new PSIO type in its legacy form (`utf8_string<N>` as a string, a transparent wrapper as its inner type) until the flip. Also `demo/`, `debug_eos_vm` and the documentation examples. | unchanged | glue twins per new kind |
| 4a (done) | Section 1.10. As planned: **Method consumers** read `psio::reflect` directly. Unblocked now: all 139 declarations with methods are PSIO. `Actor.hpp` (`Actor`, `transactor`, `EventEmitter`, `ActionViewBuilder`: 13 uses of `reflect<T>::proxy`) → `psio::reflect<T>::proxy<P>`; `dispatch.hpp` → `index_of_method_hash<MethodHash>` + `invoke_method<I>` (a perfect hash instead of a linear scan; two methods of one service whose names collide become a compile error); `schema.hpp` (actions, events), `servePackAction.hpp`, `serveActionTemplates.hpp`, the tester, `test_util.cpp` → `for_each_method`, `method_param_names<I>`, `method_params<I>`. Two things to settle first: PSIO's proxy forwards references where the legacy proxy passes by value (psibase's four proxy objects deduce parameter types from the arguments: decide by-value explicitly), and `make_param_value_tuple` (strips `psio1::view<>` from parameters) needs a psibase-side equivalent until views flip. GraphQL's use of methods stays in `psio1/graphql.hpp` until slice 9. | unchanged | existing; compare schemas and WASM binaries with the previous build |
| 4b | **Data-member consumers** read `psio::reflect` directly: `Table.hpp`, `serveGraphQL.hpp`, `schema.hpp` (tables, keys), `nativeTables`. Blocked on 2b: they are instantiated with the deferred records (`TimerRow`, `UrlRow`, `TimerQueueRow`, `TokenRecord`→`Precision`, …), which `psio::reflect` cannot see while they are declared with the legacy macro. `psio1::FixedString` (compile-time name concatenation, 24 uses in 6 files) needs a home in psibase. Also the member-function key in `schema.hpp` (`psio1::MemberPtrType<…>::ReturnType`, 1 use). After 4b nothing outside `psio1` names `psio1::reflect` (19 uses in 5 files after 4a; 42 in 9 before). | unchanged | existing |
| 5 | Rust prepared without source churn: the (dying) fracpack derive also emits PSIO impls, so every `Pack`/`Unpack`/`ToSchema`/`ToKey` type already has PSSZ, key and schema impls; Rust leaf types (`AccountNumber`, …) get the same text rules as C++ and a shared fixture (generated by C++, checked by Rust and JS) for names, times, digests. Python and JS codecs written and tested against the fixture. | unchanged | fixture tests in 3 languages |
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

Working method for the wire-neutral slices (2b, 4a, 4b), as used in slices 2
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
| D5 | `Memo` becomes `psio::utf8_string<80>` (an alias, or a record member of that type). This removes `.contents` and the constructors that call `check`. | Not converted. |
| D6 | Any 64-bit value is a valid `AccountNumber` / `MethodNumber` in PSSZ and key (as today). An invalid value's text does not read back (`AccountNumber{~0}` writes `"+255"`). Rejecting such values on PSSZ decode needs a validation hook (G5). | Accept, as today. |
| D7 | `allowHashedMethods()` was inert and is removed (1.7): the check it switched off was never instantiated, and 30 method names in 10 types do not compress (23 in the three services and one events struct that said the keyword, 7 in six types that did not). Hashed method names work and are in use. Needed: does psibase want the rule "method names compress" at all? If yes, it belongs in psibase (a `static_assert` over `psio::reflect<Svc>::method_names` where a service or events struct is dispatched or emitted), the seven names above must be renamed or opt out, and the opt-out needs a psibase spelling (PSIO has no keyword; whether a psibase-defined spec can be attached with `PSIO_TYPE_ATTRS` was not established). | Removed; no rule enforced, as before. |
| D8 | `KeyView` (pre-encoded key prefix) has no PSIO type; psibase keeps a small own type that concatenates bytes with `psio::to_key` output. | — |
| D9 | `psio1::finally` is not serialization; it needs a home in psibase. | — |
| D10 | Rust code that only exchanges JSON over HTTP: keep serde with I-JSON-conforming impls for psibase types, or move to `psio::JsonText`. | — |
| D11 | Rust acquisition of PSIO: Cargo `git` dependency pinned to the CMake pin's commit (and a check that the two agree). | — |
| D12 | JS: keep server-side pack endpoints, or pack in the client with PSIO's JS package and the service's Schema IR. | — |
| D13 | PSIO's `-Werror=unused-result` (an INTERFACE option of `psio::psio`) now applies to every psibase native target. The tree builds clean with it. | Accepted. |
| D14 | `psio1` now requires PSIO headers and C++23 everywhere it is compiled (also `rust/test_fracpack`, previously `gnu++2a`). | Accepted (temporary). |
| D15 | `tests/cmake/dependencies/README.md` was rewritten where it described PSIO as dormant. | — |
| D16 | Which records count as convertible now (1.6): a record is declared with PSIO when its reflection line is final, even if a member's type is a legacy library type that changes at the flip (`shared_view_ptr`, `view`, `json::any`, `psio1::Schema`) or a deferred type. It is deferred only when its own declaration must change (a member with no PSIO value: `std::map`, `nested<T>`, monotonic time; or a legacy wrapper / validation / text hook on the type itself). The alternative — convert only records that already encode with PSIO — would have deferred `SignedTransaction`, the P2P block messages and everything holding a key, a `Precision` or a socket endpoint. | As described. |
| D17 | `Decimal` (Tokens) has a decimal-string JSON form. As a PSIO text adapter it needs a `validate` that reports instead of aborting, and a rule for which spellings are accepted (`"1.5"` and `"1.50"` are different values — precision is part of the value; `".5"`, `"5."`, leading zeros?). `Precision` (0–8, validated on unpack) needs G3/G5 or a bounded integer type. | Not converted. |
| D18 | `PSIO_INTERFACE(Svc)` (the Schema IR's interface envelope) is not added to services in slice 3: nothing reads it until the schema path moves to the IR, and its item list (`types(…)`, `funcs(…)`) repeats what `PSIO_REFLECT` already states. Decide in the schema slice whether psibase derives interfaces from `psio::reflect<Svc>` methods (preferred: one declaration per service) or writes `PSIO_INTERFACE` 124 times. | Not added. |
| D19 | `PSIO_REFLECT(RestartInfo, shouldRestart)` in `programs/psinode/main.cpp` lists a member that does not exist; the reflection is unused. Delete it or list the real members. | Converted as written. |
| D20 | The documentation examples (`doc/src/development/services/cpp-service`) and `demo/` taught and used `PSIO1_REFLECT`. | Converted in slice 4a (required: `PSIBASE_DISPATCH` no longer dispatches a legacy-declared service). The `demo/` service is built by its own script and was not rebuilt. |
| D22 | Call proxies and argument copies. (a) No standard applies. (b) psibase before: the legacy proxy took every argument by value and handed the proxy object rvalues of the decayed types; `ActionViewProxy` chose "pack as given" or "convert to the parameter type" from those types. (c) PSIO: the proxy forwards references and has no by-value mode (G15). Taken: the proxy objects keep the decision on the decayed type (same bytes, same accepted argument types) but no longer copy — an lvalue argument is read in place. The alternative is an explicit by-value hop in each proxy object, which reproduces the old code exactly at the cost of a copy or move per argument. | By reference, decayed types. |
| D23 | Two reflected methods of one service with the same `MethodNumber`. (a) No standard. (b) psibase before: accepted; the first one listed was called, the second was unreachable (and the schema kept only the first). (c) PSIO: `index_of_method_hash` makes it a compile error. Taken: PSIO's behaviour; no service in the tree is affected. The check applies to services that are dispatched (`PSIBASE_DISPATCH`), not to events structs or interfaces. | Compile error. |
| D24 | `EventEmitter::from(sender)` constructs `EventEmitter(sender, elog)`, a constructor `EventEmitter` does not have; it compiles only because nothing calls it. Not introduced by this work and left as found. Delete it or give `EventEmitter` the constructor. | Left. |
| D21 | `psio-tests` now links `psibase` (and through it the service headers) so that the glue test can pin psibase's own records. Temporary, deleted with `psio1`. | Accepted. |

## 5. Where PSIO lacks something psibase needs

| # | Header | Missing | Why psibase needs it |
|---|---|---|---|
| G1 | `psio/json.hpp`, `schema_ir.hpp` | A `psio::schema_types::Schema` cannot be written or read as JSON: `psio::encode(psio::json{}, schema)` fails to compile (`Box<AnyType>`: "unsupported type in encode_value"). Only the PSSZ form (`emit_pssz`) exists. | psibase publishes service schemas as JSON (`*-schema.json` in packages, `/schema` queries, the CLI, UIs). Either PSIO defines the IR's JSON form, or psibase ships IR bytes and every consumer decodes them. |
| G2 | `psio/time.hpp` (static assertion, line 97) | Only `system_clock` time points are values. | `MonotonicTimePointSec/USec` are stored and passed by `nativeTables.hpp`, XTimer and XPeers (7 uses). Either PSIO accepts a caller-declared epoch-less clock (binary = ticks, JSON = ticks), or psibase stores these as durations. |
| G3 | `psio/adapter.hpp`, `schema_builder.hpp` | No transparent wrapper ("newtype") with (a) the inner type's wire and key form, (b) its own text form, (c) a validation hook, (d) a schema node. A `binary_category` adapter gives (a) but "a binary adapter is not expressible" in the IR, and `schema_custom_v` requires a reflected record or an enum. | `SubjectPublicKeyInfo` (DER bytes on the wire, PEM in JSON, validated when unpacked, keyed by its bytes). Reflecting it as a one-member record would add a level to the wire and JSON forms. Rust has `#[pssz(transparent)]` + `#[pssz(custom)]`; C++ has no equivalent. |
| G4 | `psio/adapter.hpp` (`schema_custom_v`) | A text presentation for a type that is not a reflected record or enum — e.g. a `std::variant` alias. | `IPAddress` and `SocketEndpoint` are variants written as one string (`"127.0.0.1:8080"`). |
| G5 | `psio/pssz.hpp`, `annotate.hpp` | No per-type semantic validation hook that `validate` / `validate_strict` call for a reflected record (the role of `psio_validate_packable`, 5 uses). | Rejecting invalid values at the wire boundary (names that are not names, D6; key material). |
| G6 | `psio/mutable_view.hpp` | `mutable_view` is a forward declaration only. | 3 call sites mutate fixed-size fields through `psio1::view<T>` in place. They can be rewritten as decode–modify–encode. |
| G7 | `psio/wrappers.hpp` | No C++ `nested<T>` (a member that is the PSSZ bytes of a `T`, typed). Rust has `nested.rs`. | `Actor.hpp` (typed action arguments inside `Action::rawData`), `Rpc.hpp` (`FracpackHttpReply`), XPeers. |
| G8 | `psio/pssz.hpp`, `json.hpp`, `key.hpp` | `std::pair`, `std::map` and `std::set` are not values in PSSZ, JSON or key (`shapes.hpp` only detects them); there is no JSON object with dynamic keys. | 3 `std::pair` and 4 `std::map`/`std::set` members in public headers; `to_json/map.hpp` users (package metadata, config). Pairs become tuples and maps become sorted lists of records; both change bytes or JSON, so they change at the flips. |
| G9 | — | No Python implementation. | `programs/psinode/tests/fracpack.py` drives the node tests. psibase must write a schema-driven PSSZ + I-JSON codec in Python, or drive the tests through server-side pack endpoints. |
| G10 | repository root | No `LICENSE` file at the pinned commit. | The SDK installs a licence file for every bundled dependency (`share/psibase/licenses`); PSIO's headers are now installed without one. |
| G11 | `psio/pssz.hpp:896` | `-Wall` warning (`unused type alias 'E'`) in every TU that encodes PSSZ. | psibase test targets build with `-Wall`; harmless, noisy. |
| G12 | PSIO GraphQL | Not in the pinned commit. | `psio1/graphql.hpp` (1,704 lines) serves 23 files of GraphQL users. |
| G13 | `psio/adapter.hpp` (`schema_custom_v`), `schema_builder.hpp` | A custom schema id for a reflected record that has no text adapter. | `Action` and `ServiceMethod` are marked `psio_custom_schema` so that schema-driven tools recognise them (an action's `rawData` is decoded with the target service's schema). In PSIO a record is `Custom{…, id}` only when it has a text presentation. The legacy hooks still serve; the Schema IR path needs either this or name-based recognition in psibase's handlers. |
| G14 | `psio/reflect.hpp` | `PSIO_REFLECT(T, definitionWillNotChange(), …)` does not compile with `<psio/reflect.hpp>` alone: the keyword expands to `psio::definition_will_not_change`, declared in `<psio/annotate.hpp>`. | A header that only reflects records must know to include `annotate.hpp` (`SocketInfo.hpp` does). `reflect.hpp` should include what its own keywords need. |
| G15 | `psio/reflect.hpp` (proxy) | The record proxy passes method arguments as forwarding references; there is no by-value mode. | psibase's call proxies deduce the packed parameter tuple and `PackableAs` checks from the argument types; the legacy proxy decays them first. Since slice 4a psibase's proxy objects decay the types themselves (D22) and the glue for it is deleted. Not a defect, a difference to design for. |
| G16 | `psio/reflect.hpp` (`PSIO_REFLECT_METHODS_EMPTY_`) | A type that lists no method has `method_count`, `method_names`, `method_type<I>`, `method_pointer<I>`, `method_name<I>`, the lookups and `for_each_method`, but not `method_param_names<I>`, `method_traits<I>`, `method_result<I>`, `method_args<I>`, `method_params<I>`, `method_is_static<I>`, `method_is_const<I>`, `invoke_method<I>`. | Generic code that names `psio::reflect<T>::method_param_names<I>` inside a per-method callback does not compile for a class without methods (`EmptyService`, a service with no actions), although the callback is never called: once `T` is known the name is looked up in a class that does not have it. Reproduction: `generateActionJsonTemplate<psibase::EmptyService>()` with `reflect::template method_param_names<I>` in the callback fails with "no member named 'method_param_names' in 'psio::reflect<psibase::EmptyService>'". Glue: `psio1::canonical_method_param_names<T, I>` (`psio1/reflect.hpp`, end of file), used by `schema.hpp`, `servePackAction.hpp`, `serveActionTemplates.hpp`. Fix in PSIO: declare the same member templates in the empty case, as it already does for `method_type` / `method_pointer` / `method_name`. |
| G17 | `psio/reflect.hpp` (`for_each_method`) | `for_each_method(fn)` calls `fn(index, name, &T::method)`: the pointer is passed as a value, which odr-uses every reflected method. There is no walk that gives only the index (or the index and the name). | Code that describes a service without containing it — the `R*` query services that serve `/pack_action`, `/action_templates` and the schema of another service, and schema generation — would need every method's definition at link time. Reproduction: with `for_each_method` in `fracpackActionFromJson`, `RAccounts.wasm` fails to link: "wasm-ld: error: … RAccounts.cpp.obj: undefined symbol: SystemService::Accounts::init()" (and every other action). The legacy walk passed a null pointer of the method's type. Glue: `psio1::canonical_for_each_method_index<T>(fn)` (`psio1/reflect.hpp`, end of file), `fn(std::integral_constant<std::size_t, I>, name)`. Fix in PSIO: an index-only walk, or `for_each_method` passing the index and name only (the pointer is `method_pointer<I>`). |
| G18 | `psio/reflect.hpp` (proxy) | `Projection::call<I, &T::method>` is told the index and the member pointer but not the reflected type `T`. For a method `T` inherits, `&T::method` has the type `R (Base::*)(…)`, so the proxy object can only recover `Base`, in whose reflection `I` means something else (or nothing). | psibase's proxy objects turn `(I, MemberPtr)` into the method's name (`methodNumber<I, MemberPtr>`). The legacy proxy had the same limitation (it also derived the class from the member pointer), so behaviour is unchanged and nothing is worked around; whether any class in the tree reflects an inherited method was not searched for. Such a method would fail to compile or, if the base is reflected too, name the wrong method. A `call<T, I>` form (or passing `T`) would remove the trap. |
