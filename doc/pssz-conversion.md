# Converting psibase from fracpack to PSIO / PSSZ

This document records the first slice of the conversion (branch `claude/pssz`),
the pattern it established, everything that remains, a proposed order for the
remaining slices, the decisions that need the owner's confirmation, and the
places where PSIO lacks something psibase needs.

End state: one serialization library, [gofractally/psio](https://github.com/gofractally/psio).
No in-tree copy, no fracpack, no compatibility layer. PSSZ on the wire, PSIO's
`key` format for database keys, I-JSON (`psio::ijson`) for clients, PSIO's
Schema IR for schemas. No chain data is migrated (fresh genesis).

## 0. Where the tree is after slice 1

| | |
|---|---|
| Legacy library | `libraries/psio1`: include prefix `<psio1/…>`, namespace `psio1`, macros `PSIO1_…`, CMake target `psio1`, archive `libpsio1.a`. It is deleted at the end of the conversion. |
| PSIO | `gofractally/psio` at `e6901febbe226c93fa31e5aec06bd8f7c12b5ff5`, pinned in `cmake/PsibaseDependencies.cmake`, fetched to `external/psio`. |
| Native | `libraries/CMakeLists.txt` calls `psibase_acquire_dependency(psio)`; `psibase` and `psio1` link `psio::psio`. PSIO fetches simdjson 5.2.0 by URL and SHA-256; configuration fails if any other simdjson target exists first. PSIO's own install rules are excluded from psibase's install tree. |
| Guests | The `wasm/` project defines an INTERFACE target `psio` (`psio::psio`) over the same source tree: `PSIO_EXCEPTIONS_ENABLED=0`, `PSIO_HAVE_SIMDJSON=0`. The SDK installs PSIO's headers (`include/psio`, `include/psio/external/xxhash.h`); `psibase-config.cmake{,.build}` define the same target for SDK consumers. |
| Converted types | `AccountNumber`, `MethodNumber`; `Seconds`, `MicroSeconds`, `TimePointSec`, `TimePointUSec`; `Checksum160/256/512` (section 1). |
| Temporary glue | Only in `libraries/psio1` (section 1.5). Every block is marked `// TEMPORARY: removed when psio1 is deleted`. |
| Unchanged | Every wire, key, JSON and schema byte psibase produces. All unconverted code still uses `psio1`. |

## 1. The conversion pattern

A converted header includes only `<psio/…>` headers, declares the type with
PSIO's own macros, and contains nothing for the legacy library. While the two
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

### 1.4 Kinds of type not converted in this slice

| Kind | Examples | Canonical form | Why not now |
|---|---|---|---|
| Bounded, validated string | `Memo` (UTF-8, ≤ 80 bytes; 99 uses in 24 files) | `psio::utf8_string<80>` — PSIO enforces the bound and UTF-8 in PSSZ, key and JSON | It changes the member API (`.contents`) at every use and needs `psio1` to pack `utf8_string`; belongs with slice 2. Decision D5. |
| Transparent wrapper with validation and its own text | `SystemService::AuthSig::SubjectPublicKeyInfo` (DER bytes; PEM text; validated on unpack; 116 uses in 38 files) | none today | Gap G3. |
| `std::variant` with a text form | `IPAddress`, `SocketEndpoint` (`SocketInfo.hpp`) | none today | Gap G4. |
| Records | `Action`, `Claim`, `BlockHeader`, … | `PSIO_REFLECT` (in-class or after the type), `definitionWillNotChange()` where it is today, new members appended as `std::optional` | Slice 2. |
| Record templates | `BasicHttpRequest<Body>`, `BasicHttpReply<Body>` | in-class `PSIO_REFLECT` inside the class template (checked: compiles and encodes at the pinned commit) | Slice 2. |
| Services | 121 files with `method(...)` | `PSIO_REFLECT(Svc, method(name, args...)...)` + `PSIO_INTERFACE(Svc)` | Slice 3. |
| Crypto signatures | none are typed today: claims and proofs are `std::vector<char>` | bytes | Nothing to convert. |

### 1.5 The temporary glue (all inside `libraries/psio1`)

| File | What | Why |
|---|---|---|
| `psio1/reflect.hpp` (end of file) | `psio1::reflection_impl::canonical_reflect<T>` and a constrained `psio_get_reflect_impl` overload: `psio1::reflect<T>` is derived from `psio::reflect<T>` for any type reflected with PSIO (data members, DWNC flag, names, view proxy). | fracpack, views, `to_key`, `to_bin`, schema, GraphQL and generic JSON all read `psio1::reflect`. Methods are not bridged (static assertion); binary / key adapters are not bridged (static assertion). |
| `psio1/to_json.hpp`, `psio1/from_json.hpp` | `to_json` / `from_json` overloads for any type with a PSIO `text_category` adapter. | Replaces the ADL `to_json` / `from_json` the converted headers no longer define. `from_json` calls only the adapter's `decode`, so legacy JSON keeps its historical leniency. |
| `psio1/graphql.hpp` | `use_json_string_for_gql` is true for a type with a PSIO text adapter. | Replaces the ADL hook. |
| `psio1/schema.hpp` | `psio_custom_schema` is true for `psio::schema_custom_v<T>`; the custom id is `psio::schema_custom_id<T>()`. | Replaces the ADL hook; the ids (`AccountNumber`, `MethodNumber`) are the ones the legacy schemas already used. |
| `psio1/fracpack.hpp` (last line) | includes `psio1/chrono.hpp`. | `psibase/time.hpp` no longer includes a legacy header. |
| `libraries/psio1/CMakeLists.txt` | `psio1` links `psio::psio`. | The glue includes PSIO headers. |
| `libraries/psio1/tests/canonical_glue_tests.cpp` | Each PSIO-declared test type has a twin declared with `PSIO1_REFLECT`; fracpack bytes, views, JSON, keys, schema and GraphQL must be identical. Native and guest. | Deleted with `psio1`. |

Because of the glue, `psio1` headers need PSIO on the include path and C++23:
`rust/test_fracpack/build.rs`, `rust/gen-cpp-doc` and `demo/*/build.py` pass it.

## 2. Inventory of what remains

Counts are occurrences / files in the tree outside `libraries/psio1`,
`external/` and `doc/` (`git grep -P`), at the end of slice 1.
`libraries/psio1` itself is 52 files, 14,369 lines of headers and sources, 20
test files.

### 2.1 C++: reflection

| Legacy | Sites / files | Canonical replacement |
|---|---|---|
| `PSIO1_REFLECT(` | 569 / 176 | `PSIO_REFLECT` |
| — by area | `packages/user` 144/38, `libraries/psibase` 118/30, `packages/system` 111/36, `packages/psibase_tests` 75/36, `packages/local` 57/18, `libraries/net` 33/11, `programs/psinode` 16/1, other 15/6 | |
| `method(...)` items | 606 / 121 (system 33 files, tests 31, user 28, local 17, libraries 8) | `method(name, args...)` in `PSIO_REFLECT` + `PSIO_INTERFACE(Svc)`; `reflect<T>::method_*`, `index_of_method_hash<Hash>` |
| `definitionWillNotChange()` | 24 / 12 | same keyword |
| `allowHashedMethods()` | 4 / 3 (Transact, StagedTx, VirtualServer) | no keyword; a dispatcher that looks methods up with `index_of_method_hash<MethodNumber hash>` decides. Decision D7. |
| `PSIO1_REFLECT_TYPENAME` | 125 / 38 | not needed for records (`reflect<T>::name`); variant alternative names come from PSIO `get_type_name` |
| `psio1::reflect<…>` used directly | 42 / 9 (`dispatch.hpp`, `Actor.hpp`, `Table.hpp`, `schema.hpp`, `serveGraphQL.hpp`, `serveActionTemplates.hpp`, tester) | `psio::reflect<T>` |
| `MemberPtrType`, `TypeList`, `apply_members`, `for_each_member`, `member_function_names`, `FixedString` | 24 / 6 | `psio::reflect<T>::for_each_field` / `for_each_method`, `psio::method_traits` |
| `PSIBASE_REFLECT_TABLES` 80, `…_HISTORY_EVENTS` 15, `…_KEY_TRANSFORM` 7, `…_MERKLE_EVENTS` 2 | 104 / 67 | psibase's own macros; they stay, re-implemented over `psio::reflect` |
| `psibase/dispatch.hpp` + `PSIBASE_DISPATCH` | 80 / 79 | dispatcher over `reflect<Svc>::invoke_method` / `index_of_method_hash` |
| `Actor<>` / `at<>` | 30 / 10 | `psio::reflect<Svc>::proxy<P>` (`P::call<I, &Svc::m>(args...)`) |
| Events (`EventEmitter`, `emit()`) | 39 / 8 | same proxy mechanism over the event structs |
| ADL hooks `psio_unwrap_packable` 14/6, `psio_validate_packable` 5/3, `psio_custom_schema` 4/4, `use_json_string_for_gql` 5/5, `get_gql_name` 3/2 | | adapters (`PSIO_ADAPTER`), bounded wrappers; see G3, G4 |

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
| 2 | Records of `libraries/psibase/common` (`block.hpp`, `nativeTables.hpp`, `trace.hpp`, `Rpc.hpp`, `SocketInfo.hpp`, `Memo.hpp`, `crypto.hpp`, `package.hpp`, …), `libraries/net`, `programs/*`: `PSIO1_REFLECT` → `PSIO_REFLECT`. Glue grows: `psio::utf8_string` / `bounded` packed as their legacy forms; text adapters on non-records once G3/G4 are settled. | unchanged | glue tests + existing |
| 3 | Service declarations by package group (`packages/local`, `system`, `user`, `psibase_tests`): `PSIO_REFLECT` with `method(...)` + `PSIO_INTERFACE`. Glue grows: methods bridged into `psio1::reflect` (`member_functions`, names, hashed-name check). | unchanged | existing service tests |
| 4 | Reflection consumers read `psio::reflect` directly: `dispatch.hpp`, `Actor.hpp`, events, `Table.hpp`, `serveActionTemplates.hpp`, `servePackAction.hpp`, tester. After this nothing outside `psio1` names `psio1::reflect`. | unchanged | existing |
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

1. every type that crosses the wire declared with PSIO in C++ (slices 2–3) and
   derivable with PSIO in Rust (slice 5);
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
| D7 | `allowHashedMethods()` has no PSIO keyword. The check "every method name compresses unless the service opts out" moves into psibase's dispatcher, as a `static_assert` over `reflect<Svc>::method_names`. | — |
| D8 | `KeyView` (pre-encoded key prefix) has no PSIO type; psibase keeps a small own type that concatenates bytes with `psio::to_key` output. | — |
| D9 | `psio1::finally` is not serialization; it needs a home in psibase. | — |
| D10 | Rust code that only exchanges JSON over HTTP: keep serde with I-JSON-conforming impls for psibase types, or move to `psio::JsonText`. | — |
| D11 | Rust acquisition of PSIO: Cargo `git` dependency pinned to the CMake pin's commit (and a check that the two agree). | — |
| D12 | JS: keep server-side pack endpoints, or pack in the client with PSIO's JS package and the service's Schema IR. | — |
| D13 | PSIO's `-Werror=unused-result` (an INTERFACE option of `psio::psio`) now applies to every psibase native target. The tree builds clean with it. | Accepted. |
| D14 | `psio1` now requires PSIO headers and C++23 everywhere it is compiled (also `rust/test_fracpack`, previously `gnu++2a`). | Accepted (temporary). |
| D15 | `tests/cmake/dependencies/README.md` was rewritten where it described PSIO as dormant. | — |

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
