This is a dormant dependency acquisition checkpoint. The main psibase build
continues to use its existing PSIO and runtime/storage adapters. Including
`cmake/PsibaseDependencies.cmake` alone fetches nothing and adds no targets.
Activating canonical PSIO while the legacy `psio` target exists fails clearly.

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
| psio | `f6b10ec7d7bba4022cd1c9394f88ad1440b4b2b7` | Maintained upstream CMake target |
| psitri | `6cff821fdf341cc6512ba214dd4da8318ecb59a4` | Sources only |
| ucc | `cd2e2e305363588e8c9c8eb8b23572cd56952ce7` | Sources only |
| psizam | `4da50574dfeecece12bfc75e0f204031835d9db8` | Sources only |

The PSIO pin is the published `codex/annotation-header-self-containment`
checkpoint: main `ff114b6` plus direct standard includes and a first-header
compile probe. It contains no codec prototype changes. The psizam pin is the
published `checkpoint/native-runtime-2026-11-21` revision.
UCC is the public standalone extraction with its two qualified header fixes;
its checkpoint covers the existing container tests and header consumer, not
the complete database engine.

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

To use the future acquisition interface after the legacy target is retired:

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

This establishes native standalone package behavior only. The existing SDK
installs legacy PSIO as `COMPONENT libpsibase`; canonical PSIO's install rules
have a different component boundary and propagate native feature definitions.
Guest exception flags, transitive guest includes, SDK component packaging,
Rust manifest paths/pins, all dynamic schema callers, and the actual wire/API
cutover remain separate gates. The current psiserve Cargo manifest still uses
an older local PSIO path; it is not a Rust acquisition template to copy.
