# Team review log — PSSZ / PSIO conversion

Things the team should look at and give feedback on. Maintained by the conversion session; newest
decisions are folded into the relevant item. Status values: **OPEN** (needs team input),
**DECIDED-BY-DAN** (owner decided; team should know / may object), **DONE-ON-BRANCH** (already
changed on `claude/pssz`, not yet in `bytemaster/head`), **INFO**.

Where the detail lives:
- Conversion log and decisions D1–D43, PSIO gaps: `doc/pssz-conversion.md` on branch `claude/pssz`
- Size/string caps proposal: `~/psibase-pssz-audit/v2/{summary.md,caps.md,caps.json}`
- Trust audit (584 decode sites): `~/psibase-pssz-audit/trust/sites.md`
- PSIO docs: `docs/annotations.md`, `docs/tutorial-annotations.md`, `docs/annotations-for-agents.md`,
  `docs/pssz-spec.md` in gofractally/psio

Last updated: 2026-11-23

---

## 0. Hand-over plan (owner, 2026-11-22)

Owner: "I want to rapidly get to a point where we have old psio1 removed, and everything working with
the new psio... then I can hand it over to the team to refine." So the flip is being done now for
speed, with these deliberate shortcuts that the team is expected to refine afterwards:

| # | Shortcut taken for speed | What the team refines later |
|---|---|---|
| 0.1 | **No size caps applied** (inferred widths only; `Memo` is the one bounded type). | Apply/adjust the caps in `~/psibase-pssz-audit/v2/caps.json` (§6). This changes bytes again. |
| 0.1a | Consequence of 0.1 the team must act on BEFORE anything is published as a real chain: a record or action whose members are all bounded gets a narrow inferred width (1 or 2 bytes), and then an unbounded optional field cannot be added later — it would change the width and is refused by the compatibility check (e.g. `(int32)` → `(int32, optional<vector<u64>>)`). Any type expected to grow must declare `maxDynamicData` from its first publication. This is the settled PSSZ design, not a bug. | Decide caps per type (§6) before launch. |
| 0.2 | **Trust = parity with today**: validate where the old code validated, trusted where it used `prevalidated`. | Apply the trust rule properly (§4): own table rows trusted (big win in Rust), foreign reads validated (adds checks in C++). |
| 0.3 | Binary wire, schemas, keys, JSON (I-JSON) and GraphQL all change in one push, because deleting `psio1` requires all of them. | Front ends, plugins and external clients are **not covered by the test suite** and may need updating for the JSON/GraphQL forms (§8). |
| 0.4 | C++ and Rust flipped in parallel in two worktrees, then merged and debugged together. | Review the merged result; the six unbuilt Rust packages and the plugins are only compile-checked (§9). |
| 0.5 | Transfer `data` argument (§7) NOT added in the flip. | Token-service design change, separate. |

## 1. Naming and conventions

| # | Item | Status |
|---|---|---|
| 1.1 | **Casing rule.** Rust `snake_case` ↔ C++ `camelCase` is bridged by a blanket `rename_all` rule. Kept as is for now. Should Rust mirrors use the authority's exact spelling instead, or keep one systematic rule? | OPEN (team discussion) |
| 1.2 | **Naming authority.** The language a type was originally written in is the authority; mirrors in other languages rename structs/fields/variants/parameters to match. Rename annotations only for externally imposed names. Where a reflected name differs from the declared one, the declaration is changed to the more meaningful name. | DECIDED-BY-DAN |
| 1.3 | `AuthDelegate::getOwner` / `checkOwner`: C++ declared `account`, reflected `owner`. Parameter being renamed to `owner`. | DECIDED-BY-DAN |
| 1.4 | Consensus variants: C++ JSON says `CftConsensus`, Rust says `CFT` (they disagree today). Rust variants are being renamed to the C++ names. | DECIDED-BY-DAN (C++ is authority) |
| 1.5 | Rust mirrors found with different names from C++: `Accounts` (`num` vs `name`), `Nft` (`debitor` vs `receiver`), tokens `SharedBalance` wrapper (no `shared_bal_id`). A full list is being produced by the cross-check. Confirm which side is right for each. | OPEN |
| 1.6 | Per-field renames that exist today (not the blanket rule): list being produced. Each should be justified by an external standard or removed. | OPEN |
| 1.8 | **Action parameter names differ between a Rust service and its C++ mirror header in 60 places** (tokens `token_id` vs `tokenId`, nft `debitor` vs `receiver`, symbol `symbol` vs `newSymbol`, …; list in `doc/pssz-conversion.md` §6.22), and Rust views of C++ services differ too (accounts `num` vs `name`, producers `prods` vs `producers`). The binary is unaffected, but JSON action arguments are keyed by parameter name, so the wrong side's JSON is rejected. Being fixed by renaming the MIRROR to the implementing language's names. | DONE-ON-BRANCH (in progress) — review the list |
| 1.9 | Rust parameters written `_flags`, `_sender`, `_socket` (unused) are literally the public JSON names today (auth-dyn, auth-rcovr, credential, vserver). Being renamed to the plain names; this changes those JSON argument names. | DECIDED (coordinator) — team may object |
| 1.10 | Variant alternative labels in schemas: C++ labels alternatives "0","1" plus a JSON name; Rust labels by variant identifier, so schemas of the same variant built in the two languages are not equal. Cross-language comparison uses bytes-only mode until PSIO has one rule. | OPEN (PSIO) |
| 1.11 | C++ reflections that leave a parameter unnamed or misnamed (so its JSON name is `c0`/`c2` or wrong): `Packages::setSchema` (one parameter reflected as two names → called `account`), `Packages::getSchema`, `XAdmin::isAdmin` (`forwardedFor`), `serveSys` in XPackages/Explorer/REvents (`socket`, `user`), `AuthInterface::getDlgsSys` (`method`); and `XAdmin`, `RSetCode`, `GetUser`, `CookieProbe` reflect `req` where every other service says `request`. Four are being fixed on the C++ flip branch; the rest are listed in `doc/pssz-conversion.md` §6.22. | OPEN — confirm names |
| 1.12 | `AuthDelegate::getOwner(owner)`: the parameter is really the account being looked up; `owner` reads wrong. The declaration was renamed to match the reflection; recommend renaming both to `account`. | OPEN |
| 1.13 | Casing facts for the team discussion (1.1): there is no crate-level rule today. `rust/psibase` spells mirrored members as C++ does; `#[serde(rename_all = "camelCase")]` is on 65 types in 24 files; 21 per-member renames sit in 14 files. Mirror TYPE names also differ (`NftHolderRecord`, `TokenRecord`, `SymbolRecord`, `Holder`, `TokensInitRecord`). | INFO |
| 1.7 | Interface names: a service is known by its account in both languages; PSIO defaults to the class/trait name. Account name used so far. Events interfaces not generated until naming is decided. | OPEN (D43) |

## 2. Fields present in a struct but absent from its reflection

Owner's note: an omission can be intentional — a type is unpacked and then annotated with extra,
unserialized fields (e.g. for optimisation), or a field is left out as a version migration with
backward compatibility assumed; such fields do no harm. So these are **questions of intent, not
presumed bugs**. The owner reviewed the readings below (2026-11-22: "your read on each case is accurate,
apply it as you judge and the team can correct it if you are wrong"), so 2.3, 2.4 and 2.5 are being
fixed on the branch and 2.1, 2.2 are left as they are — **team: please confirm or correct each**. Each was traced through the code and `git log`
(by reading; none was confirmed by a test). All five predate the conversion.

### 2.1 `GQLUrl.refcount` — intentional (no action) — LEFT AS IS
`packages/local/XPeers/src/XPeers.cpp` ~518. A GraphQL result type built from `UrlRow`
(`GQLUrl{row.url, row.refcount}`). `refcount` is working state used only to compute the reflected
method `connected()` (`refcount != 0`); the raw count is deliberately not exposed. This is exactly
the "unpack, then carry extra state" pattern. `UrlRow` itself does reflect `refcount`.

### 2.2 `WasmConfigRow.maxHandles` — looks like a deliberate deferral — LEFT AS IS (comment added); question OPEN
`libraries/psibase/common/include/psibase/nativeTables.hpp` ~73; added 2025-09-16 (`afc35228d`,
"Convert database access to use subtree handles") with a default of 64, never reflected. The row is
written only from the block header's `BlockHeaderWasmConfig` (`headerValidation.hpp` ~112), which
has no such field, and read by the node to cap open handles (`NativeFunctions.cpp` ~712–752).
So today it is a compile-time constant (64) riding on the config struct: not on chain, not in
consensus, not configurable. Reading: the limit was added without changing the consensus-visible
row/header format (a format migration avoided). **Question for the team:** should `maxHandles`
become a real, chain-configurable setting (then it belongs in the row AND in
`BlockHeaderWasmConfig`, as an appended optional), or stay a node constant (then it would be clearer
as a named constant than as an unreflected member)? Note: every node must agree on the value, since
exceeding it aborts the action.

### 2.3 `SiteConfig.proxy` — looks like an oversight — BEING FIXED ON BRANCH (added to the reflection)
`packages/user/Sites/src/Sites.cpp` ~825–833; added 2025-10-08 (`3a8ce157c`, "add set/clear proxy
actions to sites"). `SiteConfig` is the GraphQL result of `getConfig`; the query fills
`.proxy = record.proxyAccount ? … : ""` (~line 853) but the reflection is
`PSIO_REFLECT(SiteConfig, account, spa, cache, globalCsp)`, so the value that was just computed can
never be queried. The table row (`SiteConfigRow.proxyAccount`) is reflected and stored correctly;
only the query output is affected. Computing a field solely to drop it has no optimisation value,
so this reads as "struct updated, reflection line missed". **Question:** should clients be able to
read a site's proxy through `getConfig`? If yes, add `proxy` to the reflection (GraphQL/JSON only;
no stored data changes).

### 2.4 staged-tx `Response.seq` — stale C++ mirror — BEING FIXED ON BRANCH (added to the C++ reflection)
The service is implemented in Rust (`packages/system/StagedTx/service/src/db.rs` ~73), so Rust is
the authority; the row stores `id, account, seq, accepted` and uses `seq` to invalidate approvals
when an account's auth changes. `f70782cad` (2026-05-20, "Automatically invalidate staged-tx
approvals…") added `seq` to the Rust row and added the member to the C++ mirror struct
(`service/cpp/include/services/system/StagedTx.hpp` ~25) **but did not add it to the C++
reflection** (`PSIO_REFLECT(Response, id, account, accepted)`). A C++ reader of this table would
therefore misread rows: with three reflected fields it would take `accepted` from where `seq` is
stored. I found no C++ code that reads `ResponseTable` today, so nothing is currently wrong at run
time — it is a trap for the next C++ user, and the C++ schema for the type is wrong. Not a
compatible migration: `seq` sits in the middle of the record, not appended as an optional.
**Recommended:** add `seq` to the C++ reflection in member order (mirror follows authority).

### 2.5 `CodeRefCountRow.numRefs` — very likely unintended; code is never garbage-collected — BEING FIXED ON BRANCH (count persisted; test added)
`packages/system/SetCode/include/services/system/SetCode.hpp` ~7–19 (same code duplicated in
`packages/local/XAdmin/src/XAdmin.cpp` ~32–46). The row was created 2025-02-26 (`e764493f2`, "Move
code ref count out of native"); before that the count lived in a native object whose `numRefs` was
stored. From the first commit the reflection has been `codeHash, vmType, vmVersion` — the count,
which is the row's whole purpose, is not serialized. Consequences, by reading `SetCode.cpp` ~12–45:
- `incrementRefCount` reads the row (count decodes as 0), increments to 1, stores, and returns
  `count.numRefs > 1` → always `false`, so callers always (re)store the code blob. Harmless.
- `decrementRefCount` reads the row (count 0), `--` wraps to 0xFFFFFFFF, which is non-zero, so it
  re-puts the row and **never removes it or erases the code from `codeByHash`**.
Net effect: once uploaded, a code blob is never deleted, even when no account references it. It
fails in the safe direction (code is never deleted while in use) but state only grows, and the
"Missing reference count" / overflow checks can never fire meaningfully. I found no test that
exercises the count. This does not look like a migration: there is no older serialized form of this
row that had the field, and an intentionally unpersisted counter would not be incremented and
checked for overflow. **Question:** intended? If not, add `numRefs` to the reflection — which
changes the stored row, so existing chains would need the counts rebuilt (count the accounts that
reference each code hash); with no live chain it is simply a fix.

### 2.6 ZIP layout tails — intentional (info)
The ZIP record structs omit their variable tails on purpose; they describe fixed headers.

### Method of the audit / what is not covered
The caps proposal agent compared struct members with reflected members across C++ and found only
the five above; a second, scripted pass over every `PSIO_REFLECT` and Rust derive is running now and
its additions will be listed here. Rust `#[serde(skip)]`/`#[psio(skip)]` members are intentional by
construction and are not listed.

## 3. Existing bugs found along the way (independent of the conversion)

| # | Item | Status |
|---|---|---|
| 3.1 | `RTransact.cpp` `parseBody`: result of the validating decode was discarded (malformed binary body used unchecked, e.g. `/login`); JSON branch passed another container's iterator as insert position (UB); packed transaction on the JSON path read through views without validation. | DONE-ON-BRANCH (`d208308ab`) — please review |
| 3.2 | Snapshot import (`programs/snapshot/load-snapshot.cpp` ~342–360): block-log, block-proof and subjective rows inserted from the file with no validation (`// TODO: validation`), outside checksum/signatures; table number unchecked. | OPEN — not fixed |
| 3.3 | Typed `kvGet<V>` (`api.hpp` ~557–653) decodes unchecked over any handle. Only test services call it. | OPEN |
| 3.4 | C++ and Rust compute different method numbers for names whose compressed code overflows (`getSymbolType`, `checkFirstAuth`, `removeCallback`, `cpu_min_unit`, `get_resources`, …): C++ truncated, Rust hashed. | DECIDED-BY-DAN: round-trip or hash (Rust's rule). Changes 8 C++ `method(` numbers and 2 Rust ones; list in `~/psio-consistency-logs/name-blast-radius.txt` |
| 3.5 | `Decimal::fromStr` (C++) and `Quantity::from_str` (Rust) silently wrapped on overflow. | DONE-ON-BRANCH — now rejected |
| 3.6 | Rust decimal parsers counted fraction digits in a `u8` (256 fraction digits misread). | DONE-ON-BRANCH — beyond what was asked; easy to revert |
| 3.7 | Rust `account_number_from_str("alice+")` panicked; now returns 0. | DONE-ON-BRANCH |
| 3.8 | Stale Rust mirrors that were wrong on the wire: `ConfigRow` (no `maxBlockSize`), `LogMessage` (member order), `SocketInfo` (4 alternatives vs 6), `SignedBlock` (no `auxConsensusData`), `NotifyRow` (JSON name, key). `SocketInfo` and `SignedBlock` corrections have no test. | DONE-ON-BRANCH — please review |
| 3.9 | `EventEmitter::from(sender)` calls a constructor that does not exist (compiles only because unused). | OPEN — delete or add the constructor |
| 3.13 | `SetCode` / `XAdmin` code reference counts are never persisted (`CodeRefCountRow.numRefs` is not reflected), so unreferenced code is never erased. See §2.5. | OPEN — very likely unintended |
| 3.14 | C++ mirror of staged-tx `Response` is stale (`seq` in the struct, not in the reflection). See §2.4. | OPEN — recommended fix: add to the reflection |
| 3.15 | `SetCode::setCodeStaged` returns early without dropping the staged row's code reference (reference leak). Reported by the conversion agent; not fixed. | OPEN |
| 3.16 | Five plugin crates fail `cargo check` on a generated `bindings.rs`, before and after the conversion work. | OPEN |
| 3.10 | psitri: intermittent `reference count exceeded limits` on node restart (double release earlier in the node). Not reproduced on the current head; storage session is adding an always-on check. | INFO (storage session owns it) |
| 3.11 | Name coder: `x--b` compressed to a number that decoded to different text. | DONE in PSIO (now 0) |
| 3.12 | Two methods of one service with the same method number: C++ silently made the second unreachable. Now a compile error in C++ and Rust. | DONE-ON-BRANCH |

## 4. Trust model (validate vs trusted decode)

Rule from the owner: a service's own table rows are trusted on read; action arguments, cross-service data
and anything from outside are validated.

| # | Item | Status |
|---|---|---|
| 4.1 | Is a sub-account service (`X+1`, `X+2`) the same trust domain as `X`? Covers 51 read sites. Proposed: treat as foreign unless guaranteed same code. | OPEN |
| 4.2 | Should native reject malformed notify / run / timer rows when written (removes a per-transaction check on read)? Proposed: yes. | OPEN |
| 4.3 | Today Rust validates every table row read (≈343 sites, 31 crates); C++ validates none, including reads of other services' tables. The flip moves both to "own = trusted, foreign = validated", decided in the table layer. | INFO — review the approach |
| 4.4 | Exchange, BtcBridge and EthBridge query code opens unrelated services' tables directly (`KvHandle::open_direct`). | OPEN — intended? |
| 4.5 | 13 places build a view straight over a byte span; the old view validated on construction, PSIO's does not. Each needs an explicit validate or a choke point. | INFO (handled at the flip) |
| 4.6 | Trusted decode skips type invariants (`Memo`, `Precision`, `DbId`): a service's own bad write is not caught on read. | OPEN — acceptable? |
| 4.7 | Packed members (transactions inside blocks): `nested<T>` (validated with its parent) vs a shared packed buffer. | OPEN |

## 5. Wire format decisions the team should know (PSSZ)

All DECIDED-BY-DAN unless marked. Spec: `docs/pssz-spec.md`.

- Offset width is part of the type: explicit cap rules, else the inferred bound, rounded to 1/2/4 bytes. Every type with offsets (records, tuples, lists, maps) uses its own width; bounded lists get narrow tables.
- A record's explicit cap narrows the containers beneath it; a nested record keeps its own width (same record type, same bytes everywhere).
- Fields added after publication must be `optional<T>`, appended; trailing None is pruned; one encoding per value. A bound may only widen; adding a field must not change the width — reserve headroom with `maxDynamicData`.
- Tuples, argument lists and records: at most 255 fields. `maxFields(N)` is an enforced field-count cap.
- Bounds are annotations on ordinary types (`attr(tags, max<8> | element(utf8 | max<16>))`), not wrapper types; wrapper types are opt-in and byte-identical.
- Strings: `std::string` / Rust `RawString` are raw bytes; utf8 strings / Rust `String` are validated text.
- Enums are their underlying integer; only adding enumerators must stay compatible.
- `frac` in PSIO is `psio::experimental` (a benchmark of size-per-field vs offset design), not psibase's fracpack.
- OPEN: record/tuple header as a 1-byte slot count instead of the fixed-region size (saves 1–3 bytes per extensible record, changes almost every fixture).
- OPEN: `sorted` / `unique` constraints are typed-only, not in the schema.
- OPEN: should the compatibility check reject a renamed field (JS does, C++ does not)?

## 6. Size caps and string kinds (best estimates, applied without waiting for review)

Proposal in `~/psibase-pssz-audit/v2/`. Every cap carries a one-line reason comment in the source.

| # | Item | Status |
|---|---|---|
| 6.1 | 161 member/parameter bounds and 84 type-level caps have **no limit enforced today** (new rules). Listed in `summary.md` §3. Please review for anything that could reject real data. | OPEN |
| 6.2 | Signature bound 8192 / claim key 4096 in the proposal would exclude SLH-DSA. Being widened when applied. What should the limits be? | OPEN |
| 6.3 | `Quantity`, `Decimal` (and `ServiceMethod`, `VMOptions`, `StateChecksum`, `TransactionInfo`, `BlockHeaderAuthAccount`) are not marked never-changing, so each costs a header + offset where it is a member. Mark `definitionWillNotChange()`? | OPEN |
| 6.4 | Registry icons / Profiles avatars stay 32-bit; a ~32 KiB limit would make Registry 16-bit. | OPEN |
| 6.5 | Raw vs UTF-8: 21 Rust `String` fields become raw (HTTP targets, paths, header values, env values, console/error text); 33 C++ strings gain `utf8`. `HttpRequest::method` and `LogMessage::message` as utf8 could reject input accepted today. | OPEN |
| 6.6 | `SubjectPublicKeyInfo`: opaque bytes on the wire; `AuthSig::setKey` / `newAccount` call the key check explicitly (signature verification already parses the key itself). | OPEN (D26) |
| 6.7 | C++ byte data is `std::vector<char>` in 446 places; PSIO's schema distinguishes it from `vector<uint8_t>` (bytes identical). Proposed: PSIO treats both as one schema node. | OPEN (D41 / RG14) |
| 6.8 | Unreflected C++ enums are plain integers; reflecting one gives it names in JSON. Per-enum choice at the flip. | OPEN (D40) |

## 7. Token transfer: memo and data

| # | Item | Status |
|---|---|---|
| 7.1 | `Memo` is a first-class type: human-readable UTF-8, max 80 **bytes**, everywhere. | DECIDED-BY-DAN |
| 7.2 | Transfer-like actions get a trailing raw-bytes `data` argument with no bound of its own; the argument list is capped at 255 so every offset is one byte (232 bytes shared by memo + data; 151 for data beside a full memo). | DECIDED-BY-DAN |
| 7.3 | Every memo ends in a history event; under a 255 cap `balChanged` leaves 189 bytes for memo + data. Let the event set the limit, or cap those events at 16-bit and keep the action 8-bit? | OPEN |
| 7.4 | Which actions/events carry `data` (transfer, credit, …)? Design sheet in the caps summary. | OPEN |

## 8. JSON and GraphQL changes at the flip

| # | Item | Status |
|---|---|---|
| 8.1 | JSON becomes I-JSON (RFC 7493): 64-bit ints bare if |n| ≤ 2^53−1 else decimal strings; bytes hex; variants `{"Name": value}`; tuples arrays; enums by name; 128/256-bit ints decimal strings; duplicate keys last-wins. | DECIDED-BY-DAN — clients must be checked |
| 8.2 | Action arguments in JSON: object keyed by parameter name (array also accepted). | DECIDED-BY-DAN |
| 8.3 | A missing required member is an error (missing optional = None). `PsinodeConfig`, `loggers::Config` etc. rely on lenient parsing today: members that may be absent must become `optional`. | OPEN — which members? |
| 8.11 | The method-name codec may change AGAIN: branch `codex/action-name-encoding` (reviewed by session psibase-6a; a new 64-bit action/event/reflected-name codec) is scheduled after the PSSZ merge. The flip already changed ten method numbers; adopting the new codec renumbers again. Decide soon so clients adapt once; it should live in the PSIO repo (psibase account coding stays in psibase). | OPEN |
| 8.4 | Time values: Rust writes `…+00:00` via chrono, durations as `{"value":5}`, GraphQL scalars `TimePointSec`/`TimePointUSec`; PSIO has its own text forms and per-unit GraphQL names (`DateTimeSeconds`, …). Changes at the flip. | OPEN — client impact |
| 8.5 | `Decimal`, `Memo`, `Precision` become custom types in schemas at the flip. | INFO (D25) |
| 8.6 | `IPAddress` / `SocketEndpoint` text forms. | OPEN |
| 8.7 | GraphQL: move to the PSIO engine (4–8.5× faster with a reused plan; slower for one tiny object without plan reuse). `uint32` → `Int` or `UInt32`? Rust keeps `async-graphql`? | OPEN |
| 8.10 | GraphQL client-visible differences on the PSIO engine: `startCursor`/`endCursor` are nullable (`null` on an empty page, not `""`); `first` together with `last` is a field error; cursors are hex of the key bytes (event-query cursors were decimal row ids); a reflected class template instantiation is named `Foo_X` (was `Foo`) unless overridden; an empty record is `{ _: Boolean }`; the byte budget (`maxBytes`) counts stored row bytes, as today. | OPEN — check front ends |
| 8.9 | Method names that do not compress take the hash path and are then **case-sensitive**: wherever such a name appears in JSON (boot/postinstall files, clients) it must be spelled exactly as declared (`regEvIdx`, not `regevidx`). One boot file was already wrong. | INFO — check clients |
| 8.8 | AccountNumber strict text (D2); MethodNumber `set_code`/`setqcode` quirk (D3); enforce "method names must compress"? | OPEN |

## 9. Test coverage gaps

| # | Item | Status |
|---|---|---|
| 9.1 | Six Rust packages are never compiled by the build: BtcBridge, BtcRelay, EthBridge, EthRelay, Exchange, Signing. Only `cargo check`ed. | OPEN |
| 9.2 | Plugins are built but never run by any test, yet they do the client-side packing (125 pack calls). | OPEN |
| 9.3 | `demo/` and the XAdmin wasm helper are not built by the suite. | OPEN |
| 9.4 | Python test harness (`programs/psinode/tests/fracpack.py`, 15 tests): replace with PSIO's Python package, or pack through the node's endpoints? | OPEN |
| 9.5 | No JS is run by ctest. | INFO |

## 10. PSIO library (gofractally/psio)

| # | Item | Status |
|---|---|---|
| 10.1 | No LICENSE file in the repo (manifests say MIT). | OPEN |
| 10.2 | Rust crate is unpublished; services built outside the tree need a source for it. Publish? | OPEN |
| 10.3 | Python package added (`python/`), pure Python, same fixtures. Tested on 3.14 only. | INFO — review the API |
| 10.4 | JS: `nameToNumber` used to be the method coder; it is now the identifier coder (`methodToNumber` is the method coder). psibase account numbers use psibase's own coding, not this. | INFO |
| 10.5 | pjson has no friendly helpers; needs a format tag and a byte-type choice (`uint8_t` vs `char`). | OPEN |
| 10.6 | **psio lineages** (inventory: `psio-lineage-inventory.md`, 1,012 lines). There are three generations: v1 = `psiserve/libraries/psio1` (fracpack-centred, views with NAMED readers, `frac_ref`, ports in Go/Zig/MoonBit/JS/Python); the psio3 rewrite (2026-04-24) = `psiserve/libraries/psio`; and the standalone gofractally/psio, seeded from that rewrite. The rewrite shipped views with only `get<N>()` and the comment "per-field accessors … lands in a follow-up" — the follow-up never came, although the rewrite's own design record (`psiserve/.issues/psio-v2-design.md` §10, `psio-language-principles.md`: "Views mimic natural type access") requires them; being restored now. The psiserve REMOTE has already deleted its in-tree copy in favour of `external/psio`; the local `~/psiserve` checkout is stale (1 ahead / 4 behind). | INFO + the open items below |
| 10.6a | What psiserve needs from the one psio before it is fully migrated (10-step checklist, inventory §6.3): named views (in flight); WIT generators emit `std::expected<T,E>` as plain `T` instead of `result<>` (live bug for psiserve's `psi/db.hpp`); canonical-ABI glue in psizam; resources needing an extra `PSIO_INTERFACE` declaration; a byte-reading cursor (`dwarf.cpp`, ~400 call sites); golden `.wasm` files and WIT tests not carried over; `psi/service.hpp` on PSSZ. | OPEN |
| 10.6b | **pfs and `.pzam` storage format**: move to PSSZ, or keep fracpack (then fracpack leaves `experimental` and needs views). PSIO's experimental frac is not byte-compatible with existing fracpack data. | OPEN — gates psiserve |
| 10.6c | In-place size-changing mutation (`frac_ref`): the old implementation is unsound around optionals (invalid buffers; a crash when setting an absent trailing optional; its tests cover only the no-optional case). Retire for good, or redesign as "re-encode the smallest enclosing value"? | OPEN — do not port as is |
| 10.6d | Work stranded in secondary psiserve checkouts: `psiserve-agent2` main (also remote branches `backup/main-pre-psio-rename`, 37 commits ahead of main, and `feature/runtime-migration`) has tuple views with structured bindings, `vec_view::as_span()`, a 3-argument `PSIO_PACKAGE`; `psi/service.hpp` on psiserve main depends on that and probably does not build; `psiserve-agent3` has a stash with pjson_typed work. | OPEN — someone should decide what to rescue |
| 10.6e | Ports in the old lineage: Go, Zig and MoonBit disagree with the old C++ on the wire (nested fixed struct 26 bytes inline vs 30 behind an offset) and target fracpack. Drop them (recommended), or redo for PSSZ? | OPEN |
| 10.6f | **Cap'n Proto and FlatBuffers must be first-class in the one psio (owner, 2026-11-23: "psio needs first class FlatBuffer and Cap'n Proto so the library can claim a non-compromise").** The work exists in `psiserve/libraries/psio1`: `capnp_view.hpp` (3,989 lines: view/pack/unpack/validate/mutate, 74 tests), `flatbuf.hpp` (3,033 lines: builder, views, mutation, verify, unions), `.capnp`/`.fbs` parsers with computed wire layouts, `dynamic_view` (by-name navigation of foreign data), `psio-tool` CLI, and benchmarks behind the claims "reads Cap'n Proto 10–36× faster than the official library" and FlatBuffers pack at parity/1.3×. The standalone C++ has only minimal codecs for these two (its Rust still has the full views); it does have protobuf encode/decode and schema emitters/parsers for capnp/fbs/proto/WIT from the Schema IR. Planned as the first follow-on track after the flip: port the v1 work onto the current view frame, keep Rust at parity, re-measure the speed claims. Not started; must not be dropped. | DECIDED-BY-DAN — follow-on track |
| 10.6g | Is "fastest" a release gate? PSIO's own comparison shows PSSZ behind ssz/borsh/bincode by 15–20% on some shapes and well behind fracpack on nested extensible decode. | OPEN |
| 10.6h | Two contradictions inside the PSSZ spec: §4.1 says accept any non-zero bool but the code rejects; §7.1 gives appended non-optional fields defaults but §7.2/§7.5 forbid them. Being fixed to match the settled rules (bools are 0/1; new fields are optional). | INFO |
| 10.6i | Design decisions recorded only in psiserve's `.issues/` (psio-v2-design.md, psio-language-principles.md) are not in the PSIO repo; `@final`/`@canonical` became reserved no-ops; WIT is emit-only (no WIT → Schema IR path); a missing `psio-tool` CLI; no typed zero-copy spans over an mmap'd file; no `dynamic_view` for PSSZ. | OPEN — which to bring over |
| 10.7 | Raw `std::string` emits WIT `string` (utf8 strings too); by the bytes-vs-text rule raw should be `list<u8>`, which changes every `std::string` in every interface. | OPEN |
| 10.13 | Schema IR has no canonical normal form: the same type declared by annotation, by wrapper type, or in another language yields equal but differently interned/numbered nodes (and Rust `String` vs C++ `std::string` + `utf8` vs `utf8_string<>` differ in spelling). Schemas are therefore compared with `equivalent`/`evolves_from`, not by bytes or hash. If schema hashes or byte-identical schemas across languages are wanted, PSIO needs a canonicalisation pass. Also: argument-list member attributes (`lengthBound`, `jsonInt`) are emitted by Rust but not C++; Python orders interface `types(...)` after funcs where C++ puts them before. | OPEN (PSIO) |
| 10.9 | Compatibility check and renamed fields: JS rejects a renamed field/alternative; C++, Rust and Python compare by position only (the binary carries no names, but JSON and schemas do). Options: (a) reject renames always, (b) reject unless annotated `renamed_from`, (c) ignore names and document it. Agent recommends (a). | OPEN |
| 10.10 | A lone C++ `char` member is one byte on the wire and a number in JSON, but WIT/capnp emit it as a character. Make it plain `u8` in the schema (recommended), keep as is, or make it a real Unicode character (wire change)? `std::vector<char>` is being unified with the byte-list schema node (no byte change). | OPEN |
| 10.11 | WIT emitter (C++ and JS) prints placeholders for interface argument lists and unnamed parameters; capnp/protobuf/fbs emitters have similar gaps. Matters if WIT output is used by psiserve. | OPEN |
| 10.12 | `sorted` / `unique` in the Schema IR: design note written (custom ids over the list node); not implemented. | OPEN (later round) |
| 10.8 | Remaining speed gaps: Rust decode of variable records (231 ns vs C++ 59), Rust `pssz_size`; PSSZ vs experimental frac roughly at parity on encode. | INFO |

## 11. Process / environment

- Integration line is `bytemaster/head` on gofractally/psibase; conversion work is on topic branch `claude/pssz`. Team `main` is untouched; the goal is to convince the team to adopt the head. | INFO
- The head needs binaryen ≥ 133 and psizam `63b2ee3`. | INFO
- The wire flip itself (C++ ~1,600 uses in 161 files, Rust 292 call sites, boot data regenerated) has not happened yet. | INFO

## 12. Flip results: behaviour changes the team will notice (C++ and Rust halves, 2026-11-23)

Sources: the C++ flip's final report (`doc/pssz-conversion.md` §1.17–1.25, `doc/flip-interop.md`) and the Rust flip's handover (§6.26). Status of all rows: DONE-ON-BRANCH, please review. The combined tree was still being merged and debugged when this was written.

**Binary and ids**
- Every packed byte, transaction id, block id and Merkle root changed (fracpack → PSSZ). Method numbers changed for ten names (see 3.4).
- A guest now refuses NON-CANONICAL actions and transactions, not only ones with unknown members. Dispatch errors read `invalid argument encoding for <method>: <reason>`.
- `SubjectPublicKeyInfo` is opaque DER on the wire, no longer parsed on unpack; `AuthSig::setKey` and `newAccount` check it themselves.
- Null packed values are `std::optional<shared_pssz<T>>` (`Table::getView`, `ForkDb::get`). Removed: `JsonHttpReply`, `MethodArgs.hpp`, `libraries/debug_eos_vm` (dead code).
- No key type in the C++ tree changed bytes.

**Strings**
- 83 C++ members/parameters are UTF-8 now. A non-UTF-8 `Host` or `Content-Type` gets HTTP 400. **OPEN:** a non-UTF-8 log message now fails the calling action and is not logged — drop, escape, or keep failing?

**Schemas**
- `ServiceSchema` is over the PSIO Schema IR; action/event maps ordered by name (were by method number); unnamed parameters are positional ("0", "1").
- `setSchema` is stricter: no offset width may move, and renames are refused. Packages holding a legacy schema do not load. Generated schema files are about four times larger.
- Events: a `float` query key is 4 bytes (was the double); wider-than-64-bit integers become JSON instead of an error.

**Method caps**
- `XProxy::onError` and `XPeers::errP2P` declare `maxDynamicData(0xffffffff)` so the optional argument can be appended; the one-argument form is still a different call. Four places read one declaration's bytes as another (e.g. `Transact.cpp:474` `getDlgsSys`, `tester.cpp:743` continuation token) — listed in `doc/pssz-conversion.md` §1.23, found by reading, none executed. **OPEN:** review and cap as needed (see 0.1a).

**JSON (I-JSON)**
- 64-bit integers are bare below 2^53; a QUOTED 8/16/32-bit number is refused. A missing required member is an error naming it; unknown members are skipped (`/pack_action` used to abort).
- `DbId` and `NewAccountMode` are written by name; a `NewAccountMode` above 2 is refused at dispatch.
- `SignedTransaction.transaction` is the inner object, not hex (`rpc.ts` changed). `SubjectPublicKeyInfo` JSON is PEM (armor and outer DER shape checked only).
- A seconds time point with a fraction, or a time without an offset, is refused. Account names are strict (Rust serde used to read "Alice" as 0).
- Now optional (real input omits them): `ShutdownRequest` restart/force/soft, `NewKeyRequest::device`, `UnlockKeyringRequest::pin`, `PsinodeServiceConfig::argv`, `service` in XAdmin's config view, `http_timeout`, `LogReaderConfig` filter/format. `ExtraConfigField` no longer turns JSON booleans into strings.
- `IPAddress` / `SocketEndpoint` are one text string in both languages. `meta.json` / package index entries need every member.
- Bytes are upper-case hex (unchanged from before).

**GraphQL**
- Scalars: `uint32` is `Int` (was `Float`); 64-bit is `UInt64`/`Int64`; bytes are `Bytes`; time is `DateTimeSeconds`/`DateTimeMicroseconds`; named scalars `AccountNumber`, `MethodNumber`, `Decimal`, `Memo`, `Precision`, `IPAddress`, `SocketEndpoint`. A quoted `Int` argument is refused. Input objects are `<T>Input`.
- Object, union, connection, edge and root type names are unchanged; no field or argument was renamed.
- `startCursor`/`endCursor` are `null` on an empty page; `first` with `last`, a bad cursor or a negative size is a field error; event cursors are 16 hex digits; marker types expose `_: Boolean`; errors carry `locations` and `path` with partial data. New: variables, named fragments, introspection; a complexity limit applies (Explorer raises it — PSIO gap G53: a connection's complexity counts the page size twice).
- Rust (async-graphql) side: bytes cannot be a GraphQL scalar (RG20) — eight objects and four `icon_hash` resolvers return hex text via field resolvers; `SignedTransaction` lost its GraphQL derives; digest type is `String` instead of scalar `Hex`.
- Rust clients of C++ GraphQL that had to change: Invite plugin (`inviteId` unquoted), Packages plugin and CLI (`endCursor` nullable), CLI empty query, Explorer plugin retry hides rejections.

**Bugs fixed during the flip (C++)**: a non-UTF-8 response `Content-Type` would have thrown out of a completion handler in `send_request.cpp` (now a failed read; `x-proxy` answers 502); `psinode/main.cpp` parsed the combined host/service document as `PsinodeConfig`; the IPv6 parser could not read back `"::"`, `"fe80::"`, `"::ffff:1.2.3.4"` that the printer writes; tester `getKey` did not strip the prefix of the handle a key was found through; `SimpleUI.mjs` sent the expiration in milliseconds and omitted `tapos.flags`.

**Hazard for future Rust code**: a bare `Vec<u8>` / `[u8; N]` handed to serde directly (outside a PSIO type) is a number array, not hex, and the compiler does not catch it.

**Not verified at the time of writing**: nothing had run on a booted chain with both halves; front ends (TypeScript, `SimpleUI.mjs`) compile but were not run in a browser; snapshot tools compile but were not run; `demo/` is not built; nine user-doc pages still describe the old formats; the Python test harness still had its legacy codec.

**Open PSIO items from the flip**: G52 — the only way to give a record a schema id is an invariant, and an invariant blocks mutable views (psibase sets a PSIO `detail` trait for `Action` as a stop-gap); G53 above; RG20 (GraphQL bytes scalar in Rust).

## 13. After both halves were merged and the integration head taken in (2026-11-23)

State: `claude/pssz` contains `bytemaster/head` 7fe3cda05; suite baseline is **88** (the earlier 90, minus four `DarwinCpu*` tests the head deleted, plus `plugin-web-crypto-tests` and `t-Tokens-test-one-pool-slot`). Details: `doc/pssz-conversion.md` §7 and §7.8.

| # | Item | Status |
|---|---|---|
| 13.1 | **Maximum transaction size fell to roughly 3.5–4.4 MB.** The guest's strict PSSZ check decodes and re-encodes the whole transaction; a 4.37 MB boot transaction exceeded Transact's 32 MiB memory. Fix belongs in PSIO (an in-place canonical check), in progress; psibase needs only a re-pin. | OPEN (PSIO) |
| 13.2 | An empty optional result is zero bytes on the wire; callers that tested "result present" by length must not. | INFO |
| 13.3 | `Actor.hpp` decodes a call result as the plain type rather than through PSIO's method-result declaration (`returns(...)`), and `returns(...)` does not reach the service schema (repro `psio_gap_result_node.cpp`). | OPEN (PSIO + psibase) |
| 13.4 | Variant alternative labels are derived by different rules in C++ and Rust; both sides were made to agree by hand where a type is shared. One rule should live in PSIO. | OPEN (PSIO) |
| 13.5 | Identifiers still named after the old format, not renamed: `psibase::fraccall` (`Actor.hpp`), `FracPackBody<T>` (tester, 18 uses; suggest `PsszBody`), `FracpackHttpReply<T>` (`Rpc.hpp`, unused; delete), `publicKeyPairToFracpack` / `signatureToFracpack` (`common-lib` exports, no users in tree, emit bytes nothing accepts; delete with their doc rows), `block.frac` (engine replay tests; engine owners' call). | OPEN — rename or delete |
| 13.6 | Doc pages left describing the old formats: `specifications/data-formats/fracpack.md` (+ `SUMMARY.md` entry), `schema.md` (legacy schema JSON, `"FracPack"` type), `js-libraries.md`, last paragraph of `rust-service/tables.md`, `Favor/README.md` history note. Needs a writer who knows the intended audience. | OPEN |
| 13.7 | `doc/verify-sig/` (the head's measurement record) uses `psio::to_frac`/`from_frac` and names `libraries/psio`; it describes the pre-migration tree and will not build against this one. Keep as a record or port. | OPEN |
| 13.8 | Exchange stores `Wide` as two `u64` limbs because the old format had no `u128`. PSSZ has one; switching is a storage-format change for that package. | OPEN — package owner |
| 13.9 | `psibase boot` exits 0 while the node is still applying ~100 boot transactions (~50 s); transactions pushed in that window are refused ("references non-existing block"). Not checked whether this predates the migration. | OPEN — confirm intended |
| 13.10 | Transact's HTTP 415 text now reads "Expected PSSZ encoded signed transaction". | INFO |
| 13.11 | `rust/psibase/src/from_bin.rs` / `to_bin.rs` are exported but have no callers; candidates for deletion. | OPEN |
| 13.12 | `programs/psinode/tests/name.py` now holds only the account coder; method names use PSIO's Python package. The MIT header that covered the removed arithmetic coder went with it. | INFO — say if the header must stay |
| 13.13 | Explorer raises the GraphQL complexity limit to 1,000,000 to work at all (PSIO G53 double-counts page size). | OPEN (PSIO) |
| 13.14 | Shutdown: tests and scripts must use `-TERM`; `kill -INT` did not stop the node cleanly in the end-to-end check. | OPEN — confirm intended |
| 13.15 | Not exercised by anyone: front ends and plugins in a browser, snapshot tools at run time, `demo/`, LLVM AOT backend with this tree, Linux x86-64, hidden `TransferBench` cases. | OPEN — test coverage |
