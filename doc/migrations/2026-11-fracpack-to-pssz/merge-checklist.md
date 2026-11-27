# Merging the C++ flip (`claude/pssz-flip-cpp`) into the Rust flip (`claude/pssz`)

**Done: `doc/migrations/2026-11-fracpack-to-pssz/pssz-conversion.md` section 7 records the merge, what each
step found and the state.** The temporary items of section 1 are removed;
the fixture has the additions listed there. This file is kept as the plan
that was followed.

For whoever does the merge. Both branches descend from `7ae0dde70`. Each
half works alone only up to the language boundary: in `claude/pssz` every
byte Rust writes, reads, keys, describes or prints as JSON is PSIO's while
the C++ beside it is still on the legacy formats; in `claude/pssz-flip-cpp`
it is the reverse. **The merge is the first time PSSZ, keys, schemas and
I-JSON cross between the two languages.** Nothing below was run on a merged
tree.

References: `doc/migrations/2026-11-fracpack-to-pssz/pssz-conversion.md` 6.26 (the Rust side: state, checks,
gaps), `doc/migrations/2026-11-fracpack-to-pssz/flip-interop.md` on the C++ branch (the contract: every format
that crosses the boundary), `doc/migrations/2026-11-fracpack-to-pssz/team-review.md`.

State when this was written: `claude/pssz` at the commit that adds this
file; `claude/pssz-flip-cpp` at `868ee42e2` ("S6: byte ranges, cursors and
the last bin users off psio1") with its pin move uncommitted. Recompute the
overlap before starting (section 2 has the command).

## 0. Before the merge

1. Both branches name the same PSIO commit in
   `cmake/PsibaseDependencies.cmake`, `tests/cmake/dependencies/CMakeLists.txt`
   and `tests/cmake/dependencies/README.md`
   (`f811c6f982fa62bbdcd77587f123d80cde983bdc` here). If they differ, move
   one first, as its own commit, and rebuild that branch.
2. `external/psio` in the build worktree is at that commit (the CMake
   check refuses to move an existing checkout: `git -C external/psio fetch
   && git -C external/psio checkout <hash>`, then `cmake <build dir>`).
3. Each branch passes its own checks: here the table "Verification" of
   6.26; there the C++ branch's own list.

## 1. Temporary items to remove at the merge

| Where | What | Remove / change |
|---|---|---|
| `rust/psibase/tests/psio_twins.rs`, `resolved()` | pass-through 1 and 2: a `Custom` with the id `Action` or `ServiceMethod` is read through on both sides (the C++ of this tree does not declare the ids) | delete the match arm; the C++ branch declares both ids (`PSIO_INVARIANT` in `block.hpp`, `nativeTables.hpp`) |
| `rust/psibase/tests/psio_twins.rs`, `resolved()` | pass-through 3: an `Enum` whose first enumerator is `keepExisting` (`NewAccountMode`) is read as its integer (the C++ of this tree declares a bare enum; the C++ branch `PSIO_REFLECT_ENUM`) | delete the match arm. If the C++ node is `Custom{Enum, …}` because of its `PSIO_INVARIANT`, compare under `resolved` and decide: Rust has no invariant id on an enum (its reader refuses other numbers by type) |
| `libraries/psibase/common/tests/rust-twins.json` | each value still has a `"frac"` member (legacy bytes, written by this tree's C++, no longer read by Rust) | gone when the fixture is regenerated from the merged `rust_twins.cpp` (the C++ branch stopped writing it) |
| `rust/psibase/tests/psio_twins.rs`, readings `RawInCpp` / `RawAndCharInCpp` | types whose C++ strings were raw when this tree's fixture was written; the C++ branch made 84 members UTF-8 (`45e2318d2`) | after regenerating, the test says per type "its strings are declared alike now": move each to `Same` (or `CharInCpp`) until it passes; what remains listed is a real difference |
| GraphQL hex resolvers (6.26, RG20) | eight objects expose a digest / byte member as hex text through `#[graphql(skip)]` + `#[ComplexObject]` | stays until PSIO offers a bytes scalar for Rust; not a merge item |

Not temporary, but to do once the C++ of the tree can produce them: add
to the twin fixture and to `psio_twins.rs` `DbId`, `NewAccountMode`,
`SubjectPublicKeyInfo`, `IPAddress`, `SocketEndpoint` (types and values:
schema node, PSSZ, key where they are keys, I-JSON), the argument records
of services declared in both languages beyond the 18 calls there now, a
boot transaction, and one package's `<Target>-schema.json`. The Rust halves
exist: `rust/psibase/tests/psio_json.rs` pins the texts by hand from the
C++ tests in `libraries/psibase/common/tests/json.cpp`.

## 2. Files both branches changed

```sh
git diff --name-only 7ae0dde70 claude/pssz | sort > /tmp/rust.txt
git diff --name-only 7ae0dde70 claude/pssz-flip-cpp | sort > /tmp/cpp.txt
comm -12 /tmp/rust.txt /tmp/cpp.txt
```

At the time of writing (about 390 paths here, 225 there) eleven overlap:

| Path | This branch | C++ branch | Resolution |
|---|---|---|---|
| `cmake/PsibaseDependencies.cmake` | pin | pin, and whatever the flip needed (the `psio1` targets, compile definitions) | take the C++ branch's file; check the pin line is the agreed hash |
| `tests/cmake/dependencies/CMakeLists.txt`, `tests/cmake/dependencies/README.md` | pin | pin | either; the agreed hash |
| `doc/migrations/2026-11-fracpack-to-pssz/pssz-conversion.md` | section 6 (Rust; 6.21–6.26) and the Rust rows of 2.7 | sections 1.17–1.22 and the C++ inventory | keep both: the sections are disjoint. Conflicts will be in the header list and section 0; take the C++ branch's text for sections 0–5 and this branch's for section 6 |
| `libraries/psibase/common/tests/rust_twins.cpp` | adds the `names` object: the methods of 24 services with the parameter names the reflection states (94 lines, the includes and one writer) | removes the `"frac"` member and `psio1`; packs a call as the tuple of the parameters' wire types (`wireTuple`) | take the C++ branch's version and re-apply this branch's `names` addition (`git diff 7ae0dde70 claude/pssz -- libraries/psibase/common/tests/rust_twins.cpp`); the two edits touch different functions. Then add the types of section 1 |
| `libraries/psibase/common/tests/rust-twins.json` | regenerated with `names` | regenerated with the custom ids and `utf8` | take neither: regenerate from the merged C++ (section 3, step 2) |
| `packages/user/Nft/include/services/user/Nft.hpp`, `…/Symbol.hpp`, `…/Tokens.hpp` | the Rust parameter names in the mirror headers (the same change as the C++ branch's `fa45a2128`) | that, plus `attr(…, utf8)` on string members and parameters | take the C++ branch's files. Then run the name cross-check (`rust_views_name_parameters_as_the_implementation_does`): it compares these headers' reflected names with the Rust services |
| `programs/psinode/tests/test_psibase.py` | `'services': []` in the test package's `meta.json` | the same line | identical; either |
| `packages/local/XAdmin/ui/wasm/Cargo.lock` | lock file after the dependency changes (`psio`, no `fracpack`) | one line, a build side effect | take this branch's; `cargo check` in that directory rewrites it if needed |

Paths that do not overlap textually but must agree (check each by hand):

* **`doc/migrations/2026-11-fracpack-to-pssz/flip-interop.md`** exists only on the C++ branch. Add to it what
  6.26 lists under "For flip-interop.md".
* **C++ mirror headers of Rust services** and **Rust mirrors of C++
  services** (`rust/psibase/src/services/*.rs`): the C++ branch may have
  changed a C++ service's signature, member type or string kind since
  `7ae0dde70`. `psio_twins` covers 24 services' parameter names and 18
  calls' bytes; everything else is covered only by running the services.
* **`packages/user/Nop/src/Nop-schema.json`**, **`doc/src/specifications/data-formats/schema-schema.json`**:
  rewritten by the C++ branch; Rust reads the first when it loads the
  `Nop` package and never the second.
* **`packages/user/CommonApi/…/rpc.ts`, `SimpleUI.mjs`**: changed by the
  C++ branch for the new `SignedTransaction` JSON and `tapos.flags`. Rust
  services serve `SimpleUI.mjs` too (`rust/psibase/src/serve_http.rs`
  `pack_action`: an object keyed by parameter name or the positional
  array, PSSZ out): same contract, not exercised.
* **`rust/CMakeLists.txt`, `rust/test_fracpack/`** (deleted here): if the
  C++ branch still names `test_fracpack` or `rust/fracpack` anywhere
  (`git grep -n fracpack -- '*.cmake' 'CMakeLists.txt'` after the merge),
  remove the reference.
* **`libraries/psio1`**: deleted by the C++ branch at its last stage.
  After the merge `git grep -n psio1 -- rust packages` must be empty
  (it is on this branch except comments).

## 3. Steps after the merge, in order

Each step proves one thing; stop at the first that fails.

1. **Configure and build the C++ twin test only.**
   `cmake <build>` then `cmake --build <build> --target psibase-psio-tests -j 6`
   (native; `rust_twins.cpp` is one of its sources).
   *Proves:* the merged `rust_twins.cpp` compiles against the flipped C++.
2. **Regenerate the fixture:**
   `PSIBASE_WRITE_RUST_TWINS=1 <build>/psibase-psio-tests "[twins]"`
   (or the whole binary) rewrites
   `libraries/psibase/common/tests/rust-twins.json`; without the variable
   the test `n-psibase-psio-tests` fails when the file is not what the C++
   declarations give. Remove the pass-throughs of section 1, then
   `cd rust && cargo test -r -p psibase --test psio_twins --test psio_json --test service_schema --test psio_leaf_types --test psio_wrappers`.
   *Proves:* Rust and C++ declare the same types (schema node, PSSZ, key,
   I-JSON, serde) for the 50 shared types and pack the same bytes for the
   18 calls; parameter names agree for 24 services. This is the cheapest
   place to find a layout difference: fix every failure here before going
   on.
3. **Argument bytes of shared services.** Extend the fixture's `calls`
   (section 1) for the services the boot uses: `transact::startBoot`,
   `setcode::setCode`, `accounts::newAccount`, `auth-sig::newAccount`,
   `packages::postinstall`, `packages::setSchema`, `sites::storeSys`,
   `producers::setProducers`, `http-server::registerServer`. Rerun step 2.
   *Proves:* what the Rust CLI and tester pack for C++ services is what
   the C++ dispatcher validates.
4. **Full build** (`~/psibase-pssz-scripts/build.sh <tag>`). The last
   step (`share/psibase/packages/index.json`) runs the Rust
   `reserved-names` tool over the C++-built packages.
   *Proves:* Rust reads the schema I-JSON, `meta.json` and
   `service/<acct>.json` that C++ writes (this is what fails in this tree
   alone), and `cargo-psibase` builds Rust packages C++ will read.
5. **Rust unit tests with the built packages:**
   `cd rust && PSIBASE_DATADIR=<build>/share/psibase cargo test -r -p psibase --lib`.
   *Proves:* the 42 `verify_schema` tests: the schema of each Rust mirror
   of a C++ service is equivalent (`Compare::Wire`) to the schema in the
   C++-built package.
6. **Boot.** `ctest -R 'psinode_test_psibase|rs-test-' -j4` or by hand:
   `psinode` on a fresh database, `psibase boot`. *Proves:* the genesis
   and boot transactions (Rust `boot.rs`: PSSZ `SignedTransaction`,
   `GenesisActionData`, `startBoot` ids), method numbers, the argument
   records of the boot actions, native table rows and keys, the trace JSON
   the CLI reads back.
7. **Service tests:** `ctest -R '^t-' -j4` (C++ tester over Rust-built
   packages) and `ctest -R '^rs-' -j4` (Rust tester over C++-built
   packages). *Proves:* tables, events, return values and the testers'
   package loading in both directions.
8. **Node tests:** `ctest -R '^psinode_test' -j4`, then the full
   `ctest -j4`. *Proves:* HTTP, package install over HTTP, GraphQL,
   snapshots, the Python client.
9. Front ends and plugins are not covered by any of this (team review
   log, item 0.3).

## 4. Expected first failures and how to tell them apart

| Symptom | Where it shows | Likely cause | How to look |
|---|---|---|---|
| `json: missing required member "package" of Schema`, `Invalid type for variant`, `missing required member … of ServiceSchema` | step 4, loading a package | one side still writes or reads the legacy schema JSON, or a package from an old build is on disk | `unzip -p <pkg>.psi service/<acct>.json \| head -c 400`: the new form starts `{"flags":[…],"server":…,"schema":{"service":"…","types":{"package":…`. Delete `<build>/share/psibase/packages` and the Rust `target/*/release/*.schema.json`, rebuild |
| `json: missing required member "x" of Meta / PackageInfo / LocalPackage` | step 4, 6, 8 | a writer of `meta.json` / `index.json` leaves a member out (every member is required in both languages now) | the file named in the message; `make_package_index.sh`, `write_meta` in `pack_service.cmake`, `cargo-psibase/src/package.rs` |
| `unknown service action: <name>` | step 6 | method number: a name spelled differently from the declaration (a hashed name is the hash of its exact bytes), or a Rust mirror with an old name | `psio::compress_name::method_to_number("<name>")` in both languages; `psio_leaf_types.rs` has the vectors |
| `invalid argument encoding for <method>: …` (C++ dispatcher) or `pssz: … (at byte N)` from a Rust service | step 6, 7 | argument record layout: a parameter's type differs between a mirror and its implementation (string kind `String` vs `RawString`, `Vec<u8>` vs string, an optional, a bounded member such as `Memo` changing the offset width) | add the call to the fixture (step 3) and compare the bytes; `resolved` in `psio_twins.rs` prints both schema nodes |
| a row is not found, or a table reads empty, with no error | step 6, 7 | key bytes: table number, index number or the key type differ (`psio::key`: big-endian, sign-flipped; a tuple key is the concatenation) | `psio::to_key` of the same value in both languages; for native tables `nativeTables.hpp` vs `rust/psibase/src/native_tables.rs` `key()` |
| `value returned from <method> was not serialized as expected` | step 7 | return type differs between mirror and implementation | the two declarations |
| Rust tool: `json: …` while printing a result; C++ tester: `json: …` reading a Rust reply | step 6, 8 | trace or reply JSON: a member name or a text form differs. Known candidates: `totalTime` (nanoseconds, a number or a string), `error` / `console` (raw strings), `InnerTrace.inner` (variant `{"ConsoleTrace":…}`), `SubjectPublicKeyInfo` (PEM text), `SocketEndpoint` / `IPAddress` (one string), `DbId` / `NewAccountMode` (names) | `rust/psibase/tests/psio_json.rs` pins what Rust expects for each; compare with the text in the failing output |
| `AccountNumber: not an account name` / `json: text form rejected the value` | anywhere JSON is read | account text is strict in both languages now (it was lenient through serde in Rust): an upper-case, over-long or non-canonical name in a fixture, a `postinstall.json`, a test | the text at the reported offset |
| GraphQL result has `[1,2,…]` where a client expects hex, or a 64-bit number is a string / a bare number | step 8, UIs | Rust services keep async-graphql: 64-bit integers are bare numbers always; bytes are hex only on the eight members listed in 6.26 (RG20). C++ GraphQL follows `doc/migrations/2026-11-fracpack-to-pssz/flip-interop.md` 6 | the query against both services |
| event queries return no rows or `Failed to deserialize` | step 7, 8 (query services) | the Events service's SQL rows: byte columns are hex text, 64-bit columns a number or a string; three Rust readers were changed for bytes, the others read numbers leniently (`deserialize_number_from_string`) | the row text in the error; `rust/psibase/src/graph_ql.rs` `SqlRow` |
| `setSchema`: `width-changed` / not an upgrade | step 6 on an existing database only | a schema installed by an older build | use a fresh database; there is no live chain |
| `verify_schema` fails for one service (step 5) | Rust unit tests | the Rust mirror of a C++ service is behind the C++ declaration | the message prints the differing action or type; fix the mirror (C++ is the authority for a C++ service) |

## 5. After the merge is green

* Remove from `doc/migrations/2026-11-fracpack-to-pssz/pssz-conversion.md` 6.26 the "needs the C++ flip"
  classification and record the merged results.
* `git grep -n -i fracpack -- rust packages` and `git grep -n psio1`: what
  is left is comments and documentation (6.26, "R-F, the rest").
* The trust refinement (`rust/psibase/src/table.rs` `decode_row`) and the
  size caps are the team's (team review log 0.1, 0.2).
