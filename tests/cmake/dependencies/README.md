`cmake/PsibaseDependencies.cmake` declares psibase's pinned source
dependencies. Including it alone fetches nothing and adds no targets.

The psibase build acquires canonical PSIO through it: `libraries/CMakeLists.txt`
calls `psibase_acquire_dependency(psio)` for the native build and links the
maintained `psio::psio` target; the WASM guest build and the installed SDK use
the headers of that same source tree with `PSIO_EXCEPTIONS_ENABLED=0` and
`PSIO_HAVE_SIMDJSON=0`. The legacy in-tree library is deleted. A project that still defines its own `psio` target before
acquisition fails clearly.

The pattern follows [psiserve at 28330232d7d156d201161dba3485a737f2b28a07](https://github.com/gofractally/psiserve/blob/28330232d7d156d201161dba3485a737f2b28a07/CMakeLists.txt#L86):
declare canonical names before adding dependent projects, let the first
declaration own the graph, keep fetched repositories under `external/<name>`,
and use `FETCHCONTENT_SOURCE_DIR_<NAME>` for explicit development overrides.
The source directory is anchored to this module's psibase root, including when
the top-level project is a standalone test directory. Nothing is copied from
PSIO into psibase; the consumer links the maintained `psio::psio` target.

The defaults are immutable Git revisions:

| Name | Revision | Acquisition boundary |
| --- | --- | --- |
| psio | `2c64a245bda231d427357d502e3d6bfb82364cbb` | Sources by FetchContent; the maintained upstream CMake project is added by `psibase_acquire_dependency` |
| psitri | `d3bba0e6a5f59e37c3eea08a1a720ae553cafb2c` | Sources only |
| ucc | `d79166da0290fdf9d1f9d5880d4dfb45b2822cf3` | Sources only |
| psizam | `2e93ecd1561ed7d4808a1a83af1d0137bac17b41` | Sources only |

The PSIO pin is `main` of gofractally/psio: PSSZ with record evolution by
appended optionals, mandatory pruning, type-derived offset widths, the `key`
format, I-JSON and time values. PSIO fetches its own simdjson at a pinned
release and archive hash; psibase refuses to configure if another simdjson
target exists first. The psizam pin is the
published `checkpoint/native-runtime-2026-11-21` revision.
UCC is the public standalone extraction with its two qualified header fixes;
its checkpoint covers the existing container tests and header consumer, not
the complete database engine.
All four repositories are public and are fetched over HTTPS; no GitHub
credentials are needed to configure.

All four module declarations are source-only: `SOURCE_SUBDIR` names a
directory that does not exist, so `FetchContent_MakeAvailable` populates the
source and adds nothing. For PSIO, `psibase_acquire_dependency(psio)` then
adds the maintained upstream project itself, with
`add_subdirectory(<source> <binary>)`, or with `EXCLUDE_FROM_ALL` when the
consumer set `PSIBASE_PSIO_EXCLUDE_FROM_ALL` before the first acquisition.
This is one code path for every supported CMake (3.20 or newer);
`FetchContent_Declare(... EXCLUDE_FROM_ALL)` would need CMake 3.28. In an
excluded directory the install rules of PSIO and of the simdjson it fetches in
a subdirectory are not part of the consumer's install, and their targets are
built only because consumer targets link them. If PSIO was already added
without exclusion (a containing project's declaration without `SOURCE_SUBDIR`
lets FetchContent add it, as in the parent-declaration check below), a
consumer that asks for exclusion fails at configure; nothing is excluded
silently or left installed silently. A transitive consumer that calls raw
`FetchContent_MakeAvailable(psio)` shares the target only after
`psibase_acquire_dependency(psio)` has run.

For psitri, UCC, and psizam, the first declaration MUST retain
`SOURCE_SUBDIR .psibase-no-top-level-cmake`. `psibase_acquire_dependency(name)`
then only populates source. The active adapters must still validate their
selected source manifests and explicitly add the codec-free engine subset.
Evaluating those upstream top-level projects now would reintroduce floating
dependencies and/or the new PSIO into the legacy node. The proof uses a local
fixture whose top-level CMake always fails, so sentinel behavior is observable.
Their existing adapters/submodule are unchanged here. Remove the old psizam
gitlink as part of a later adapter conversion before adopting FetchContent for
the same path; never overlay a new fetch onto an initialized submodule.

To use the acquisition interface:

```cmake
include(cmake/PsibaseDependencies.cmake)
psibase_declare_dependencies() # before any dependency can declare transitive pins
psibase_acquire_dependency(psio)
target_link_libraries(my_consumer PRIVATE psio::psio)
```

The containing application can declare a dependency first to control its
single source/pin. CI/release builds should use the qualified declarations,
disable local source overrides, and verify actual HEAD and source cleanliness.
An override is explicit co-development input, not evidence that the configured
pin was consumed. Storage's existing source hashes remain authoritative; this
module does not bypass them or qualify arbitrary dirty trees.

Acquire through `psibase_acquire_dependency` before adding transitive consumers
that call raw `FetchContent_MakeAvailable`. A new FetchContent build tree can
otherwise remove an existing `SOURCE_DIR` before cloning, even when another
build tree already populated it. The guarded acquisition serializes the source
path and never runs that clone/update operation on a pre-existing directory:

- A clean Git checkout at the exact winning declaration's commit is reused
  without Git mutation. Extra local branches, tags, reflogs and index bytes are
  preserved. This covers normal reconfiguration and a second build directory.
- A dirty checkout, different HEAD (including a clean unpushed commit), hidden
  index flags, non-Git data or an unverifiable declaration fails without changing
  the source. Select a separate qualified checkout or explicitly opt into the
  source with `FETCHCONTENT_SOURCE_DIR_<NAME>`; acquisition never resets it.
- Explicit source overrides remain developer input. The storage adapter's
  strict source hashes still apply, and the standalone consumer records actual
  source/HEAD/status rather than assuming the configured pin was consumed.

Each build records acquisition mode, actual source/HEAD, winning repository/pin
and explicit override in `psibase-dependencies/<name>-source.txt`. Verified reuse
uses a function-local FetchContent source setting only after checking the exact
pin and cleanliness; it does not add a cached or HOME-based override. Since
FetchContent has no public pre-population declaration accessor, this guard
reads its saved declaration property and fails closed if that representation
is unavailable. It does not guess a source path and risk deleting another one.

The disposable fixture checks working-file and complete `.git` metadata bytes
before/after each protected operation, including dirty edits, an unpushed commit
and annotated local tag:

```sh
python3 tests/cmake/dependencies/preservation.py build/dependency-preservation
```

The standalone consumer exercises existing PSIO reflection, typed PSSZ
encode/validate/decode, a zero-copy view, and PSSZ-to-JSON transcoding:

```sh
cmake -S tests/cmake/dependencies -B build/deps -G Ninja -DCMAKE_BUILD_TYPE=Release
cmake --build build/deps
ctest --test-dir build/deps --output-on-failure
```

It verifies the actual Git HEAD, records source/HEAD/override/status in
`psio-source.txt`, and checks that a default fetch uses the psibase root's
`external/psio`. Supply a C++23 compiler if the system default lacks support.

Other focused checks:

```sh
# Explicit canonical sibling-source override; choose its actual expected HEAD.
cmake -S tests/cmake/dependencies -B build/deps-override \
  -DFETCHCONTENT_SOURCE_DIR_PSIO=/path/to/psio \
  -DPSIBASE_DEPENDENCY_PROOF_EXPECT_HEAD=<actual-revision>

# Two leaves attempt conflicting declarations, which must both be ignored.
cmake -S tests/cmake/dependencies -B build/deps-diamond \
  -DPSIBASE_DEPENDENCY_PROOF_MODE=diamond

# A containing project's earlier declaration also wins over the module.
cmake -S tests/cmake/dependencies -B build/deps-parent \
  -DPSIBASE_DEPENDENCY_PROOF_PREDECLARE_PSIO_TAG=ff114b6a8c9265e6b5da5ffb85df1617b2b43514 \
  -DPSIBASE_DEPENDENCY_PROOF_EXPECT_HEAD=ff114b6a8c9265e6b5da5ffb85df1617b2b43514

# Root CMake must never execute for the three acquisition-only dependencies.
cmake -S tests/cmake/dependencies -B build/deps-sentinels \
  -DPSIBASE_DEPENDENCY_PROOF_MODE=sentinels \
  -DFETCHCONTENT_SOURCE_DIR_PSITRI="$PWD/tests/cmake/dependencies/sentinel" \
  -DFETCHCONTENT_SOURCE_DIR_UCC="$PWD/tests/cmake/dependencies/sentinel" \
  -DFETCHCONTENT_SOURCE_DIR_PSIZAM="$PWD/tests/cmake/dependencies/sentinel"

cmake -S tests/cmake/dependencies -B build/deps-dormant \
  -DPSIBASE_DEPENDENCY_PROOF_MODE=dormant
# Expected configuration failure: legacy target collision.
cmake -S tests/cmake/dependencies -B build/deps-collision \
  -DPSIBASE_DEPENDENCY_PROOF_MODE=collision

# Fetch the real pinned engine sources, without evaluating upstream roots.
cmake -S tests/cmake/dependencies/sources -B build/deps-engine-sources
```

Upstream already exports an installed CMake package, which can be consumed
separately without FetchContent:

```sh
cmake --install build/deps --prefix "$PWD/build/psio-install"
cmake -S tests/cmake/dependencies/installed -B build/deps-installed \
  -DCMAKE_PREFIX_PATH="$PWD/build/psio-install"
cmake --build build/deps-installed
ctest --test-dir build/deps-installed --output-on-failure
```

This establishes native standalone package behavior. In the psibase build the
SDK (`COMPONENT libpsibase`) ships PSIO's headers for guests from the WASM
project; PSIO's own native install rules are excluded from psibase's install
tree (`PSIBASE_PSIO_EXCLUDE_FROM_ALL`, checked by `libraries/CMakeLists.txt`
with `psibase_psio_install_excluded`). Rust manifest paths/pins and the wire
and API cutover are tracked in `doc/pssz-conversion.md`.
